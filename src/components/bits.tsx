import { Check, Pencil, Pin, Trash2 } from "lucide-react";
import { useState } from "react";
import { fmtDay, relativeDay } from "@/lib/dates";
import { create, remove, update } from "@/lib/repo";
import type { Forecast, Patient, Task } from "@/lib/types";
import { Button, Field, Input, Pill, Textarea, cx, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

/** « À ne pas oublier » : surligné en jaune, toujours en haut. */
export function PinnedInfo({ patient, editable = true }: { patient: Patient; editable?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(patient.pinned_info ?? "");
  const dirty = editing && text !== (patient.pinned_info ?? "");
  const save = async () => {
    await update("patients", patient.id, { pinned_info: text.trim() || null });
    setEditing(false);
    toast("Information épinglée enregistrée");
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "À ne pas oublier", onSave: save });

  if (editing) {
    return (
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ce qu'il faut toujours avoir sous les yeux pour ce patient…"
          className="min-h-16"
          autoFocus
        />
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => void save()}>
            Enregistrer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => guard.askBeforeClose(() => { setText(patient.pinned_info ?? ""); setEditing(false); })}>
            Annuler
          </Button>
        </div>
        {guard.dialog}
      </div>
    );
  }
  if (!patient.pinned_info) {
    return editable ? (
      <button type="button" className="inline-flex items-start gap-1.5 text-left text-sm text-ink-soft hover:text-ink" onClick={() => setEditing(true)}>
        <Pin className="size-4" /> Ajouter une information à ne pas oublier
      </button>
    ) : null;
  }
  return (
    <div className="flex items-start gap-2">
      <Pin className="mt-1 size-4 shrink-0 text-marker-ink" aria-label="À ne pas oublier" />
      <p className="flex-1 whitespace-pre-wrap">
        <span className="marker px-1 py-0.5 font-semibold">{patient.pinned_info}</span>
      </p>
      {editable && (
        <Button size="sm" variant="ghost" onClick={() => { setText(patient.pinned_info ?? ""); setEditing(true); }} aria-label="Modifier l'information épinglée">
          <Pencil className="size-4" />
        </Button>
      )}
    </div>
  );
}

export function DueLabel({ day, done }: { day: string | null; done?: boolean }) {
  if (!day) return <Pill>Sans date</Pill>;
  const rel = relativeDay(day);
  const late = !done && rel.startsWith("En retard");
  return (
    <Pill tone={late ? "late" : rel === "Aujourd'hui" ? "pen" : "neutral"}>
      {rel === "Aujourd'hui" || rel === "Demain" || rel === "Après-demain" || late ? rel : fmtDay(day)}
    </Pill>
  );
}

/** Ajout d'une prévision. La date est choisie par l'utilisateur (jamais imposée). */
export function ForecastForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [content, setContent] = useState("");
  const [day, setDay] = useState("");
  const save = async () => {
    if (!content.trim()) return false;
    if (!day) {
      toast("Choisis la date prévue.", "error");
      return false;
    }
    await create("forecasts", { patient_id: patientId, content: content.trim(), planned_date: day, status: "a_faire", note_id: null });
    toast("Prévision ajoutée");
    onDone();
    return true;
  };
  const guard = useUnsavedGuard({ dirty: content.trim() !== "", label: "Nouvelle prévision", onSave: save });
  return (
    <div className="space-y-2 rounded-md border border-rule bg-paper p-3">
      <Field label="Prévu pour la prochaine fois">
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-16" autoFocus />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Date prévue" className="w-44">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={() => void save()} disabled={!content.trim()}>
          Ajouter la prévision
        </Button>
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Annuler
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}

export function ForecastRow({ f, patientName }: { f: Forecast; patientName?: string }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(f.content);
  const [day, setDay] = useState(f.planned_date ?? "");
  const dirty = editing && (content !== f.content || day !== (f.planned_date ?? ""));
  const save = async () => {
    await update("forecasts", f.id, { content: content.trim(), planned_date: day || null });
    setEditing(false);
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "Prévision", onSave: save });
  if (editing) {
    return (
      <li className="space-y-2 py-2">
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-14" />
        <div className="flex flex-wrap items-end gap-2">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" aria-label="Date prévue" />
          <Button size="sm" variant="primary" onClick={() => void save()}>Enregistrer</Button>
          <Button size="sm" variant="ghost" onClick={() => guard.askBeforeClose(() => setEditing(false))}>Annuler</Button>
        </div>
        {guard.dialog}
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p>
          {patientName && <strong>{patientName} : </strong>}
          {f.content}
        </p>
        <div className="mt-1">
          <DueLabel day={f.planned_date} />
        </div>
      </div>
      <span className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Modifier la prévision">
          <Pencil className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Retirer la prévision"
          onClick={async () => {
            await update("forecasts", f.id, { status: "abandonnee" });
            toast("Prévision retirée");
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </span>
    </li>
  );
}

/** Ajout d'une tâche « à préparer ». */
export function TaskForm({ patientId, onDone }: { patientId: string | null; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [urgent, setUrgent] = useState(false);
  const save = async () => {
    if (!title.trim()) return false;
    await create("tasks", { patient_id: patientId, title: title.trim(), due_date: day || null, status: "a_faire", urgent, details: null });
    toast("Tâche ajoutée");
    onDone();
    return true;
  };
  const guard = useUnsavedGuard({ dirty: title.trim() !== "", label: "Nouvelle tâche", onSave: save });
  return (
    <div className="space-y-2 rounded-md border border-rule bg-paper p-3">
      <Field label="Tâche">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Ex. préparer le jeu de mémoire visuelle" />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Échéance" className="w-44" hint="Facultative">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <label className="mb-6 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="size-4 accent-[var(--color-late)]" />
          Urgent
        </label>
        <div className="mb-6 flex gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={!title.trim()}>
            Ajouter la tâche
          </Button>
          <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
            Annuler
          </Button>
        </div>
      </div>
      {guard.dialog}
    </div>
  );
}

export function TaskRow({
  t,
  patientName,
  hideDate,
}: {
  t: Task;
  patientName?: string | undefined;
  hideDate?: boolean;
}) {
  const done = t.status === "fait";
  return (
    <li className="flex items-start gap-3 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Marquer comme à faire" : "Marquer comme fait"}
        onClick={() => void update("tasks", t.id, { status: done ? "a_faire" : "fait" })}
        className={cx(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded border-2",
          done ? "border-done bg-done text-white" : "border-rule hover:border-pen",
        )}
      >
        {done && <Check className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cx(done && "text-ink-soft line-through")}>
          {patientName && <strong>{patientName} : </strong>}
          {t.title}
        </p>
        {((t.urgent && !done) || !hideDate) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {t.urgent && !done && <Pill tone="late">Urgent</Pill>}
            {!hideDate && <TaskDate t={t} />}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Supprimer la tâche"
        onClick={async () => {
          await remove("tasks", t.id);
          toast("Tâche supprimée");
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

/** La date d'une tâche reste modifiable en un clic. */
function TaskDate({ t }: { t: Task }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <Input
        type="date"
        autoFocus
        className="h-8 w-40"
        defaultValue={t.due_date ?? ""}
        onBlur={(e) => {
          void update("tasks", t.id, { due_date: e.target.value || null });
          setEditing(false);
        }}
        aria-label="Échéance"
      />
    );
  return (
    <button type="button" onClick={() => setEditing(true)} title="Changer la date">
      <DueLabel day={t.due_date} done={t.status === "fait"} />
    </button>
  );
}
