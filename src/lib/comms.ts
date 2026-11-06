import { supabase } from "./supabase";
import { syncNow } from "./sync-controller";

/** Appel d'une fonction serveur ; renvoie un message d'erreur lisible. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  if (!supabase) throw new Error("Cette fonction nécessite le serveur du cabinet.");
  if (!navigator.onLine) throw new Error("Pas de connexion internet pour le moment.");
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(name, { body: body as never });
  if (error) {
    let message = "Le serveur n'a pas répondu. Réessaie dans un instant.";
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error) message = j.error;
    } catch {
      /* message par défaut */
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && data.error) throw new Error(String(data.error));
  return data as T;
}

/* ------------------------------------------------------------------ Gmail */

export type MailAccount = { email: string; last_sync_at: string | null } | null;

export async function getMailAccount(): Promise<MailAccount> {
  if (!supabase || !navigator.onLine) return null;
  const { data } = await supabase.from("mail_accounts").select("email,last_sync_at").maybeSingle();
  return (data as MailAccount) ?? null;
}

const redirectUri = () => `${window.location.origin}/connexion-gmail`;

export async function startGmailConnect() {
  const state = crypto.randomUUID();
  sessionStorage.setItem("gmail-state", state);
  const { url } = await callFunction<{ url: string }>("gmail", { action: "connect", redirect_uri: redirectUri(), state });
  window.location.assign(url);
}

export async function finishGmailConnect(code: string, state: string) {
  if (state !== sessionStorage.getItem("gmail-state")) throw new Error("La liaison a expiré. Recommence depuis les Paramètres.");
  sessionStorage.removeItem("gmail-state");
  return callFunction<{ email: string }>("gmail", { action: "callback", code, redirect_uri: redirectUri() });
}

export async function syncGmail() {
  const out = await callFunction<{ added: number }>("gmail", { action: "sync" });
  await syncNow();
  return out.added;
}

export async function disconnectGmail() {
  await callFunction("gmail", { action: "disconnect" });
}

export async function sendEmail(opts: {
  to: string[];
  subject: string;
  text: string;
  patientId: string | null;
  threadId?: string | null;
}) {
  const out = await callFunction<{ external_id: string }>("gmail", {
    action: "send",
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    patient_id: opts.patientId,
    thread_id: opts.threadId ?? undefined,
    communication_id: crypto.randomUUID(),
  });
  await syncNow();
  return out;
}
