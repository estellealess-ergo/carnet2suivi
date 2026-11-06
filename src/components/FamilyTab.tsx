import { FileDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type MutableRefObject } from "react";
import { fmtDay } from "@/lib/dates";
import { fullName } from "@/lib/labels";
import { useFamilyReports, useGuardians } from "@/lib/queries";
import { create, remove, update } from "@/lib/repo";
import type { Guardian, Patient } from "@/lib/types";
import { FamilyAccess } from "./FamilyAccess";
import { Button, Empty, Field, Input, Modal, Pill, Select, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

/** Onglet « Famille » : responsables légaux et comptes rendus déjà transmis. */
export function FamilyTab({ patient }: { patient: Patient }) {
  const guardians = useGuardians(patient.id);
  const reports = useFamilyReports(patient.id);
  const [editing, setEditing] = useState<Guardian | "new" | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  return (
    <>
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2>Responsables légaux et proches</h2>
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Ajouter une personne
          </Button>
        </div>
        {guardians.length === 0 ? (
          <Empty>Aucun contact familial. Ajoute les parents pour leur transmettre les comptes rendus.</Empty>
        ) : (
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
            {guardians.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {[g.civility, fullName(g)].filter(Boolean).join(" ")}
                    {g.relation && <span className="font-normal text-ink-soft"> ({g.relation})</span>}
                  </p>
                  <p className="text-sm text-ink-soft">{[g.email, g.phone].filter(Boolean).join(", ") || "Aucun moyen de contact"}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {g.receives_reports && <Pill tone="pen">Reçoit les comptes rendus</Pill>}
                  </div>
                  <FamilyAccess guardian={g} />
                </div>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(g)} aria-label="Modifier">
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Retirer"
                    onClick={async () => {
                      if (!window.confirm(`Retirer ${fullName(g)} des contacts de ce patient ?`)) return;
                      await remove("guardians", g.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2>Comptes rendus transmis</h2>
          {reports.length > 0 && (
            <Button
              onClick={async () => {
                const { buildFamilyBookletDocx, downloadBlob } = await import("@/lib/export-docx");
                const blob = await buildFamilyBookletDocx(patient, reports);
                downloadBlob(blob, `Carnet de liaison - ${patient.first_name}.docx`);
              }}
            >
              <FileDown className="size-4" /> Carnet de liaison (Word)
            </Button>
          )}
        </div>
        {reports.length === 0 ? (
          <Empty>Rien n'a encore été transmis à la famille. Utilise « Envoi aux familles » après une séance.</Empty>
        ) : (
          <ol className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="rounded-lg border border-rule bg-sheet p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <strong>{fmtDay(r.report_date)}</strong>
                  {r.status === "envoye" && <Pill tone="done">Envoyé{r.sent_via ? ` par ${r.sent_via}` : ""}</Pill>}
                  {r.published && <Pill tone="pen">Dans l'espace famille</Pill>}
                  {r.status === "brouillon" && !r.published && <Pill>Brouillon</Pill>}
                </div>
                <p className="whitespace-pre-wrap">{r.content}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Modal open={editing !== null} onClose={() => closeRef.current?.()} title={editing === "new" ? "Nouveau contact familial" : "Modifier le contact"}>
        {editing !== null && (
          <GuardianForm patientId={patient.id} guardian={editing === "new" ? null : editing} onDone={() => setEditing(null)} closeRef={closeRef} />
        )}
      </Modal>
    </>
  );
}

function GuardianForm({
  patientId,
  guardian,
  onDone,
  closeRef,
}: {
  patientId: string;
  guardian: Guardian | null;
  onDone: () => void;
  closeRef: MutableRefObject<(() => void) | null>;
}) {
  const initial = {
    civility: guardian?.civility ?? null,
    first_name: guardian?.first_name ?? "",
    last_name: guardian?.last_name ?? "",
    relation: guardian?.relation ?? "",
    email: guardian?.email ?? "",
    phone: guardian?.phone ?? "",
    receives_reports: guardian?.receives_reports ?? true,
  };
  const [v, setV] = useState(initial);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const save = async () => {
    if (!v.first_name.trim() && !v.last_name.trim()) {
      toast("Indique au moins le prénom ou le nom.", "error");
      return false;
    }
    const values = {
      civility: v.civility,
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      relation: v.relation.trim() || null,
      email: v.email.trim().toLowerCase() || null,
      phone: v.phone.trim() || null,
      receives_reports: v.receives_reports,
    };
    if (guardian) await update("guardians", guardian.id, values);
    else await create("guardians", { patient_id: patientId, user_id: null, ...values });
    toast("Contact enregistré");
    onDone();
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "Contact familial", onSave: save });
  closeRef.current = () => guard.askBeforeClose(onDone);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
        <Field label="Civilité">
          <Select value={v.civility ?? ""} onChange={(e) => setV({ ...v, civility: (e.target.value || null) as Guardian["civility"] })}>
            <option value="">—</option>
            <option>Madame</option>
            <option>Monsieur</option>
          </Select>
        </Field>
        <Field label="Prénom">
          <Input value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} autoFocus />
        </Field>
        <Field label="Nom">
          <Input value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} />
        </Field>
      </div>
      <Field label="Lien avec le patient" hint="Ex. mère, père, grand-mère">
        <Input value={v.relation} onChange={(e) => setV({ ...v, relation: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="E-mail">
          <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label="Téléphone portable">
          <Input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" className="size-4 accent-[var(--color-pen)]" checked={v.receives_reports} onChange={(e) => setV({ ...v, receives_reports: e.target.checked })} />
        Reçoit les comptes rendus de séance
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Annuler
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}
