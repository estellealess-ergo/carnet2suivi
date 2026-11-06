import { ArrowLeft, FileDown, NotebookPen, Pencil, Plus, StickyNote, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ForecastForm, ForecastRow, PinnedInfo, TaskForm, TaskRow } from "@/components/bits";
import { AssessmentsTab } from "@/components/AssessmentsTab";
import { CommsTab } from "@/components/Comms";
import { FamilyTab } from "@/components/FamilyTab";
import { GoalsTab } from "@/components/GoalsTab";
import { ShareSection } from "@/components/ShareSection";
import { NoteModal, sanitize } from "@/components/NoteEditor";
import { PatientForm } from "@/components/PatientForm";
import { Button, Empty, Field, Input, Modal, PageHeader, Pill, cx, toast } from "@/components/ui";
import { ageFrom, fmtDay } from "@/lib/dates";
import { FREQUENCY_LABEL, PLACE_LABEL, STATUS_LABEL, fullName } from "@/lib/labels";
import { useAssessments, useForecasts, useGoals, useNotes, usePatient, useTasks } from "@/lib/queries";
import { remove, update } from "@/lib/repo";
import type { Note, NoteKind, Patient } from "@/lib/types";

const TABS = [
  { id: "notes", label: "Notes" },
  { id: "previsions", label: "Prévisions" },
  { id: "taches", label: "À préparer" },
  { id: "bilans", label: "Bilans" },
  { id: "objectifs", label: "Objectifs" },
  { id: "echanges", label: "Échanges" },
  { id: "famille", label: "Famille" },
  { id: "infos", label: "Informations" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function PatientDetail() {
  const { id } = useParams();
  const patient = usePatient(id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("onglet") as TabId) ?? "notes";
  const [exporting, setExporting] = useState(false);

  if (patient === undefined) return null;
  if (patient === null || patient.deleted_at)
    return (
      <Empty action={<Link to="/patients" className="font-semibold text-pen">Retour aux patients</Link>}>
        Ce patient n'existe pas sur cet appareil.
      </Empty>
    );

  const age = ageFrom(patient.birth_date);
  return (
    <>
      <Link to="/patients" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" /> Patients
      </Link>
      <PageHeader
        title={fullName(patient)}
        subtitle={[
          age !== null ? `${age} ans` : null,
          STATUS_LABEL[patient.status],
          patient.usual_day ? `${patient.usual_day}${patient.usual_time ? ` à ${patient.usual_time}` : ""}` : null,
        ]
          .filter(Boolean)
          .join(", ")}
        actions={
          <Button onClick={() => setExporting(true)}>
            <FileDown className="size-4" /> Export Word
          </Button>
        }
      />

      {/* L'information épinglée est toujours en haut de la fiche. */}
      <div className="mb-6">
        <PinnedInfo patient={patient} />
      </div>

      <div className="sticky top-0 z-20 -mx-4 mb-5 overflow-x-auto border-b border-rule bg-paper px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10" role="tablist">
        <div className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams({ onglet: t.id }, { replace: true })}
              className={cx(
                "-mb-px border-b-2 px-3 py-3 font-semibold",
                tab === t.id ? "border-pen text-pen" : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "notes" && <NotesTab patient={patient} />}
      {tab === "previsions" && <ForecastsTab patient={patient} />}
      {tab === "taches" && <TasksTab patient={patient} />}
      {tab === "bilans" && <AssessmentsTab patient={patient} />}
      {tab === "objectifs" && <GoalsTab patient={patient} />}
      {tab === "echanges" && <CommsTab patient={patient} />}
      {tab === "famille" && <FamilyTab patient={patient} />}
      {tab === "infos" && <InfosTab patient={patient} />}

      <ExportModal patient={patient} open={exporting} onClose={() => setExporting(false)} />
    </>
  );
}

function NotesTab({ patient }: { patient: Patient }) {
  const notes = useNotes(patient.id);
  const [editing, setEditing] = useState<{ note: Note | null; kind: NoteKind } | null>(null);
  const general = notes.filter((n) => n.kind === "generale");
  const sessions = notes.filter((n) => n.kind === "seance");

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setEditing({ note: null, kind: "seance" })}>
          <NotebookPen className="size-4" /> Nouvelle note de séance
        </Button>
        <Button onClick={() => setEditing({ note: null, kind: "generale" })}>
          <StickyNote className="size-4" /> Note générale
        </Button>
      </div>

      {general.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2">Notes générales</h2>
          <NoteList notes={general} onEdit={(note) => setEditing({ note, kind: "generale" })} />
        </section>
      )}

      <section>
        <h2 className="mb-2">Notes de séance</h2>
        {sessions.length === 0 ? (
          <Empty>Aucune note de séance pour l'instant.</Empty>
        ) : (
          <NoteList notes={sessions} onEdit={(note) => setEditing({ note, kind: "seance" })} />
        )}
      </section>

      <NoteModal
        patient={editing ? patient : null}
        note={editing?.note}
        kind={editing?.kind}
        onDone={() => setEditing(null)}
      />
    </>
  );
}

