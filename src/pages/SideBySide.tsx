import { Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { PinnedInfo } from "@/components/bits";
import { NoteEditor } from "@/components/NoteEditor";
import { MAX_SIDE_BY_SIDE, PatientMultiPicker } from "@/components/PatientMultiPicker";
import { Button, Modal, PageHeader, cx } from "@/components/ui";
import { fullName } from "@/lib/labels";
import { usePatients } from "@/lib/queries";
import type { Patient } from "@/lib/types";

/** Jusqu'à six notes de séance ouvertes en même temps (séances de groupe, enchaînements). */
export function SideBySide() {
  const patients = usePatients();
  const [params, setParams] = useSearchParams();
  const [picking, setPicking] = useState(false);
  const columns = (params.get("p") ?? "").split(",").filter((id) => id && id !== "-");
  // Date de la séance (ex. groupe ouvert depuis une autre journée) ; sinon la date du jour.
  const date = params.get("date") ?? undefined;

  const setSlots = (next: string[]) =>
    setParams(next.length ? { p: next.slice(0, MAX_SIDE_BY_SIDE).join(","), ...(date ? { date } : {}) } : {}, { replace: true });

  if (columns.length === 0)
    return (
      <>
        <PageHeader title="Notes côte à côte" subtitle="Coche jusqu'à six patients pour ouvrir leurs notes de séance ensemble." />
        <div className="max-w-xl rounded-lg border border-rule bg-sheet p-4">
          <PatientMultiPicker onConfirm={setSlots} />
        </div>
      </>
    );

  return (
    <>
      <PageHeader
        title="Notes côte à côte"
        subtitle={`${columns.length} note${columns.length > 1 ? "s" : ""} ouverte${columns.length > 1 ? "s" : ""}`}
        actions={
          <Button onClick={() => setPicking(true)}>
            <Users className="size-4" /> {columns.length < MAX_SIDE_BY_SIDE ? "Ajouter ou changer des patients" : "Changer de patients"}
          </Button>
        }
      />
      {/* Une, deux ou trois notes par ligne selon la largeur de l'écran ; au-delà, une deuxième ligne. */}
      <div
        className={cx(
          "grid gap-4",
          columns.length === 2 && "lg:grid-cols-2",
          columns.length >= 3 && "md:grid-cols-2 xl:grid-cols-3",
        )}
      >
        {columns.map((id, i) => (
          <Column
            key={id}
            patient={patients.find((p) => p.id === id) ?? null}
            onClose={() => setSlots(columns.filter((_, j) => j !== i))}
            defaultDate={date}
          />
        ))}
      </div>
      <Modal open={picking} onClose={() => setPicking(false)} title="Patients des notes côte à côte">
        {picking && (
          <PatientMultiPicker
            initial={columns}
            onCancel={() => setPicking(false)}
            onConfirm={(ids) => {
              setPicking(false);
              setSlots(ids);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function Column({ patient, onClose, defaultDate }: { patient: Patient | null; onClose: () => void; defaultDate?: string }) {
  const closeRef = useRef<(() => void) | null>(null);
  if (!patient) return null;
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-rule bg-sheet p-3">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate">{fullName(patient)}</h2>
        <Button size="sm" variant="ghost" aria-label="Fermer cette note" onClick={() => (closeRef.current ? closeRef.current() : onClose())}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="mb-3">
        <PinnedInfo patient={patient} editable={false} />
      </div>
      <NoteEditor patient={patient} onDone={onClose} closeRef={closeRef} compact defaultDate={defaultDate} />
    </section>
  );
}
