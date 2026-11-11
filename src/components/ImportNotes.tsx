import { FileSpreadsheet, FileText } from "lucide-react";
import { useRef, useState } from "react";
import { fmtDay } from "@/lib/dates";
import { textToHtml } from "@/lib/html";
import { matchPatient, notesFromTable, notesFromText, splitName, type ImportedNote } from "@/lib/import-notes";
import { fullName } from "@/lib/labels";
import { usePatients } from "@/lib/queries";
import { create } from "@/lib/repo";
import type { IsoDay, Patient } from "@/lib/types";
import { Button, Field, Input, Select, Textarea, cx, toast } from "./ui";

type Mode = "tableau" | "texte";

/** Importation de notes existantes : tableau Excel/CSV, ou texte / document Word. */
export function ImportNotes() {
  const [mode, setMode] = useState<Mode>("tableau");
  const tab = (m: Mode, label: string, Icon: typeof FileText) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => setMode(m)}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold",
        mode === m ? "border-pen bg-pen-soft text-pen" : "border-rule text-ink-soft hover:border-pen",
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
  return (
    <section className="rounded-lg border border-rule bg-sheet p-5">
      <h2 className="mb-2">Importer des notes</h2>
      <p className="mb-3 text-ink-soft">
        Pour reprendre des notes écrites ailleurs. Rien n'est enregistré avant ta confirmation.
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {tab("tableau", "Un tableau (Excel, CSV)", FileSpreadsheet)}
        {tab("texte", "Un texte ou un document Word", FileText)}
      </div>
      {mode === "tableau" && <FromTable />}
      {mode === "texte" && <FromText />}
    </section>
  );
}

async function saveNotes(items: { patient: Patient; date: IsoDay; text: string }[]) {
  for (const it of items) {
    await create("notes", { patient_id: it.patient.id, kind: "seance", note_date: it.date, content_html: textToHtml(it.text), raw_text: null });
  }
}

/* ------------------------------------------------------------------ tableau */

