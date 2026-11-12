// Fonction serveur « assistant » (Supabase Edge Function, Deno).
//
// Reçoit un texte DÉJÀ pseudonymisé par l'application (aucun nom de patient)
// et l'envoie à un fournisseur d'IA hébergé dans l'Union européenne
// (par défaut Mistral AI, La Plateforme). Rien n'est stocké ici.
//
// Secrets à définir sur le serveur :
//   MISTRAL_API_KEY   clé du fournisseur
//   ASSISTANT_MODEL   (facultatif) modèle, par défaut "mistral-large-latest"

import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE =
  "Tu assistes une ergothérapeute libérale française (D.E.). Tu écris en français professionnel, " +
  "clair et précis, à la première personne de son point de vue (« j'ai proposé », " +
  "« nous avons travaillé »). FIDÉLITÉ ABSOLUE : tu n'ajoutes aucun fait, mesure, progrès, " +
  "décision, recommandation ou diagnostic absent du brouillon. Une hypothèse reste formulée " +
  "comme une hypothèse. Les étiquettes entre crochets comme [PATIENT-PRÉNOM] sont des noms " +
  "masqués : recopie-les telles quelles.";

const PROMPTS: Record<string, string> = {
  note:
    BASE +
    " Rédige la note de séance hebdomadaire à partir de ses notes brutes (texte, mots-clés, " +
    "activités, objectifs travaillés). La note doit être COMPLÈTE et DÉVELOPPÉE, utilisable telle quelle " +
    "dans le dossier : des phrases entières, professionnelles et précises, pas un style télégraphique. " +
    "REPRENDS TOUTES LES INFORMATIONS sans exception : chaque activité, support, consigne, durée, " +
    "chiffre (vitesse, précision, score, nombre d'essais…), niveau d'aide, stratégie, comportement, " +
    "remarque de l'enfant, de la famille ou de l'école. Ne résume pas, ne regroupe pas au point de " +
    "perdre un détail ; la note mise au propre est au moins aussi détaillée que les notes brutes. " +
    "Développe chaque élément : décris ce qui a été proposé et dans quelles conditions, ce qui a été " +
    "observé (réussites et difficultés, aide nécessaire, attitude, fatigue, évolution par rapport à " +
    "la séance précédente si elle est notée), et ce qui est prévu ensuite avec la raison quand elle " +
    "est donnée. Organise en trois rubriques, dans cet ordre, chacune commençant sur une nouvelle " +
    "ligne par son titre : « Fait : » (activités et supports proposés), « Observé : » (tout ce qui a " +
    "été constaté ou rapporté), « À reprendre : » (suite prévue). Une rubrique peut faire plusieurs " +
    "phrases. Omets seulement une rubrique sans aucune information. Réponds uniquement avec la note, " +
    "sans titre ni commentaire.\n\nExemple.\nNotes brutes : TypingClub leçon 12 18 mpm 92% ; " +
    "rangée du haut difficile ; fatigue fin de séance ; maman dit qu'il s'entraîne 10 min le soir ; " +
    "laby niveau 3 aide verbale ; refaire rangée haut\nNote : Fait : Entraînement à la frappe sur " +
    "TypingClub (leçon 12), puis labyrinthes de niveau 3.\nObservé : Sur TypingClub, [PATIENT-PRÉNOM] " +
    "atteint 18 mots par minute avec 92 % de précision ; les touches de la rangée du haut restent " +
    "difficiles. Les labyrinthes de niveau 3 sont réalisés avec une aide verbale. Une fatigue " +
    "apparaît en fin de séance. Sa mère rapporte qu'il s'entraîne environ 10 minutes le soir.\n" +
    "À reprendre : Poursuivre le travail sur les touches de la rangée du haut.",
  famille:
    BASE +
    " À partir de la note de séance, rédige un court message pour la famille (3 à 6 phrases), " +
    "chaleureux mais professionnel, compréhensible sans jargon : ce que nous avons travaillé, " +
    "ce qui a bien fonctionné, éventuellement une idée simple à reprendre à la maison si la note " +
    "en mentionne une. N'inclus AUCUNE hypothèse clinique, aucun élément de l'analyse réservé " +
    "au professionnel, aucune information sensible. Pas de formule de signature. " +
    "Réponds uniquement avec le message.",
  echange:
    BASE +
    " Le texte est ce que l'ergothérapeute a dicté après un appel ou un échange avec une famille, " +
    "un enseignant ou un professionnel. Garde uniquement les informations clés utiles au suivi, " +
    "en texte simple : une à trois phrases (qui, à quel sujet, ce qui a été dit ou décidé), puis " +
    "« À faire : » suivi des actions (ou « rien »). Retire les détails personnels sans rapport " +
    "avec le suivi. Réponds uniquement avec ce texte.",
  smart:
    BASE +
    " Reformule l'objectif en UNE phrase d'objectif fonctionnel SMART centré sur l'occupation : " +
    "délai, action observable, contexte, niveau d'aide, critère de réussite. Si un élément " +
    "manque, ne l'invente pas. Réponds uniquement avec la phrase.",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Seuls les comptes connectés du cabinet peuvent utiliser l'assistant.
  const auth = req.headers.get("Authorization") ?? "";
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: user } = await client.auth.getUser();
  if (!user?.user) return new Response("Non autorisé", { status: 401, headers: cors });

  const { task, text } = (await req.json()) as { task?: string; text?: string };
  const system = task ? PROMPTS[task] : undefined;
  if (!system || !text?.trim() || text.length > 20_000) {
    return new Response("Requête invalide", { status: 400, headers: cors });
  }

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
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) return new Response("Fournisseur indisponible", { status: 502, headers: cors });
  const json = await res.json();
  const out = json?.choices?.[0]?.message?.content ?? "";
  return Response.json({ text: String(out).trim() }, { headers: cors });
});
