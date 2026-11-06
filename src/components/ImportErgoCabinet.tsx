import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { applyImport, convert, readFiles, type Converted, type Report } from "@/lib/import-ergocabinet";
import { supabase } from "@/lib/supabase";
import { syncNow } from "@/lib/sync-controller";
import { Button, toast } from "./ui";

const LABEL: Record<string, string> = {
  patients: "patients",
  notes: "notes de séance",
  note_versions: "versions de notes",
  forecasts: "prévisions",
  tasks: "tâches",
  assessments: "bilans",
  goals: "objectifs",
  goal_progress: "évaluations d'objectifs",
  guardians: "contacts familiaux",
  communications: "échanges",
  family_reports: "comptes rendus aux familles",
};

/** Étape 4 : reprise des données exportées de l'ancien ErgoCabinet. */
export function ImportErgoCabinet() {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ data: Converted; report: Report; ignored: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="rounded-lg border border-rule bg-sheet p-5">
      <h2 className="mb-2">Reprendre les données d'ErgoCabinet</h2>
      <p className="mb-3 text-ink-soft">
        Sélectionne les fichiers exportés de l'ancienne application (un fichier par table, au format CSV ou JSON :
        patients, progress_notes, next_session_plans, tasks, assessments, goals, goal_progress, guardians,
        patient_guardians, communications, parent_reports…). Rien n'est enregistré avant ta confirmation, et refaire
        l'import ne crée pas de doublons.
      </p>
      {!supabase && (
        <p className="mb-3 rounded-md bg-late-soft p-3 text-late">
          Les dossiers repris seront enregistrés uniquement sur cet appareil. Fais une sauvegarde juste après la
          reprise, puis efface les fichiers exportés.
        </p>
      )}
      <Button onClick={() => input.current?.click()} disabled={busy}>
        <FileUp className="size-4" /> Choisir les fichiers
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".csv,.json,text/csv,application/json"
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          try {
            const { sources, ignored } = await readFiles(files);
            setPreview({ ...convert(sources), ignored });
          } catch (err) {
            toast(`Lecture impossible : ${(err as Error).message}`, "error");
          }
        }}
      />

      {preview && (
        <div className="mt-4 rounded-md border border-rule bg-paper p-4">
          <h3 className="mb-2">Ce qui va être repris</h3>
          {Object.keys(preview.report.counts).length === 0 ? (
            <p className="text-ink-soft">Aucune donnée reconnue dans ces fichiers.</p>
          ) : (
            <ul className="mb-3 list-disc pl-5">
              {Object.entries(preview.report.counts).map(([t, n]) => (
                <li key={t}>
                  {n} {LABEL[t] ?? t}
                </li>
              ))}
            </ul>
          )}
          {[...preview.report.warnings, ...preview.ignored.map((f) => `Fichier non reconnu, ignoré : ${f}`)].map((w) => (
            <p key={w} className="text-sm text-late">
              {w}
            </p>
          ))}
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={busy || Object.keys(preview.report.counts).length === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  const n = await applyImport(preview.data);
                  setPreview(null);
                  toast(`${n} élément${n > 1 ? "s" : ""} repris`);
                  void syncNow();
                } catch (err) {
                  toast((err as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reprendre ces données
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