function FromTable() {
  const patients = usePatients();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportedNote[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [createMissing, setCreateMissing] = useState(true);
  const [busy, setBusy] = useState(false);

  async function read(f: File) {
    let table: unknown[][];
    if (/\.xlsx?$/i.test(f.name)) {
      const { default: readXlsx } = await import("read-excel-file/browser");
      const sheets = await readXlsx(f);
      table = (sheets.find((s) => s.data.length > 1)?.data ?? sheets[0]?.data ?? []) as unknown[][];
    } else {
      const { parseCsv } = await import("@/lib/import-ergocabinet");
      const objs = parseCsv(await f.text());
      const head = Object.keys(objs[0] ?? {});
      table = [head, ...objs.map((o) => head.map((h) => o[h]))];
    }
    const r = notesFromTable(table);
    setRows(r.notes);
    setMissing(r.missing);
  }

  const matched = rows?.map((n) => ({ n, p: matchPatient(n, patients) })) ?? [];
  const unknown = [...new Set(matched.filter((m) => !m.p).map((m) => m.n.patientLabel))];
  const undated = matched.filter((m) => !m.n.date).length;

  return (
    <div>
      <p className="mb-3 text-sm text-ink-soft">
        Une ligne par séance, avec une colonne pour le patient (ou « Nom » et « Prénom »), une pour la date et une pour
        le texte de la note. Les titres de colonnes sont reconnus automatiquement.
      </p>
      <Button onClick={() => input.current?.click()}>
        <FileSpreadsheet className="size-4" /> Choisir le tableau
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".xlsx,.xls,.csv,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) read(f).catch(() => toast("Ce fichier n'a pas pu être lu.", "error"));
        }}
      />
      {rows && (
        <div className="mt-4 rounded-md border border-rule bg-paper p-4">
          {missing.length > 0 && <p className="mb-2 text-late">Il manque {missing.join(" et ")}.</p>}
          <p className="font-semibold">
            {rows.length} note{rows.length > 1 ? "s" : ""} trouvée{rows.length > 1 ? "s" : ""}
            {rows.length > 0 && `, pour ${new Set(rows.map((r) => r.patientLabel)).size} patient(s)`}.
          </p>
          {undated > 0 && <p className="text-sm text-late">{undated} note(s) sans date lisible seront ignorées.</p>}
          {unknown.length > 0 && (
            <label className="mt-2 flex items-start gap-2">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--color-pen)]" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
              <span>
                Créer les patients qui n'existent pas encore : {unknown.slice(0, 8).join(", ")}
                {unknown.length > 8 && "…"}
              </span>
            </label>
          )}
          <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm">
            {matched.slice(0, 30).map(({ n, p }, i) => (
              <li key={i} className={cx(!n.date && "text-ink-soft line-through")}>
                <strong>{p ? fullName(p) : n.patientLabel}</strong> · {n.date ? fmtDay(n.date) : "sans date"} · {n.text.slice(0, 80)}
                {n.text.length > 80 && "…"}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setRows(null)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={busy || rows.length - undated === 0}
              onClick={async () => {
                setBusy(true);
                const created = new Map<string, Patient>();
                const items: { patient: Patient; date: IsoDay; text: string }[] = [];
                for (const { n, p } of matched) {
                  if (!n.date) continue;
                  let patient = p ?? created.get(n.patientLabel) ?? null;
                  if (!patient && createMissing) {
                    patient = await create("patients", {
                      ...splitName(n),
                      birth_date: null, status: "actif", usual_day: null, usual_time: null, usual_place: null,
                      frequency: null, day_order: 99, sort_order: patients.length + created.size, school_name: null,
                      school_class: null, phone: null, email: null, consultation_reason: null, diagnosis: null,
                      care_start_date: null, pinned_info: null, notes: null,
                    });
                    created.set(n.patientLabel, patient);
                  }
                  if (patient) items.push({ patient, date: n.date, text: n.text });
                }
                await saveNotes(items);
                setBusy(false);
                setRows(null);
                toast(`${items.length} note${items.length > 1 ? "s" : ""} importée${items.length > 1 ? "s" : ""}`);
              }}
            >
              Importer ces notes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ texte / Word */

function FromText() {
  const patients = usePatients();
  const input = useRef<HTMLInputElement>(null);
  const [pid, setPid] = useState("");
  const [text, setText] = useState("");
  const [fallbackDate, setFallbackDate] = useState("");
  const [busy, setBusy] = useState(false);
  const notes = text.trim() ? notesFromText(text) : [];
  const undated = notes.filter((n) => !n.date).length;
  const patient = patients.find((p) => p.id === pid) ?? null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Pour un patient : chaque ligne qui commence par une date (« 12/10/2026 », « Séance du 12 octobre 2026 »…)
        commence une nouvelle note.
      </p>
      <Field label="Patient" className="max-w-sm">
        <Select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">Choisir…</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {fullName(p)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => input.current?.click()}>
          <FileText className="size-4" /> Ouvrir un document (Word, texte)
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".docx,.txt,.md,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (/\.docx$/i.test(f.name)) {
                const mammoth = await import("mammoth");
                const { value } = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
                setText(value);
              } else setText(await f.text());
            } catch {
              toast("Ce document n'a pas pu être lu.", "error");
            }
          }}
        />
      </div>
      <Field label="Ou colle le texte ici">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-40" />
      </Field>
      {notes.length > 0 && (
        <div className="rounded-md border border-rule bg-paper p-4">
          <p className="font-semibold">
            {notes.length} note{notes.length > 1 ? "s" : ""} repérée{notes.length > 1 ? "s" : ""}.
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
            {notes.map((n, i) => (
              <li key={i}>
                <strong>{n.date ? fmtDay(n.date) : "Sans date"}</strong> · {n.text.slice(0, 90)}
                {n.text.length > 90 && "…"}
              </li>
            ))}
          </ul>
          {undated > 0 && (
            <Field label="Date à donner aux notes sans date" className="mt-3 w-60" hint="Sinon, elles ne seront pas importées.">
              <Input type="date" value={fallbackDate} onChange={(e) => setFallbackDate(e.target.value)} />
            </Field>
          )}
          <Button
            variant="primary"
            className="mt-3"
            disabled={busy || !patient}
            title={patient ? undefined : "Choisis d'abord le patient"}
            onClick={async () => {
              if (!patient) return;
              setBusy(true);
              const items = notes
                .map((n) => ({ patient, date: n.date ?? fallbackDate, text: n.text }))
                .filter((n) => n.date) as { patient: Patient; date: IsoDay; text: string }[];
              await saveNotes(items);
              setBusy(false);
              setText("");
              toast(`${items.length} note${items.length > 1 ? "s" : ""} importée${items.length > 1 ? "s" : ""} pour ${patient.first_name}`);
            }}
          >
            Importer ces notes
          </Button>
        </div>
      )}
    </div>
  );
}
