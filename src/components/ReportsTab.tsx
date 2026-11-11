import { ClipboardPaste, Copy, FileDown, FileText, Pencil, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useSearchParams } from "react-router";
import { askAssistant, assistantAvailable, copyForClaude, pasteFromClaude } from "@/lib/assistant";
import { addDays, fmtDay, localDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { downloadBlob } from "@/lib/export-docx";
import { isEmptyHtml } from "@/lib/html";
import { useAssessments, useGoals, useNotes } from "@/lib/queries";
import {
  CR_KIND_LABEL,
  RECIPIENTS,
  buildReportDocx,
  crEvolution,
  crFromAssessment,
  crLetter,
  crMaterial,
  getCabinet,
  inPeriod,
  mdToHtml,
  readReport,
  saveReport,
  type CrData,
  type CrKind,
} from "@/lib/reports";
import { stamp } from "@/lib/repo";
import type { IsoDay, Patient } from "@/lib/types";
import { RichEditor } from "./RichEditor";
import { Button, Empty, Field, Input, Modal, Pill, Select, cx, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

export function useReports(patientId: string) {
  return (
    useLiveQuery(async () => {
      const docs = (await db.documents.where("patient_id").equals(patientId).toArray()).filter((d) => d.category === "compte_rendu" && !d.deleted_at);
      const list = await Promise.all(docs.map(readReport));
      return list.sort((a, b) => (b.cr_date ?? b.updated_at).localeCompare(a.cr_date ?? a.updated_at));
    }, [patientId]) ?? []
  );
}

async function exportWord(cr: CrData, patient: Patient) {
  const { reportFileName } = await import("@/lib/reports");
  const cab = await getCabinet();
  downloadBlob(await buildReportDocx(cr, patient, cab), reportFileName(cr, patient));
  if (!cab.name) toast("Astuce : renseigne ton en-tête (nom, adresse…) dans Paramètres pour qu'il apparaisse sur les comptes rendus.");
}

export function ReportsTab({ patient }: { patient: Patient }) {
  const reports = useReports(patient.id);
  const assessments = useAssessments(patient.id);
  const [params, setParams] = useSearchParams();
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState<{ cr: CrData; id?: string } | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  // Ouvert depuis un bilan : ?onglet=comptes-rendus&bilan=<id>
  const fromBilan = params.get("bilan");
  useEffect(() => {
    if (!fromBilan) return;
    const a = assessments.find((x) => x.id === fromBilan);
    if (!a) return;
    setEditing({ cr: crFromAssessment(patient, a) });
    setParams({ onglet: "comptes-rendus" }, { replace: true });
  }, [fromBilan, assessments, patient, setParams]);

  return (
    <>
      <Button variant="primary" className="mb-5" onClick={() => setChoosing(true)}>
        <Plus className="size-4" /> Nouveau compte rendu
      </Button>
      {reports.length === 0 ? (
        <Empty>
          Aucun compte rendu. Rédige ici tes comptes rendus de bilan, d'évolution ou tes courriers : ils sont
          pré-remplis avec le dossier, et s'exportent en Word avec ton en-tête.
        </Empty>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-sheet px-4 py-3">
              <FileText className="size-5 text-pen" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.title || CR_KIND_LABEL[r.kind]}</p>
                <p className="text-sm text-ink-soft">
                  {r.cr_date ? fmtDay(r.cr_date) : "Sans date"}
                  {r.recipient && ` · pour : ${r.recipient}`}
                </p>
              </div>
              <Pill>{CR_KIND_LABEL[r.kind]}</Pill>
              <Button size="sm" variant="ghost" onClick={() => setEditing({ cr: r, id: r.id })}>
                <Pencil className="size-4" /> Modifier
              </Button>
              <Button size="sm" onClick={() => void exportWord(r, patient)}>
                <FileDown className="size-4" /> Word
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Supprimer le compte rendu"
                onClick={async () => {
                  if (!window.confirm("Supprimer ce compte rendu ?")) return;
                  await db.documents.update(r.id, { deleted_at: stamp(), updated_at: stamp() });
                  toast("Compte rendu supprimé");
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={choosing} onClose={() => setChoosing(false)} title="Nouveau compte rendu">
        {choosing && (
          <NewReport
            patient={patient}
            onCancel={() => setChoosing(false)}
            onPick={(cr) => {
              setChoosing(false);
              setEditing({ cr });
            }}
          />
        )}
      </Modal>

      <Modal open={editing !== null} onClose={() => closeRef.current?.()} title={editing?.id ? "Modifier le compte rendu" : "Nouveau compte rendu"} wide>
        {editing && <ReportEditor patient={patient} initial={editing.cr} id={editing.id} onDone={() => setEditing(null)} closeRef={closeRef} />}
      </Modal>
    </>
  );
}

function NewReport({ patient, onPick, onCancel }: { patient: Patient; onPick: (cr: CrData) => void; onCancel: () => void }) {
  const assessments = useAssessments(patient.id);
  const notes = useNotes(patient.id);
  const goals = useGoals(patient.id);
  const [kind, setKind] = useState<CrKind>(assessments.length ? "bilan" : "evolution");
  const [bilan, setBilan] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const today = localDay();
  const count = notes.filter((n) => inPeriod(n, from || null, to || null)).length;
  const firstNote = notes.filter((n) => n.kind === "seance").map((n) => n.note_date).sort()[0];

  const kinds: [CrKind, string][] = [
    ["bilan", "À partir d'un bilan enregistré"],
    ["evolution", "Évolution sur une période (à partir des notes et des objectifs)"],
    ["courrier", "Courrier libre (école, médecin…)"],
  ];
  return (
    <div className="space-y-4">
      <div className="space-y-2" role="radiogroup">
        {kinds.map(([k, l]) => (
          <label key={k} className={cx("flex cursor-pointer items-start gap-2 rounded-md border p-3", kind === k ? "border-pen bg-pen-soft" : "border-rule")}>
            <input type="radio" name="kind" className="mt-1 accent-[var(--color-pen)]" checked={kind === k} onChange={() => setKind(k)} />
            <span>
              <strong>{CR_KIND_LABEL[k]}</strong>
              <span className="block text-sm text-ink-soft">{l}</span>
            </span>
          </label>
        ))}
      </div>
      {kind === "bilan" &&
        (assessments.length ? (
          <Field label="Bilan">
            <Select value={bilan} onChange={(e) => setBilan(e.target.value)}>
              <option value="">Choisir…</option>
              {assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  Bilan du {fmtDay(a.assessment_date)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-late">Aucun bilan enregistré pour ce patient (onglet Bilans).</p>
        ))}
      {kind === "evolution" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            <Field label="Du" className="w-44">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Au" className="w-44">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {firstNote && (
              <button type="button" className="font-semibold text-pen underline" onClick={() => (setFrom(firstNote), setTo(today))}>
                Depuis le début du suivi
              </button>
            )}
            <button type="button" className="font-semibold text-pen underline" onClick={() => (setFrom(addDays(today, -91)), setTo(today))}>
              Les 3 derniers mois
            </button>
            <button type="button" className="font-semibold text-pen underline" onClick={() => (setFrom(addDays(today, -182)), setTo(today))}>
              Les 6 derniers mois
            </button>
          </div>
          <p className="text-sm text-ink-soft">
            {count} note{count > 1 ? "s" : ""} de séance sur cette période.
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button
          variant="primary"
          disabled={(kind === "bilan" && !bilan) || (kind === "evolution" && (!from || !to))}
          onClick={() => {
            if (kind === "bilan") onPick(crFromAssessment(patient, assessments.find((a) => a.id === bilan)!));
            else if (kind === "evolution") onPick(crEvolution(patient, notes, goals, from as IsoDay, to as IsoDay));
            else onPick(crLetter());
          }}
        >
          Rédiger
        </Button>
      </div>
    </div>
  );
}

function ReportEditor({
  patient,
  initial,
  id,
  onDone,
  closeRef,
}: {
  patient: Patient;
  initial: CrData;
  id?: string;
  onDone: () => void;
  closeRef: MutableRefObject<(() => void) | null>;
}) {
  const notes = useNotes(patient.id);
  const goals = useGoals(patient.id);
  const [cr, setCr] = useState<CrData>(initial);
  const [savedId, setSavedId] = useState(id);
  const [base, setBase] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const dirty = JSON.stringify(cr) !== base;
  const canAssist = assistantAvailable();
  const set = (p: Partial<CrData>) => setCr((x) => ({ ...x, ...p }));

  const save = async (leaving?: boolean) => {
    const newId = await saveReport(patient.id, cr, savedId);
    setSavedId(newId);
    setBase(JSON.stringify(cr));
    guard.release();
    toast("Compte rendu enregistré");
    if (!leaving) onDone();
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "Compte rendu", onSave: save });
  closeRef.current = () => guard.askBeforeClose(onDone);

  const material = () => crMaterial(patient, cr, notes, goals);
  const applyAnswer = (text: string) => {
    setBefore(cr.html);
    set({ html: mdToHtml(text) });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_11rem]">
        <Field label="Titre">
          <Input value={cr.title} onChange={(e) => set({ title: e.target.value })} placeholder={CR_KIND_LABEL[cr.kind]} />
        </Field>
        <Field label="Destinataire">
          <Input list="cr-recipients" value={cr.recipient} onChange={(e) => set({ recipient: e.target.value })} placeholder="Facultatif" />
          <datalist id="cr-recipients">
            {RECIPIENTS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field label="Date du compte rendu">
          <Input type="date" value={cr.cr_date ?? ""} onChange={(e) => set({ cr_date: e.target.value || null })} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canAssist ? (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                applyAnswer(await askAssistant("cr", material(), patient));
                toast("Proposition de l'assistant : relis-la avant d'enregistrer.");
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Sparkles className="size-4" /> {busy ? "Rédaction…" : "Rédiger avec l'assistant"}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              title="Copie les éléments du dossier (nom du patient masqué) avec les consignes, à coller dans Claude"
              onClick={async () => {
                await copyForClaude("cr", material(), patient);
                toast("Copié. Colle-le dans Claude, puis copie sa réponse et clique sur « Coller la réponse ».");
              }}
            >
              <Copy className="size-4" /> Copier pour Claude
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  applyAnswer(await pasteFromClaude(patient));
                  toast("Réponse reprise. Relis-la avant d'enregistrer.");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              <ClipboardPaste className="size-4" /> Coller la réponse
            </Button>
          </>
        )}
        {before !== null && (
          <Button
            variant="ghost"
            onClick={() => {
              set({ html: before });
              setBefore(null);
            }}
          >
            <Undo2 className="size-4" /> Revenir à ma version
          </Button>
        )}
      </div>

      <RichEditor value={cr.html} onChange={(html) => set({ html })} minHeight="22rem" placeholder="Rédige ou dicte le compte rendu…" />
      <p className="text-sm text-ink-soft">L'en-tête (ton nom, ton adresse), l'identité du patient et la signature sont ajoutés dans le fichier Word.</p>

      <div className="sticky bottom-0 -mx-5 flex flex-wrap justify-end gap-2 border-t border-rule bg-sheet px-5 py-3">
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Fermer
        </Button>
        <Button disabled={isEmptyHtml(cr.html)} onClick={() => void exportWord(cr, patient)}>
          <FileDown className="size-4" /> Word
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}
