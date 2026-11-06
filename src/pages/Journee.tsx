import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Columns3,
  GripVertical,
  NotebookPen,
  Undo2,
  UserPlus,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ForecastForm, ForecastRow, PinnedInfo } from "@/components/bits";
import { NoteModal, sanitize } from "@/components/NoteEditor";
import { MAX_SIDE_BY_SIDE } from "@/components/PatientMultiPicker";
import { Button, Empty, Field, Input, Modal, PageHeader, Pill, Select, cx, toast } from "@/components/ui";
import { WEEKDAYS, addDays, fmtDay, fmtLongDay, localDay, relativeDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { PLACE_LABEL, fullName } from "@/lib/labels";
import { useForecasts, useNotes, usePatients } from "@/lib/queries";
import { create, remove, update } from "@/lib/repo";
import { patientsForDay, weekParity, type DayEntry } from "@/lib/schedule";
import type { Patient, Weekday } from "@/lib/types";

/**
 * Ma journée, date par date : les patients du jour de suivi (y compris le rythme une semaine
 * sur deux), moins les séances annulées, plus les séances ajoutées pour cette date.
 */
export function Journee() {
  const [params, setParams] = useSearchParams();
  const today = localDay();
  const day = params.get("date") ?? today;
  const setDay = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true });

  const patients = usePatients();
  const forecasts = useForecasts();
  const changes = useLiveQuery(() => db.day_changes.where("day").equals(day).toArray(), [day]) ?? [];
  const [noteFor, setNoteFor] = useState<Patient | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_SIDE_BY_SIDE ? s : [...s, id]));

  const { entries, cancelled } = useMemo(() => patientsForDay(patients, changes, day), [patients, changes, day]);

  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= entries.length) return;
    const next = entries.map((e) => e.patient);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    await Promise.all(next.map((p, i) => (p.day_order !== i ? update("patients", p.id, { day_order: i }) : null)));
  }

  const changeFor = (patientId: string, kind: "ajout" | "annulation") =>
    changes.find((c) => c.patient_id === patientId && c.kind === kind && !c.deleted_at);

  return (
    <>
      <PageHeader
        title="Ma journée"
        subtitle={
          <span className="first-letter:uppercase">
            {relativeDay(day, today)} · {fmtLongDay(day)} · semaine {weekParity(day)} · {entries.length} patient
            {entries.length > 1 ? "s" : ""}
          </span>
        }
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => setDay(addDays(day, -1))} aria-label="Jour précédent">
              <ChevronLeft className="size-5" />
            </Button>
            <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" aria-label="Date affichée" />
            <Button variant="ghost" onClick={() => setDay(addDays(day, 1))} aria-label="Jour suivant">
              <ChevronRight className="size-5" />
            </Button>
            {day !== today && <Button onClick={() => setDay(today)}>Aujourd'hui</Button>}
          </div>
        }
      />

      {entries.length === 0 ? (
        <Empty
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" /> Ajouter un patient ce jour-là
            </Button>
          }
        >
          Aucun patient prévu ce jour-là. Le « jour de suivi » de la fiche patient fait apparaître un patient ici
          chaque semaine (ou une semaine sur deux).
        </Empty>
      ) : (
        <ol className="space-y-4">
          {entries.map((entry, i) => (
            <li
              key={entry.patient.id}
              draggable
              onDragStart={() => setDragId(entry.patient.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = entries.findIndex((x) => x.patient.id === dragId);
                if (from >= 0) void reorder(from, i);
                setDragId(null);
              }}
              className={cx("rounded-lg border border-rule bg-sheet", dragId === entry.patient.id && "opacity-50")}
            >
              <DayCard
                entry={entry}
                forecasts={forecasts.filter((f) => f.patient_id === entry.patient.id && f.status === "a_faire")}
                onNote={() => setNoteFor(entry.patient)}
                onMove={(dir) => void reorder(i, i + dir)}
                selected={selected.includes(entry.patient.id)}
                selectable={selected.includes(entry.patient.id) || selected.length < MAX_SIDE_BY_SIDE}
                onToggle={() => toggle(entry.patient.id)}
                first={i === 0}
                last={i === entries.length - 1}
                onCancel={async () => {
                  if (entry.added) {
                    const c = changeFor(entry.patient.id, "ajout");
                    if (c) await remove("day_changes", c.id);
                    toast("Séance retirée de cette journée");
                  } else {
                    await create("day_changes", { patient_id: entry.patient.id, day, kind: "annulation", time: null });
                    toast(`Pas de séance pour ${entry.patient.first_name} ce jour-là`);
                  }
                }}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {entries.length > 0 && (
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> Ajouter un patient ce jour-là
          </Button>
        )}
      </div>

      {cancelled.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-base text-ink-soft">Pas de séance ce jour-là</h2>
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet px-4">
            {cancelled.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="flex-1 text-ink-soft line-through">{fullName(p)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const c = changeFor(p.id, "annulation");
                    if (c) await remove("day_changes", c.id);
                  }}
                >
                  <Undo2 className="size-4" /> Rétablir la séance
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-sheet p-3 shadow-lg">
          <span className="mr-auto text-sm">
            {selected.length} patient{selected.length > 1 ? "s" : ""} sélectionné{selected.length > 1 ? "s" : ""}
            {selected.length >= MAX_SIDE_BY_SIDE && " (maximum)"}
          </span>
          <Button variant="ghost" onClick={() => setSelected([])}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => navigate(`/notes?p=${selected.join(",")}`)}>
            <Columns3 className="size-4" /> Ouvrir les notes côte à côte
          </Button>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title={`Ajouter une séance le ${fmtDay(day)}`}>
        {adding && (
          <AddToDay
            patients={patients.filter((p) => p.status !== "archive" && !entries.some((e) => e.patient.id === p.id))}
            onAdd={async (patientId, time) => {
              const cancel = changeFor(patientId, "annulation");
              if (cancel) await remove("day_changes", cancel.id);
              else await create("day_changes", { patient_id: patientId, day, kind: "ajout", time: time || null });
              setAdding(false);
              toast("Séance ajoutée à cette journée");
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Modal>

      <NoteModal patient={noteFor} defaultDate={day} onDone={() => setNoteFor(null)} />
    </>
  );
}

function AddToDay({
  patients,
  onAdd,
  onCancel,
}: {
  patients: Patient[];
  onAdd: (patientId: string, time: string) => void;
  onCancel: () => void;
}) {
  const [pid, setPid] = useState("");
  const [time, setTime] = useState("");
  return (
    <div className="space-y-3">
      <Field label="Patient">
        <Select value={pid} onChange={(e) => setPid(e.target.value)} autoFocus>
          <option value="">Choisir…</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {fullName(p)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Heure" hint="Facultative">
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-40" />
      </Field>
      <p className="text-sm text-ink-soft">Pour un changement définitif, modifie plutôt le jour de suivi dans la fiche.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button variant="primary" disabled={!pid} onClick={() => onAdd(pid, time)}>
          Ajouter la séance
        </Button>
      </div>
    </div>
  );
}

function DayCard({
  entry,
  forecasts,
  onNote,
  onMove,
  first,
  last,
  selected,
  selectable,
  onToggle,
  onCancel,
}: {
  entry: DayEntry;
  forecasts: ReturnType<typeof useForecasts>;
  onNote: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const p = entry.patient;
  const [addForecast, setAddForecast] = useState(false);
  const notes = useNotes(p.id).filter((n) => n.kind === "seance");
  const lastNote = notes[0];
  return (
    <div className="p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <GripVertical className="size-5 cursor-grab text-ink-soft" aria-hidden />
        <input
          type="checkbox"
          className="size-5 accent-[var(--color-pen)]"
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          aria-label={`Choisir ${fullName(p)} pour les notes côte à côte`}
          title="Choisir pour les notes côte à côte"
        />
        <Link to={`/patients/${p.id}`} className="text-lg font-bold hover:underline">
          {fullName(p)}
        </Link>
        {entry.time && <Pill tone="pen">{entry.time}</Pill>}
        {entry.added && <Pill>Séance ajoutée</Pill>}
        {p.frequency === "bimensuel" && !entry.added && <Pill>1 semaine sur 2</Pill>}
        {p.status === "bilan" && <Pill>Bilan</Pill>}
        <span className="text-sm text-ink-soft">
          {[p.school_class, p.usual_place ? PLACE_LABEL[p.usual_place] : null].filter(Boolean).join(", ")}
        </span>
        <span className="ml-auto flex">
          <Button size="sm" variant="ghost" disabled={first} onClick={() => onMove(-1)} aria-label="Monter">
            <ArrowUp className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" disabled={last} onClick={() => onMove(1)} aria-label="Descendre">
            <ArrowDown className="size-4" />
          </Button>
        </span>
      </div>

      <div className="mt-3 sm:pl-7">
        <PinnedInfo patient={p} />

        {forecasts.length > 0 && (
          <div className="mt-3">
            <h3 className="text-sm text-ink-soft">Prévu</h3>
            <ul className="divide-y divide-rule">
              {forecasts.map((f) => (
                <ForecastRow key={f.id} f={f} />
              ))}
            </ul>
          </div>
        )}

        {lastNote && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-ink-soft">Dernière séance : {fmtDay(lastNote.note_date)}</summary>
            <div className="prose-note mt-2 border-l-2 border-rule pl-3 text-sm" dangerouslySetInnerHTML={{ __html: sanitize(lastNote.content_html) }} />
          </details>
        )}

        {addForecast && (
          <div className="mt-3">
            <ForecastForm patientId={p.id} onDone={() => setAddForecast(false)} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onNote}>
            <NotebookPen className="size-4" /> Note de séance
          </Button>
          {!addForecast && (
            <Button onClick={() => setAddForecast(true)}>
              <CalendarPlus className="size-4" /> La prochaine fois
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel}>
            <CalendarX className="size-4" /> {entry.added ? "Retirer de cette journée" : "Pas de séance ce jour-là"}
          </Button>
          {!entry.added && (
            <Select
              value={p.usual_day ?? ""}
              onChange={(e) => void update("patients", p.id, { usual_day: e.target.value as Weekday, day_order: 99 })}
              className="w-auto"
              aria-label="Changer le jour de suivi"
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {d === p.usual_day ? `Suivi le ${d.toLowerCase()}` : `Désormais le ${d.toLowerCase()}`}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}
