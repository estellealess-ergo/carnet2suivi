import { ArrowDown, ArrowUp, CalendarPlus, Columns3, GripVertical, NotebookPen } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ForecastForm, ForecastRow, PinnedInfo } from "@/components/bits";
import { NoteModal, sanitize } from "@/components/NoteEditor";
import { MAX_SIDE_BY_SIDE } from "@/components/PatientMultiPicker";
import { Button, Empty, PageHeader, Pill, Select, cx } from "@/components/ui";
import { WEEKDAYS, fmtDay, localDay, weekdayOf } from "@/lib/dates";
import { PLACE_LABEL, fullName } from "@/lib/labels";
import { useForecasts, useNotes, usePatients } from "@/lib/queries";
import { update } from "@/lib/repo";
import type { Patient, Weekday } from "@/lib/types";

export function Journee() {
  const [day, setDay] = useState<Weekday>(weekdayOf(localDay()));
  const patients = usePatients();
  const forecasts = useForecasts();
  const [noteFor, setNoteFor] = useState<Patient | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const navigate = useNavigate();
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_SIDE_BY_SIDE ? s : [...s, id]));

  const list = useMemo(
    () =>
      patients
        .filter((p) => p.usual_day === day && (p.status === "actif" || p.status === "bilan"))
        .sort((a, b) => a.day_order - b.day_order || (a.usual_time ?? "").localeCompare(b.usual_time ?? "")),
    [patients, day],
  );

  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    await Promise.all(next.map((p, i) => (p.day_order !== i ? update("patients", p.id, { day_order: i }) : null)));
  }

  return (
    <>
      <PageHeader
        title="Ma journée"
        subtitle={`${list.length} patient${list.length > 1 ? "s" : ""} le ${day.toLowerCase()}`}
        actions={
          <Select value={day} onChange={(e) => setDay(e.target.value as Weekday)} className="w-40" aria-label="Jour affiché">
            {WEEKDAYS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        }
      />

      {list.length === 0 ? (
        <Empty action={<Link to="/patients" className="font-semibold text-pen hover:underline">Ouvrir la liste des patients</Link>}>
          Aucun patient suivi le {day.toLowerCase()}. Indique le « jour de suivi » dans la fiche d'un patient pour qu'il
          apparaisse ici.
        </Empty>
      ) : (
        <ol className="space-y-4">
          {list.map((p, i) => (
            <li
              key={p.id}
              draggable
              onDragStart={() => setDragId(p.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = list.findIndex((x) => x.id === dragId);
                if (from >= 0) void reorder(from, i);
                setDragId(null);
              }}
              className={cx("rounded-lg border border-rule bg-sheet", dragId === p.id && "opacity-50")}
            >
              <DayCard
                patient={p}
                forecasts={forecasts.filter((f) => f.patient_id === p.id && f.status === "a_faire")}
                onNote={() => setNoteFor(p)}
                onMove={(dir) => void reorder(i, i + dir)}
                selected={selected.includes(p.id)}
                selectable={selected.includes(p.id) || selected.length < MAX_SIDE_BY_SIDE}
                onToggle={() => toggle(p.id)}
                first={i === 0}
                last={i === list.length - 1}
              />
            </li>
          ))}
        </ol>
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

      <NoteModal patient={noteFor} onDone={() => setNoteFor(null)} />
    </>
  );
}

function DayCard({
  patient: p,
  forecasts,
  onNote,
  onMove,
  first,
  last,
  selected,
  selectable,
  onToggle,
}: {
  patient: Patient;
  forecasts: ReturnType<typeof useForecasts>;
  onNote: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
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
        {p.usual_time && <Pill tone="pen">{p.usual_time}</Pill>}
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
          <Select
            value={p.usual_day ?? ""}
            onChange={(e) => void update("patients", p.id, { usual_day: e.target.value as Weekday, day_order: 99 })}
            className="w-auto"
            aria-label="Changer le jour de suivi"
          >
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {d === p.usual_day ? `Suivi le ${d.toLowerCase()}` : `Déplacer au ${d.toLowerCase()}`}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}