function NoteList({ notes, onEdit }: { notes: Note[]; onEdit: (n: Note) => void }) {
  const [confirm, setConfirm] = useState<Note | null>(null);
  return (
    <>
      <ol className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border border-rule bg-sheet">
            <div className="flex items-center gap-2 border-b border-rule px-4 py-2">
              <span className="font-bold">{fmtDay(n.note_date)}</span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => onEdit(n)}>
                  <Pencil className="size-4" /> Modifier
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(n)} aria-label="Supprimer la note">
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </div>
            <div className="prose-note sheet-margin py-3 pr-4 pl-12" dangerouslySetInnerHTML={{ __html: sanitize(n.content_html) }} />
          </li>
        ))}
      </ol>
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title="Supprimer cette note ?">
        <p className="text-ink-soft">La note du {fmtDay(confirm?.note_date)} sera retirée du dossier.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Garder la note
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (confirm) await remove("notes", confirm.id);
              setConfirm(null);
              toast("Note supprimée");
            }}
          >
            Supprimer
          </Button>
        </div>
      </Modal>
    </>
  );
}

function ForecastsTab({ patient }: { patient: Patient }) {
  const all = useForecasts(patient.id);
  const [adding, setAdding] = useState(false);
  const active = all.filter((f) => f.status === "a_faire");
  const past = all.filter((f) => f.status !== "a_faire").reverse();
  return (
    <>
      {adding ? (
        <div className="mb-5">
          <ForecastForm patientId={patient.id} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <Button variant="primary" className="mb-5" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Nouvelle prévision
        </Button>
      )}
      {active.length === 0 ? (
        <Empty>Rien de prévu pour les prochaines séances.</Empty>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet px-4">
          {active.map((f) => (
            <ForecastRow key={f.id} f={f} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold text-ink-soft">
            Prévisions reprises ou retirées ({past.length})
          </summary>
          <ul className="mt-2 divide-y divide-rule">
            {past.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-ink-soft">
                <Pill>{f.status === "transferee" ? "Reprise dans une note" : "Retirée"}</Pill>
                <span className="flex-1">{f.content}</span>
                <Button size="sm" variant="ghost" onClick={() => void update("forecasts", f.id, { status: "a_faire", note_id: null })}>
                  <Undo2 className="size-4" /> Remettre en prévision
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function TasksTab({ patient }: { patient: Patient }) {
  const tasks = useTasks(patient.id);
  const [adding, setAdding] = useState(false);
  const todo = tasks.filter((t) => t.status === "a_faire");
  const done = tasks.filter((t) => t.status === "fait");
  return (
    <>
      {adding ? (
        <div className="mb-5">
          <TaskForm patientId={patient.id} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <Button variant="primary" className="mb-5" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Nouvelle tâche
        </Button>
      )}
      {todo.length === 0 ? (
        <Empty>Rien à préparer pour ce patient.</Empty>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet px-4">
          {todo.map((t) => (
            <TaskRow key={t.id} t={t} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold text-ink-soft">Tâches faites ({done.length})</summary>
          <ul className="divide-y divide-rule">
            {done.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function InfosTab({ patient }: { patient: Patient }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const navigate = useNavigate();
  const closeRef = useRef<(() => void) | null>(null);
  const row = (label: string, value?: string | null) =>
    value ? (
      <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
        <dt className="font-semibold">{label}</dt>
        <dd className="whitespace-pre-wrap">{value}</dd>
      </div>
    ) : null;

  return (
    <>
      <div className="mb-4 flex gap-2">
        <Button variant="primary" onClick={() => setEditing(true)}>
          <Pencil className="size-4" /> Modifier la fiche
        </Button>
      </div>
      <dl className="divide-y divide-rule rounded-lg border border-rule bg-sheet px-4">
        {row("Date de naissance", patient.birth_date ? fmtDay(patient.birth_date) : null)}
        {row("Statut", STATUS_LABEL[patient.status])}
        {row("Jour et heure", [patient.usual_day, patient.usual_time].filter(Boolean).join(" à ") || null)}
        {row("Lieu", patient.usual_place ? PLACE_LABEL[patient.usual_place] : null)}
        {row("Fréquence", patient.frequency ? FREQUENCY_LABEL[patient.frequency] : null)}
        {row("Début du suivi", patient.care_start_date ? fmtDay(patient.care_start_date) : null)}
        {row("École", [patient.school_name, patient.school_class].filter(Boolean).join(", ") || null)}
        {row("Téléphone", patient.phone)}
        {row("E-mail", patient.email)}
        {row("Motif de consultation", patient.consultation_reason)}
        {row("Diagnostic connu", patient.diagnosis)}
        {row("Notes administratives", patient.notes)}
      </dl>
      <ShareSection patient={patient} />
      <div className="mt-10 border-t border-rule pt-4">
        <Button variant="danger" onClick={() => setConfirm(true)}>
          <Trash2 className="size-4" /> Supprimer le patient
        </Button>
        <p className="mt-1 text-sm text-ink-soft">Pour une fin de suivi, change plutôt le statut en « Archivé ».</p>
      </div>

      <Modal open={editing} onClose={() => closeRef.current?.()} title="Modifier la fiche" wide>
        <PatientForm patient={patient} onDone={() => setEditing(false)} closeRef={closeRef} />
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Supprimer ${fullName(patient)} ?`}>
        <p className="text-ink-soft">
          Le patient et son dossier disparaîtront de la liste. La suppression sera aussi appliquée sur tes autres appareils.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Garder le patient
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await remove("patients", patient.id);
              toast("Patient supprimé");
              navigate("/patients");
            }}
          >
            Supprimer
          </Button>
        </div>
      </Modal>
    </>
  );
}

function ExportModal({ patient, open, onClose }: { patient: Patient; open: boolean; onClose: () => void }) {
  const notes = useNotes(open ? patient.id : undefined);
  const assessments = useAssessments(open ? patient.id : undefined);
  const goals = useGoals(open ? patient.id : undefined);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Exporter le dossier en Word">
      <p className="mb-4 text-ink-soft">
        Le document reprend les informations, les bilans, les objectifs et les notes de séance de la période choisie.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Du" hint="Vide : depuis le début">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Au" hint="Vide : jusqu'à aujourd'hui">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Annuler
        </Button>
        <Button
          variant="primary"
          onClick={async () => {
            // Le module Word est chargé seulement à la demande (application plus légère au démarrage).
            const { buildDossierDocx, downloadBlob } = await import("@/lib/export-docx");
            const blob = await buildDossierDocx({ patient, notes, assessments, goals, from: from || null, to: to || null });
            const name = `${fullName(patient).replace(/[^\p{L}\p{N} -]/gu, "")} - dossier ergothérapie.docx`;
            downloadBlob(blob, name);
            onClose();
          }}
        >
          <FileDown className="size-4" /> Télécharger le document
        </Button>
      </div>
    </Modal>
  );
}
