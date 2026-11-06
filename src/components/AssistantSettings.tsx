import { Sparkles } from "lucide-react";
import { downloadLocalAi, useLocalAi } from "@/lib/local-ai";
import { supabase } from "@/lib/supabase";
import { Button, Pill } from "./ui";

/** Activation de l'assistant de rédaction intégré à Chrome (sur l'ordinateur, gratuit). */
export function AssistantSettings() {
  const [state, progress] = useLocalAi();
  if (supabase) return null;
  return (
    <section className="rounded-lg border border-rule bg-sheet p-5">
      <h2 className="mb-2">Assistant de rédaction</h2>
      <p className="mb-3 text-ink-soft">
        Il met les notes au propre (Fait / Observé / À reprendre), propose les messages aux familles et résume les
        échanges. Il fonctionne <strong>directement sur cet ordinateur</strong>, grâce à l'IA intégrée à Chrome :
        gratuit, sans compte, et le texte ne quitte pas l'appareil. Le nom du patient est de toute façon masqué.
      </p>
      {state === "pret" && <Pill tone="done">Activé sur cet ordinateur</Pill>}
      {state === "verification" && <p className="text-ink-soft">Vérification…</p>}
      {state === "a-telecharger" && (
        <>
          <Button variant="primary" onClick={() => void downloadLocalAi()}>
            <Sparkles className="size-4" /> Activer l'assistant sur cet ordinateur
          </Button>
          <p className="mt-2 text-sm text-ink-soft">
            Téléchargement unique de plusieurs gigaoctets : fais-le chez toi, en Wi-Fi.
          </p>
        </>
      )}
      {state === "telechargement" && <Pill tone="pen">Téléchargement en cours… {progress} %</Pill>}
      {state === "indisponible" && (
        <div className="space-y-2">
          <p>
            L'IA intégrée n'est pas disponible ici. Il faut <strong>Google Chrome à jour sur un ordinateur</strong>{" "}
            (pas sur téléphone), avec assez de mémoire.
          </p>
          <p className="text-ink-soft">
            En attendant, dans chaque note : « Copier pour Claude » prépare la demande avec le nom du patient masqué, tu
            la colles dans Claude, puis « Coller la réponse » la remet dans la note avec le bon prénom.
          </p>
        </div>
      )}
    </section>
  );
}
