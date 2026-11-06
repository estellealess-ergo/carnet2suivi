import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PatientForm } from "@/components/PatientForm";
import { Button, Empty, Input, Modal, PageHeader, Pill, Select, cx } from "@/components/ui";
import { ageFrom } from "@/lib/dates";
import { STATUS_LABEL, fullName, initials } from "@/lib/labels";
import { usePatients } from "@/lib/queries";
import { update } from "@/lib/repo";
import type { PatientStatus } from "@/lib/types";

type Filter = "suivis" | "tous" | PatientStatus;

export function Patients() {
  const patients = usePatients();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("suivis");
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "");
    return patients.filter((p) => {
      if (filter === "suivis" && !["actif", "bilan"].includes(p.status)) return false;
      if (filter !== "suivis" && filter !== "tous" && p.status !== filter) return false;
      if (!needle) return true;
      return `${p.first_name} ${p.last_name}`.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "").includes(needle);
    });
  }, [patients, q, filter]);

  // Le tri manuel s'applique à la liste complète, pour rester stable quel que soit le filtre.
  async function move(id: string, targetId: string) {
    if (id === targetId) return;
    const all = [...patients];
    const from = all.findIndex((p) => p.id === id);
    const to = all.findIndex((p) => p.id === targetId);
    const [m] = all.splice(from, 1);
    all.splice(to, 0, m!);
    await Promise.all(all.map((p, i) => (p.sort_order !== i ? update("patients", p.id, { sort_order: i }) : null)));
  }

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={`${list.length} affiché${list.length > 1 ? "s" : ""} sur ${patients.length}`}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nouveau patient
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-ink-soft" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un patient" className="pl-9" aria-label="Rechercher" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-56" aria-label="Filtrer">
          <option value="suivis">Suivis et bilans en cours</option>
          <option value="tous">Tous les patients</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      {patients.length === 0 ? (
        <Empty action={<Button variant="primary" onClick={() => setCreating(true)}>Créer le premier patient</Button>}>
          Aucun patient pour l'instant.
        </Empty>
      ) : list.length === 0 ? (
        <Empty>Aucun patient ne correspond à cette recherche.</Empty>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
          {list.map((p, i) => {
            const age = ageFrom(p.birth_date);
            return (
              <li
                key={p.id}
                draggable={!q}
                onDragStart={() => setDragId(p.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) void move(dragId, p.id);
                }}
                className={cx("flex items-center gap-3 px-3 py-2.5", dragId === p.id && "opacity-50")}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pen-soft text-sm font-bold text-pen" aria-hidden>
                  {initials(p)}
                </span>
                <Link to={`/patients/${p.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-semibold hover:underline">{fullName(p)}</span>
                  <span className="block truncate text-sm text-ink-soft">
                    {[age !== null ? `${age} ans` : null, p.school_class, p.usual_day ? `${p.usual_day}${p.usual_time ? ` ${p.usual_time}` : ""}` : null]
                      .filter(Boolean)
                      .join(", ") || "Fiche à compléter"}
                  </span>
                </Link>
                {p.status !== "actif" && <Pill>{STATUS_LABEL[p.status]}</Pill>}
                {!q && (
                  <span className="flex">
                    <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => void move(p.id, list[i - 1]!.id)} aria-label={`Monter ${fullName(p)}`}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={i === list.length - 1} onClick={() => void move(p.id, list[i + 1]!.id)} aria-label={`Descendre ${fullName(p)}`}>
                      <ArrowDown className="size-4" />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateModal open={creating} onDone={(id) => { setCreating(false); if (id) navigate(`/patients/${id}`); }} nextSortOrder={patients.length} />
    </>
  );
}

function CreateModal({ open, onDone, nextSortOrder }: { open: boolean; onDone: (id?: string) => void; nextSortOrder: number }) {
  const closeRef = useRef<(() => void) | null>(null);
  return (
    <Modal open={open} onClose={() => closeRef.current?.()} title="Nouveau patient" wide>
      <PatientForm onDone={(p) => onDone(p?.id)} nextSortOrder={nextSortOrder} closeRef={closeRef} />
    </Modal>
  );
}
