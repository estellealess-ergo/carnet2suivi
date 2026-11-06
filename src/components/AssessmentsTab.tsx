import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type MutableRefObject } from "react";
import { fmtDay } from "@/lib/dates";
import { useAssessments } from "@/lib/queries";
import { create, remove, update } from "@/lib/repo";
import type { Assessment, Patient } from "@/lib/types";
import { Button, Empty, Field, Input, Modal, Textarea, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

const FIELDS = [
  ["reason", "Motif du bilan"],
  ["tests_used", "Outils et tests utilisés"],
  ["results", "Résultats"],
  ["observations", "Observations cliniques"],
  ["synthesis", "Synthèse"],
  ["recommendations", "Préconisations"],
] as const;

type Values = Pick<Assessment, "assessment_date" | (typeof FIELDS)[number][0]>;

export function AssessmentsTab({ patient }: { patient: Patient }) {
  const list = useAssessments(patient.id);
  const [editing, setEditing] = useState<Assessment | "new" | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  return (
    <>
      <Button variant="primary" className="mb-5" onClick={() => setEditing("new")}>
        <Plus className="size-4" /> Nouveau bilan
      </Button>
      {list.length === 0 ? (
        <Empty>Aucun bilan enregistré.</Empty>
      ) : (
        <ol className="space-y-4">
          {list.map((a) => (
            <li key={a.id} className="rounded-lg border border-rule bg-sheet">
              <div className="flex items-center gap-2 border-b border-rule px-4 py-2">
                <h3>Bilan du {fmtDay(a.assessment_date)}</h3>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                    <Pencil className="size-4" /> Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Supprimer le bilan"
                    onClick={async () => {
                      if (!window.confirm("Supprimer ce bilan ?")) return;
                      await remove("assessments", a.id);
                      toast("Bilan supprimé");
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </div>
              <dl className="divide-y divide-rule px-4">
                {FIELDS.filter(([k]) => a[k]).map(([k, label]) => (
                  <div key={k} className="grid gap-1 py-2 sm:grid-cols-[13rem_1fr]">
                    <dt className="font-semibold">{label}</dt>
                    <dd className="whitespace-pre-wrap">{a[k]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
      <Modal
        open={editing !== null}
        onClose={() => closeRef.current?.()}
        title={editing === "new" ? "Nouveau bilan" : "Modifier le bilan"}
        wide
      >
        {editing !== null && (
          <AssessmentForm
            patientId={patient.id}
            assessment={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
            closeRef={closeRef}
          />
        )}
      </Modal>
    </>
  );
}

function AssessmentForm({
  patientId,
  assessment,
  onDone,
  closeRef,
}: {
  patientId: string;
  assessment: Assessment | null;
  onDone: () => void;
  closeRef: MutableRefObject<(() => void) | null>;
}) {
  const initial: Values = {
    // Pas de date imposée : elle est choisie à la saisie.
    assessment_date: assessment?.assessment_date ?? null,
    reason: assessment?.reason ?? null,
    tests_used: assessment?.tests_used ?? null,
    results: assessment?.results ?? null,
    observations: assessment?.observations ?? null,
    synthesis: assessment?.synthesis ?? null,
    recommendations: assessment?.recommendations ?? null,
  };
  const [v, setV] = useState<Values>(initial);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const save = async () => {
    if (!v.assessment_date) {
      toast("Choisis la date du bilan.", "error");
      return false;
    }
    if (assessment) await update("assessments", assessment.id, v);
    else await create("assessments", { patient_id: patientId, ...v });
    toast("Bilan enregistré");
    onDone();
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "Bilan", onSave: save });
  closeRef.current = () => guard.askBeforeClose(onDone);

  return (
    <div className="space-y-3">
      <Field label="Date du bilan" className="w-48">
        <Input type="date" value={v.assessment_date ?? ""} onChange={(e) => setV({ ...v, assessment_date: e.target.value || null })} />
      </Field>
      {FIELDS.map(([k, label]) => (
        <Field key={k} label={label}>
          <Textarea value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value || null })} className="min-h-20" />
        </Field>
      ))}
      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-rule bg-sheet px-5 py-3">
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Annuler
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Enregistrer le bilan
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}
