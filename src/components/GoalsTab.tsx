import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState, type MutableRefObject } from "react";
import { askAssistant, assistantAvailable } from "@/lib/assistant";
import { fmtDay, localDay } from "@/lib/dates";
import { GOAL_STATUS_LABEL } from "@/lib/labels";
import { useGoalProgress, useGoals, useNotes } from "@/lib/queries";
import { create, remove, update } from "@/lib/repo";
import type { Goal, GoalStatus, Patient } from "@/lib/types";
import { Button, Empty, Field, Input, Modal, Pill, Select, Textarea, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

export function GoalsTab({ patient }: { patient: Patient }) {
  const goals = useGoals(patient.id);
  const progress = useGoalProgress(patient.id);
  const notes = useNotes(patient.id).filter((n) => n.kind === "seance");
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [rating, setRating] = useState<Goal | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const today = localDay();
  const toReview = goals.filter((g) => g.status === "en_cours" && g.review_date && g.review_date <= today);

  return (
    <>
      <Button variant="primary" className="mb-5" onClick={() => setEditing("new")}>
        <Plus className="size-4" /> Nouvel objectif
      </Button>
      {toReview.length > 0 && (
        <p className="mb-4 rounded-md bg-late-soft p-3 text-late">
          {toReview.length} objectif{toReview.length > 1 ? "s" : ""} à réévaluer.
        </p>
      )}
      {goals.length === 0 ? (
        <Empty>Aucun objectif défini.</Empty>
      ) : (
        <ol className="space-y-3">
          {goals.map((g) => {
            const history = progress.filter((p) => p.goal_id === g.id);
            return (
              <li key={g.id} className="rounded-lg border border-rule bg-sheet p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <h3 className="min-w-0 flex-1">{g.title}</h3>
                  <Pill tone={g.status === "atteint" ? "done" : g.status === "en_cours" ? "pen" : "neutral"}>
                    {GOAL_STATUS_LABEL[g.status]}
                  </Pill>
                </div>
                {g.smart_statement && <p className="mt-1 text-ink-soft">{g.smart_statement}</p>}
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={g.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement">
                    <div className="h-full rounded-full bg-pen" style={{ width: `${g.progress}%` }} />
                  </div>
                  <span className="w-12 text-right font-semibold tabular-nums">{g.progress} %</span>
                </div>
                {(() => {
                  const worked = notes.filter((n) => n.goal_ids?.includes(g.id));
                  return (
                    <p className="mt-2 text-sm">
                      {worked.length === 0
                        ? "Pas encore coché dans une note de séance."
                        : `Travaillé en ${worked.length} séance${worked.length > 1 ? "s" : ""}, la dernière le ${fmtDay(worked[0]!.note_date)}.`}
                    </p>
                  );
                })()}
                <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-ink-soft">
                  {g.target_date && <span>Échéance : {fmtDay(g.target_date)}</span>}
                  {g.review_date && <span>À réévaluer le {fmtDay(g.review_date)}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => setRating(g)}>
                    Noter l'avancement
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>
                    <Pencil className="size-4" /> Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Supprimer l'objectif"
                    onClick={async () => {
                      if (!window.confirm("Supprimer cet objectif ?")) return;
                      await remove("goals", g.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {history.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-ink-soft">Évolution ({history.length})</summary>
                    <ul className="mt-1 space-y-1 text-sm">
                      {history.map((h) => (
                        <li key={h.id}>
                          <strong>{fmtDay(h.recorded_on)}</strong> : {h.progress} %{h.comment ? `, ${h.comment}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Modal open={editing !== null} onClose={() => closeRef.current?.()} title={editing === "new" ? "Nouvel objectif" : "Modifier l'objectif"} wide>
        {editing !== null && (
          <GoalForm patient={patient} goal={editing === "new" ? null : editing} nextOrder={goals.length} onDone={() => setEditing(null)} closeRef={closeRef} />
        )}
      </Modal>
      <Modal open={rating !== null} onClose={() => setRating(null)} title="Noter l'avancement">
        {rating && <ProgressForm goal={rating} onDone={() => setRating(null)} />}
      </Modal>
    </>
  );
}

function GoalForm({
  patient,
  goal,
  nextOrder,
  onDone,
  closeRef,
}: {
  patient: Patient;
  goal: Goal | null;
  nextOrder: number;
  onDone: () => void;
  closeRef: MutableRefObject<(() => void) | null>;
}) {
  const initial = {
    title: goal?.title ?? "",
    smart_statement: goal?.smart_statement ?? "",
    status: goal?.status ?? ("en_cours" as GoalStatus),
    target_date: goal?.target_date ?? "",
    review_date: goal?.review_date ?? "",
  };
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const save = async () => {
    if (!v.title.trim()) {
      toast("Donne un intitulé à l'objectif.", "error");
      return false;
    }
    const values = {
      title: v.title.trim(),
      smart_statement: v.smart_statement.trim() || null,
      status: v.status,
      target_date: v.target_date || null,
      review_date: v.review_date || null,
    };
    if (goal) await update("goals", goal.id, values);
    else await create("goals", { patient_id: patient.id, progress: 0, sort_order: nextOrder, ...values });
    toast("Objectif enregistré");
    onDone();
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "Objectif", onSave: save });
  closeRef.current = () => guard.askBeforeClose(onDone);

  return (
    <div className="space-y-3">
      <Field label="Intitulé">
        <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Ex. écrire son prénom en cursive" autoFocus />
      </Field>
      <Field label="Formulation SMART" hint="Délai, action observable, contexte, niveau d'aide, critère de réussite.">
        <Textarea value={v.smart_statement} onChange={(e) => setV({ ...v, smart_statement: e.target.value })} className="min-h-20" />
      </Field>
      {assistantAvailable() && (
        <Button
          size="sm"
          disabled={busy || !(v.title || v.smart_statement).trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const out = await askAssistant("smart", `${v.title}\n${v.smart_statement}`, patient);
              setV((x) => ({ ...x, smart_statement: out }));
            } catch (e) {
              toast((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles className="size-4" /> {busy ? "Reformulation…" : "Proposer une formulation SMART"}
        </Button>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Statut">
          <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as GoalStatus })}>
            {Object.entries(GOAL_STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Échéance">
          <Input type="date" value={v.target_date} onChange={(e) => setV({ ...v, target_date: e.target.value })} />
        </Field>
        <Field label="À réévaluer le">
          <Input type="date" value={v.review_date} onChange={(e) => setV({ ...v, review_date: e.target.value })} />
        </Field>
      </div>
      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-rule bg-sheet px-5 py-3">
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Annuler
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Enregistrer l'objectif
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}

function ProgressForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [value, setValue] = useState(goal.progress);
  const [comment, setComment] = useState("");
  const [day, setDay] = useState("");
  return (
    <div className="space-y-4">
      <Field label={`Avancement : ${value} %`}>
        <input type="range" min={0} max={100} step={5} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-[var(--color-pen)]" />
      </Field>
      <Field label="Date de l'évaluation">
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-48" />
      </Field>
      <Field label="Commentaire" hint="Facultatif">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-16" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button
          variant="primary"
          onClick={async () => {
            if (!day) {
              toast("Choisis la date de l'évaluation.", "error");
              return;
            }
            await create("goal_progress", { goal_id: goal.id, patient_id: goal.patient_id, progress: value, comment: comment.trim() || null, recorded_on: day });
            await update("goals", goal.id, { progress: value, status: value === 100 ? "atteint" : goal.status });
            toast("Avancement enregistré");
            onDone();
          }}
        >
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
