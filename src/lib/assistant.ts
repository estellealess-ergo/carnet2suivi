import { buildPseudonymizer, type Person } from "./pseudonymize";
import { supabase } from "./supabase";

export type AssistantTask = "note" | "smart" | "famille" | "echange";

export const assistantAvailable = () => Boolean(supabase) && navigator.onLine;

/**
 * Mise au propre d'une note de séance en trois rubriques (Fait, Observé, À reprendre).
 * Le nom du patient est remplacé par une étiquette avant l'envoi et remis ensuite.
 */
export async function askAssistant(task: AssistantTask, text: string, patient: Person) {
  if (!supabase) throw new Error("L'assistant nécessite le serveur du cabinet.");
  if (!navigator.onLine) throw new Error("L'assistant n'est pas disponible hors connexion.");
  const p = buildPseudonymizer([{ person: patient, label: "PATIENT" }]);
  const { data, error } = await supabase.functions.invoke<{ text: string }>("assistant", {
    body: { task, text: p.hide(text) },
  });
  if (error) throw new Error("L'assistant n'a pas répondu. Réessaie dans un instant.");
  return p.reveal(data?.text ?? "");
}
