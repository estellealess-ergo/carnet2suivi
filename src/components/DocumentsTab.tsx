import { Download, Eye, FileText, Paperclip, Trash2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { fmtDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { newId, stamp } from "@/lib/repo";
import type { Patient, PatientDocument } from "@/lib/types";
import { Button, Empty, Field, Input, Modal, Pill, Select, toast } from "./ui";

export const DOC_CATEGORY: Record<PatientDocument["category"], string> = {
  bilan: "Bilan",
  courrier: "Courrier",
  ecole: "École",
  medical: "Médical",
  photo: "Photo de séance",
  autre: "Autre",
};

const MAX_SIZE = 25 * 1024 * 1024;

const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);

/**
 * Documents du dossier (bilans en PDF, courriers, comptes rendus de l'école…).
 * Ils restent sur cet appareil et sont inclus dans la sauvegarde chiffrée.
 */
export function DocumentsTab({ patient }: { patient: Patient }) {
  const docs =
    useLiveQuery(
      async () =>
        (await db.documents.where("patient_id").equals(patient.id).toArray())
          .filter((d) => !d.deleted_at)
          .sort((a, b) => (b.doc_date ?? b.created_at).localeCompare(a.doc_date ?? a.created_at)),
      [patient.id],
    ) ?? [];
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<PatientDocument["category"]>("autre");
  const [day, setDay] = useState("");

  async function save() {
    if (!pending) return;
    const at = stamp();
    await db.documents.put({
      id: newId(),
      owner_id: null,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      patient_id: patient.id,
      title: title.trim() || pending.name,
      category,
      doc_date: day || null,
      file_name: pending.name,
      mime: pending.type || "application/octet-stream",
      size: pending.size,
      blob: pending,
    });
    toast("Document ajouté au dossier");
    setPending(null);
  }

  const open = (d: PatientDocument, download = false) => {
    const url = URL.createObjectURL(d.blob);
    if (download) {
      const a = document.createElement("a");
      a.href = url;
      a.download = d.file_name;
      a.click();
    } else window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => input.current?.click()}>
          <Paperclip className="size-4" /> Ajouter un document
        </Button>
        <span className="text-sm text-ink-soft">PDF, images, Word… Gardés sur cet appareil et inclus dans la sauvegarde.</span>
        <input
          ref={input}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > MAX_SIZE) return toast("Ce fichier dépasse 25 Mo.", "error");
            setPending(f);
            setTitle(f.name.replace(/\.[^.]+$/, ""));
            setCategory(/bilan|bhk|mabc|dtvp|manos|evic|d2/i.test(f.name) ? "bilan" : "autre");
            setDay("");
          }}
        />
      </div>

      {docs.length === 0 ? (
        <Empty>Aucun document dans ce dossier.</Empty>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText className="size-5 shrink-0 text-pen" aria-hidden />
              <button type="button" onClick={() => open(d)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold hover:underline">{d.title}</span>
                <span className="block text-sm text-ink-soft">
                  {d.doc_date ? fmtDay(d.doc_date) : "Sans date"} · {fmtSize(d.size)}
                </span>
              </button>
              <Pill>{DOC_CATEGORY[d.category]}</Pill>
              <span className="flex">
                <Button size="sm" variant="ghost" onClick={() => open(d)} aria-label="Ouvrir">
                  <Eye className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => open(d, true)} aria-label="Télécharger">
                  <Download className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Retirer du dossier"
                  onClick={async () => {
                    if (!window.confirm(`Retirer « ${d.title} » du dossier ?`)) return;
                    await db.documents.update(d.id, { deleted_at: stamp(), updated_at: stamp() });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal open={pending !== null} onClose={() => setPending(null)} title="Ajouter un document">
        <div className="space-y-3">
          <Field label="Titre">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={category} onChange={(e) => setCategory(e.target.value as PatientDocument["category"])}>
                {Object.entries(DOC_CATEGORY).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date du document" hint="Facultative">
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
          </div>
          <p className="text-sm text-ink-soft">
            {pending?.name} · {pending ? fmtSize(pending.size) : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              Ajouter au dossier
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
