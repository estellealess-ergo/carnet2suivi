// Fonction serveur « gmail » : liaison de la boîte Gmail de la praticienne,
// reprise des e-mails échangés avec les patients et leurs familles, envoi d'e-mails.
//
// Actions (corps JSON { action, … }) :
//   connect     → adresse de la page de consentement Google
//   callback    → { code, redirect_uri } : enregistre la liaison
//   sync        → reprend les nouveaux e-mails (adresses connues ou libellé « Carnet de suivi »)
//   send        → { to[], subject, text, communication_id?, patient_id?, thread_id? } : envoie depuis
//                 la boîte reliée et inscrit l'échange dans le journal
//   disconnect  → supprime la liaison
//
// Secrets : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.

import { admin, cors, currentUser, fail, json } from "../_shared/common.ts";
import { buildRawEmail, parseMail, type Contact, type GmailMessage } from "../_shared/mail-core.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
].join(" ");
const LABEL_NAME = "Carnet de suivi";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function token(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      ...params,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description ?? "Google a refusé la demande.");
  return data as { access_token: string; refresh_token?: string; id_token?: string };
}

async function gmail<T>(access: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail : ${res.status}`);
  return res.json() as Promise<T>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const me = await currentUser(req);
  if (!me) return fail("Non autorisé", 401);
  const userId = me.user.id;
  const db = admin();
  const body = await req.json().catch(() => ({}));

  try {
    switch (body.action) {
      case "connect": {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
          client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
          redirect_uri: String(body.redirect_uri),
          response_type: "code",
          scope: SCOPES,
          access_type: "offline",
          prompt: "consent",
          state: String(body.state ?? ""),
          login_hint: me.user.email ?? "",
        }).toString();
        return json({ url: url.toString() });
      }

      case "callback": {
        const t = await token({
          code: String(body.code),
          redirect_uri: String(body.redirect_uri),
          grant_type: "authorization_code",
        });
        if (!t.refresh_token) return fail("Google n'a pas donné d'accès durable. Recommence la liaison.");
        const profile = await gmail<{ emailAddress: string }>(t.access_token, "/profile");
        const { error } = await db.from("mail_accounts").upsert({
          user_id: userId,
          provider: "gmail",
          email: profile.emailAddress,
          refresh_token: t.refresh_token,
          last_sync_at: null,
        });
        if (error) throw error;
        return json({ email: profile.emailAddress });
      }

      case "disconnect": {
        const { data: acc } = await db.from("mail_accounts").select("refresh_token").eq("user_id", userId).maybeSingle();
        if (acc?.refresh_token) {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${acc.refresh_token}`, { method: "POST" }).catch(() => {});
        }
        await db.from("mail_accounts").delete().eq("user_id", userId);
        return json({ ok: true });
      }

      case "sync": {
        const { data: acc } = await db.from("mail_accounts").select("*").eq("user_id", userId).maybeSingle();
        if (!acc) return fail("Aucune boîte Gmail n'est reliée.");
        const { access_token } = await token({ refresh_token: acc.refresh_token, grant_type: "refresh_token" });

        // Adresses connues : patients et responsables légaux des dossiers de ce compte.
        const contacts: Contact[] = [];
        const { data: pats } = await db.from("patients").select("id,email").eq("owner_id", userId).is("deleted_at", null);
        pats?.forEach((p) => p.email && contacts.push({ email: p.email, patient_id: p.id }));
        const { data: gs } = await db.from("guardians").select("patient_id,email").eq("owner_id", userId).is("deleted_at", null);
        gs?.forEach((g) => g.email && contacts.push({ email: g.email, patient_id: g.patient_id }));

        const labels = await gmail<{ labels: { id: string; name: string }[] }>(access_token, "/labels");
        const labelId = labels.labels.find((l) => l.name === LABEL_NAME)?.id ?? null;

        // Fenêtre de reprise : depuis la dernière synchronisation (avec une marge), sinon 30 jours.
        const since = acc.last_sync_at
          ? Math.floor(new Date(acc.last_sync_at).getTime() / 1000) - 86_400
          : Math.floor(Date.now() / 1000) - 30 * 86_400;
        const ids: string[] = [];
        let pageToken: string | undefined;
        do {
          const q = new URLSearchParams({ q: `after:${since} -in:chats`, maxResults: "100" });
          if (pageToken) q.set("pageToken", pageToken);
          const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(access_token, `/messages?${q}`);
          page.messages?.forEach((m) => ids.push(m.id));
          pageToken = page.nextPageToken;
        } while (pageToken && ids.length < 500);

        const { data: known } = await db
          .from("communications")
          .select("external_id")
          .eq("owner_id", userId)
          .in("external_id", ids.map((i) => `gmail:${i}`));
        const already = new Set((known ?? []).map((k) => k.external_id));

        let added = 0;
        for (const id of ids) {
          if (already.has(`gmail:${id}`)) continue;
          const msg = await gmail<GmailMessage>(access_token, `/messages/${id}?format=full`);
          const parsed = parseMail(msg, acc.email, contacts, labelId);
          if (!parsed) continue;
          const now = new Date().toISOString();
          const { error } = await db.from("communications").insert({
            id: crypto.randomUUID(),
            owner_id: userId,
            created_at: now,
            updated_at: now,
            patient_id: parsed.patient_id,
            channel: "email",
            direction: parsed.direction,
            occurred_at: parsed.occurred_at,
            counterpart: parsed.counterpart,
            subject: parsed.subject,
            body: parsed.body,
            status: parsed.direction === "entrant" ? "a_traiter" : "traite",
            external_id: parsed.external_id,
            thread_id: parsed.thread_id,
          });
          if (!error) added++;
        }
        await db.from("mail_accounts").update({ last_sync_at: new Date().toISOString() }).eq("user_id", userId);
        return json({ added });
      }

      case "send": {
        const { data: acc } = await db.from("mail_accounts").select("*").eq("user_id", userId).maybeSingle();
        if (!acc) return fail("Aucune boîte Gmail n'est reliée.");
        const to = (body.to as string[] | undefined)?.filter((a) => /@/.test(a)) ?? [];
        if (to.length === 0) return fail("Aucun destinataire valide.");
        const { access_token } = await token({ refresh_token: acc.refresh_token, grant_type: "refresh_token" });
        const raw = buildRawEmail({ from: acc.email, to, subject: String(body.subject ?? ""), text: String(body.text ?? "") });
        const sent = await gmail<{ id: string; threadId: string }>(access_token, "/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw, threadId: body.thread_id ?? undefined }),
        });
        // L'échange est inscrit ici (et non par l'appareil) pour éviter tout doublon
        // avec la reprise suivante ; il arrive sur l'appareil à la synchronisation.
        const now = new Date().toISOString();
        await db.from("communications").insert({
          id: typeof body.communication_id === "string" ? body.communication_id : crypto.randomUUID(),
          owner_id: userId,
          created_at: now,
          updated_at: now,
          patient_id: typeof body.patient_id === "string" ? body.patient_id : null,
          channel: "email",
          direction: "sortant",
          occurred_at: now,
          counterpart: to.join(", "),
          subject: String(body.subject ?? ""),
          body: String(body.text ?? ""),
          status: "traite",
          external_id: `gmail:${sent.id}`,
          thread_id: sent.threadId,
        });
        return json({ external_id: `gmail:${sent.id}`, thread_id: sent.threadId });
      }

      default:
        return fail("Action inconnue.");
    }
  } catch (e) {
    return fail((e as Error).message ?? "Erreur", 500);
  }
});
