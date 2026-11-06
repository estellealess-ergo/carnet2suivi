// Fonction serveur « team » : cabinet, collègues et accès des familles.
//
// Actions (corps JSON { action, … }) :
//   create_practice { name }                 → crée le cabinet, l'appelante en est titulaire
//   invite_member   { email, display_name }  → (titulaire) invite une collègue par e-mail
//   remove_member   { user_id }              → (titulaire) retire une collègue
//   invite_family   { guardian_id }          → invite un parent dans l'espace famille
//   revoke_family   { guardian_id }          → retire l'accès d'un parent
//
// Les inscriptions libres sont désactivées sur le serveur : un compte n'existe que
// s'il a été invité ici.

import { admin, cors, currentUser, fail, json } from "../_shared/common.ts";

const APP_URL = () => Deno.env.get("APP_URL") ?? "";

async function findOrInviteUser(db: ReturnType<typeof admin>, email: string, redirectTo: string) {
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error && data.user) return data.user.id;
  // Compte déjà existant (ex. parent de deux enfants) : on le retrouve.
  for (let page = 1; page <= 20; page++) {
    const { data: list } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const found = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (found) {
      await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
      return found.id;
    }
    if (!list || list.users.length < 200) break;
  }
  throw new Error("Impossible d'inviter cette adresse.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const me = await currentUser(req);
  if (!me) return fail("Non autorisé", 401);
  const uid = me.user.id;
  const db = admin();
  const body = await req.json().catch(() => ({}));

  const membership = async () =>
    (await db.from("practice_members").select("practice_id, role").eq("user_id", uid).maybeSingle()).data;

  try {
    switch (body.action) {
      case "create_practice": {
        if (await membership()) return fail("Tu fais déjà partie d'un cabinet.");
        const name = String(body.name ?? "").trim();
        if (!name) return fail("Indique le nom du cabinet.");
        const { data: p, error } = await db.from("practices").insert({ name }).select("id").single();
        if (error) throw error;
        await db.from("practice_members").insert({
          practice_id: p.id,
          user_id: uid,
          role: "titulaire",
          display_name: String(body.display_name ?? me.user.email ?? ""),
          email: me.user.email ?? "",
        });
        return json({ practice_id: p.id });
      }

      case "invite_member": {
        const m = await membership();
        if (m?.role !== "titulaire") return fail("Seule la titulaire du cabinet peut inviter.", 403);
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Adresse e-mail invalide.");
        const userId = await findOrInviteUser(db, email, APP_URL());
        const { data: other } = await db.from("practice_members").select("practice_id").eq("user_id", userId).maybeSingle();
        if (other && other.practice_id !== m.practice_id) return fail("Cette personne fait déjà partie d'un autre cabinet.");
        await db.from("practice_members").upsert({
          practice_id: m.practice_id,
          user_id: userId,
          role: "membre",
          display_name: String(body.display_name ?? "").trim() || email,
          email,
        });
        return json({ user_id: userId });
      }

      case "remove_member": {
        const m = await membership();
        if (m?.role !== "titulaire") return fail("Seule la titulaire du cabinet peut retirer une collègue.", 403);
        if (body.user_id === uid) return fail("Tu ne peux pas te retirer toi-même.");
        await db.from("practice_members").delete().eq("practice_id", m.practice_id).eq("user_id", body.user_id);
        // Les dossiers qui lui étaient partagés ne lui sont plus accessibles.
        const now = new Date().toISOString();
        await db.from("patient_shares").update({ deleted_at: now, updated_at: now }).eq("user_id", body.user_id).is("deleted_at", null);
        return json({ ok: true });
      }

      case "invite_family":
      case "revoke_family": {
        // L'appelante doit voir le dossier du patient (règles d'accès appliquées avec SON compte).
        const { data: g } = await me.client.from("guardians").select("id, email, patient_id").eq("id", body.guardian_id).maybeSingle();
        if (!g) return fail("Contact introuvable.", 404);
        const now = new Date().toISOString();
        if (body.action === "revoke_family") {
          await db.from("guardians").update({ user_id: null, updated_at: now }).eq("id", g.id);
          return json({ ok: true });
        }
        const email = String(g.email ?? "").trim().toLowerCase();
        if (!email) return fail("Ajoute d'abord l'adresse e-mail de ce contact.");
        const userId = await findOrInviteUser(db, email, `${APP_URL()}/espace`);
        const { data: pro } = await db.from("practice_members").select("user_id").eq("user_id", userId).maybeSingle();
        if (pro) return fail("Cette adresse appartient à un compte professionnel du cabinet.");
        await db.from("guardians").update({ user_id: userId, updated_at: now }).eq("id", g.id);
        return json({ ok: true });
      }

      default:
        return fail("Action inconnue.");
    }
  } catch (e) {
    return fail((e as Error).message ?? "Erreur", 500);
  }
});
