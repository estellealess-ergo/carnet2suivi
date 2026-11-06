// Outils communs aux fonctions serveur (Supabase Edge Functions, Deno).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: cors });

export const fail = (message: string, status = 400) => json({ error: message }, status);

/** Client avec la clé de service : contourne les règles d'accès, à n'utiliser que côté serveur. */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Utilisateur connecté qui appelle la fonction (null si non connecté). */
export async function currentUser(req: Request) {
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data } = await client.auth.getUser();
  return data.user ? { user: data.user, client } : null;
}

/** Appel au modèle de langage (fournisseur hébergé dans l'UE, Mistral AI par défaut). */
export async function chat(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("MISTRAL_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("ASSISTANT_MODEL") ?? "mistral-large-latest",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error("Fournisseur d'IA indisponible");
  const out = await res.json();
  return String(out?.choices?.[0]?.message?.content ?? "").trim();
}
