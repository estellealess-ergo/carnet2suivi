import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { localDay, weekdayOf } from "@/lib/dates";
import { fullName } from "@/lib/labels";
import { usePatients } from "@/lib/queries";
import { Button, Input, cx } from "./ui";

export const MAX_SIDE_BY_SIDE = 3;

/**
 * Choix de plusieurs patients (jusqu'à trois) pour ouvrir leurs notes côte à côte.
 * Les patients du jour sont proposés en premier.
 */
export function PatientMultiPicker({
  initial = [],
  onConfirm,
  onCancel,
}: {
  initial?: string[];
  onConfirm: (ids: string[]) => void;
  onCancel?: () => void;
}) {
  const patients = usePatients();
  const [selected, setSelected] = useState<string[]>(initial);
  const [q, setQ] = useState("");
  const today = weekdayOf(localDay());

  const { todays, others } = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "");
    const match = (name: string) =>
      !needle || name.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "").includes(needle);
    const active = patients.filter((p) => p.status !== "archive" && match(fullName(p)));
    const todays = active
      .filter((p) => p.usual_day === today && (p.status === "actif" || p.status === "bilan"))
      .sort((a, b) => a.day_order - b.day_order);
    return { todays, others: active.filter((p) => !todays.includes(p)) };
  }, [patients, q, today]);

  const full = selected.length >= MAX_SIDE_BY_SIDE;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : full ? s : [...s, id]));

  const row = (p: (typeof patients)[number]) => {
    const checked = selected.includes(p.id);
    const order = selected.indexOf(p.id) + 1;
    return (
      <li key={p.id}>
        <label
          className={cx(
            "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5",
            checked ? "bg-pen-soft" : "hover:bg-paper",
            !checked && full && "cursor-not-allowed opacity-50",
          )}
        >
          <input
            type="checkbox"
            className="size-5 accent-[var(--color-pen)]"
            checked={checked}
            disabled={!checked && full}
            onChange={() => toggle(p.id)}
          />
          <span className="flex-1 font-semibold">{fullName(p)}</span>
          {p.usual_time && <span className="text-sm text-ink-soft">{p.usual_time}</span>}
          {checked && (
            <span className="grid size-6 place-items-center rounded-full bg-pen text-xs font-bold text-white" aria-label={`Colonne ${order}`}>
              {order}
            </span>
          )}
        </label>
      </li>
    );
  };

  return (
    <div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-ink-soft" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un patient" className="pl-9" aria-label="Rechercher" />
      </div>
      {todays.length > 0 && (
        <>
          <h3 className="mb-1 text-sm text-ink-soft">Aujourd'hui</h3>
          <ul className="mb-3">{todays.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3 className="mb-1 text-sm text-ink-soft">{todays.length ? "Autres patients" : "Patients"}</h3>
          <ul className="max-h-80 overflow-y-auto">{others.map(row)}</ul>
        </>
      )}
      <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-sheet py-3">
        <span className="mr-auto text-sm text-ink-soft">
          {selected.length} sur {MAX_SIDE_BY_SIDE} maximum
        </span>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
        )}
        <Button variant="primary" disabled={selected.length === 0} onClick={() => onConfirm(selected)}>
          Ouvrir {selected.length > 1 ? `les ${selected.length} notes` : "la note"}
        </Button>
      </div>
    </div>
  );
}
