import { localAiReady, promptLocalAi } from "./local-ai";
import { PROMPTS } from "./prompts";
import { buildPseudonymizer, type Person } from "./pseudonymize";
import { supabase } from "./supabase";

export type AssistantTask = "note" | "smart" | "famille" | "echange" | "cr";

/**
 * L'assistant est disponible :
 * - avec le serveur du cabinet (fonction « assistant »), quand il existe ;
 * - sinon avec l'IA intégrée à Chrome, sur l'ordinateur, une fois activée dans Paramètres.
 */
export const assistantAvailable = () => (Boolean(supabase) && navigator.onLine) || localAiReady();

const pseudo = (patient: Person) => buildPseudonymizer([{ person: patient, label: "PATIENT" }]);

/** Le nom du patient est remplacé par une étiquette avant tout traitement, puis remis. */
export async function askAssistant(task: AssistantTask, text: string, patient: Person) {
  const p = pseudo(patient);
  if (supabase && navigator.onLine) {
    const { data, error } = await supabase.functions.invoke<{ text: string }>("assistant", {
      body: { task, text: p.hide(text) },
    });
    if (error) throw new Error("L'assistant n'a pas répondu. Réessaie dans un instant.");
    return p.reveal(data?.text ?? "");
  }
  if (localAiReady()) return p.reveal(await promptLocalAi(PROMPTS[task], p.hide(text)));
  throw new Error("L'assistant n'est pas activé sur cet ordinateur (Paramètres).");
}

/* ------------------------------------------------------------------ avec Claude, par copier-coller */

/**
 * Prépare la demande à coller dans Claude : consignes + texte, avec le nom du patient masqué.
 * Seul le texte de la séance sort de l'application, jamais l'identité du patient.
 */
export async function copyForClaude(task: AssistantTask, text: string, patient: Person) {
  const demande = `${PROMPTS[task]}\n\n---\n\n${pseudo(patient).hide(text)}`;
  await navigator.clipboard.writeText(demande);
}

/** Lit la réponse copiée depuis Claude et remet le nom du patient. */
export async function pasteFromClaude(patient: Person): Promise<string> {
  const answer = (await navigator.clipboard.readText()).trim();
  if (!answer) throw new Error("Le presse-papiers est vide : copie d'abord la réponse de Claude.");
  return pseudo(patient).reveal(answer);
}
