/**
 * Étape 4 : reprise des données de l'ancien ErgoCabinet.
 *
 * On lit les tables exportées de l'ancienne base (fichiers CSV ou JSON, un par table,
 * par exemple « patients_rows.csv »), on les convertit au nouveau modèle, puis on les
 * enregistre comme n'importe quelle saisie : elles partent vers le serveur HDS à la
 * synchronisation. Les identifiants sont conservés : refaire l'import ne crée pas de doublons.
 */
import { db } from "./db";
import { textToHtml } from "./html";
import { WEEKDAYS } from "./dates";
import type {
  Assessment,
  Communication,
  FamilyReport,
  Forecast,
  Goal,
  GoalProgress,
  Guardian,
  Note,
  NoteVersion,
  Patient,
  SyncedRow,
  TableName,
  Task,
} from "./types";

type Raw = Record<string, unknown>;

/** Tables de l'ancienne base reconnues (les noms les plus longs d'abord). */
export const OLD_TABLES = [
  "progress_note_versions",
  "progress_notes",
  "patient_guardians",
  "next_session_plans",
  "clinical_sessions",
  "parent_reports",
  "communications",
  "goal_progress",
  "assessments",
  "guardians",
  "patients",
  "goals",
  "tasks",
] as const;
export type OldTable = (typeof OLD_TABLES)[number];
export type Sources = Partial<Record<OldTable, Raw[]>>;

/* ------------------------------------------------------------------ lecture des fichiers */

/** Lecteur CSV (guillemets, virgules et retours à la ligne dans les champs). */
export function parseCsv(text: string): Raw[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  const sep = (src.split("\n")[0] ?? "").split(";").length > (src.split("\n")[0] ?? "").split(",").length ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((v) => v !== ""));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}

export function tableFromFilename(name: string): OldTable | null {
  const base = name.toLowerCase().replace(/\.(csv|json)$/, "");
  return OLD_TABLES.find((t) => base === t || base.startsWith(`${t}_`) || base.startsWith(`${t}-`) || base.endsWith(`_${t}`)) ?? null;
}

export async function readFiles(files: File[]): Promise<{ sources: Sources; ignored: string[] }> {
  const sources: Sources = {};
  const ignored: string[] = [];
  for (const f of files) {
    const text = await f.text();
    if (f.name.toLowerCase().endsWith(".json")) {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        const t = tableFromFilename(f.name);
        if (t) sources[t] = [...(sources[t] ?? []), ...data];
        else ignored.push(f.name);
      } else {
        // Un seul fichier { patients: [...], progress_notes: [...] }
        for (const [k, v] of Object.entries(data)) {
          const t = OLD_TABLES.find((x) => x === k);
          if (t && Array.isArray(v)) sources[t] = [...(sources[t] ?? []), ...(v as Raw[])];
        }
      }
    } else {
      const t = tableFromFilename(f.name);
      if (t) sources[t] = [...(sources[t] ?? []), ...parseCsv(text)];
      else ignored.push(f.name);
    }
  }
  return { sources, ignored };
}

/* ------------------------------------------------------------------ conversion */

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "NULL" ? null : s;
};
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const iso = (v: unknown, fallback = new Date().toISOString()): string => {
  const s = str(v);
  if (!s) return fallback;
  const d = new Date(s.includes("T") || s.includes(" ") ? s.replace(" ", "T") : `${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
};
const num = (v: unknown, fallback = 0) => {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown) => v === true || String(v).toLowerCase() === "true" || v === "t" || v === "1";
const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Ancien texte (HTML de l'éditeur ou texte brut) → HTML du nouvel éditeur. */
export function toHtml(content: unknown): string {
  const s = str(content) ?? "";
  return /<\/?(p|br|strong|em|ul|ol|li|span|b|i|u|div)\b/i.test(s) ? s : textToHtml(s);
}

const meta = (r: Raw): SyncedRow => ({
  id: String(r.id),
  owner_id: null, // le serveur attribue les données importées au compte qui importe
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at ?? r.created_at),
  deleted_at: null,
});

export type Converted = Partial<Record<TableName, SyncedRow[]>>;
export type Report = { counts: Partial<Record<TableName, number>>; warnings: string[] };

export function convert(src: Sources): { data: Converted; report: Report } {
  const warnings: string[] = [];
  const out: Converted = {};
  const push = (t: TableName, row: SyncedRow) => (out[t] ??= []).push(row);

  const patients = new Map<string, Patient>();
  for (const r of src.patients ?? []) {
    if (!isUuid(r.id)) continue;
    const status = str(r.status);
    const place = str(r.usual_place);
    const usualDay = str(r.usual_day);
    const freq = str(r.frequency);
    const p: Patient = {
      ...meta(r),
      first_name: str(r.first_name) ?? "",
      last_name: str(r.last_name) ?? "",
      birth_date: day(r.birth_date),
      status: status === "termine" ? "archive" : (["actif", "bilan", "liste_attente", "pause", "non_suivi", "archive"].includes(status ?? "") ? status : "actif") as Patient["status"],
      usual_day: usualDay && [...WEEKDAYS, "Ponctuel"].includes(usualDay) ? (usualDay as Patient["usual_day"]) : null,
      usual_time: str(r.usual_time)?.slice(0, 5) ?? null,
      usual_place: place && ["cabinet", "domicile", "ecole", "teleconsultation"].includes(place) ? (place as Patient["usual_place"]) : place ? "autre" : null,
      frequency: freq && ["ponctuel", "hebdomadaire", "bimensuel"].includes(freq) ? (freq as Patient["frequency"]) : null,
      day_order: num(r.day_order),
      sort_order: num(r.sort_order),
      school_name: str(r.school_name),
      school_class: str(r.school_class),
      phone: str(r.phone),
      email: str(r.email)?.toLowerCase() ?? null,
      consultation_reason: str(r.consultation_reason),
      diagnosis: str(r.diagnosis),
      care_start_date: day(r.care_start_date),
      pinned_info: str(r.pinned_info),
      notes: [str(r.notes), str(r.main_difficulties) && `Difficultés principales : ${str(r.main_difficulties)}`, str(r.recommendations) && `Préconisations : ${str(r.recommendations)}`]
        .filter(Boolean)
        .join("\n\n") || null,
    };
    patients.set(p.id, p);
    push("patients", p);
  }
  const known = (id: unknown): id is string => isUuid(id) && patients.has(id);
  const skip = (what: string, n: number) => n && warnings.push(`${n} ${what} ignoré(s) : patient absent de l'export.`);

  // Notes de séance
  const notes = new Set<string>();
  let orphan = 0;
  for (const r of src.progress_notes ?? []) {
    if (!isUuid(r.id) || !known(r.patient_id)) {
      orphan++;
      continue;
    }
    const n: Note = {
      ...meta(r),
      patient_id: r.patient_id,
      kind: "seance",
      note_date: day(r.note_date) ?? iso(r.created_at).slice(0, 10),
      content_html: toHtml(r.content),
      raw_text: null,
    };
    notes.add(n.id);
    push("notes", n);
  }
  skip("note(s)", orphan);

  // Anciennes fiches de séance structurées → notes de séance
  orphan = 0;
  for (const r of src.clinical_sessions ?? []) {
    if (!isUuid(r.id) || !known(r.patient_id)) {
      orphan++;
      continue;
    }
    const parts = [
      ["Résumé", r.summary],
      ["Observations", r.observations],
      ["Aides", r.aids],
      ["Conseils", r.advice],
      ["Prochaine fois", r.next_time],
    ]
      .filter(([, v]) => str(v))
      .map(([k, v]) => `<p><strong>${k} :</strong> ${String(str(v)).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`);
    if (!parts.length) continue;
    push("notes", {
      ...meta(r),
      patient_id: r.patient_id,
      kind: "seance",
      note_date: day(r.session_date) ?? iso(r.created_at).slice(0, 10),
      content_html: parts.join(""),
      raw_text: null,
    } as Note);
  }
  skip("fiche(s) de séance", orphan);

  for (const r of src.progress_note_versions ?? []) {
    if (!isUuid(r.id) || !isUuid(r.note_id) || !notes.has(r.note_id) || !known(r.patient_id)) continue;
    push("note_versions", {
      ...meta(r),
      note_id: r.note_id,
      patient_id: r.patient_id,
      content_html: toHtml(r.content),
      saved_at: iso(r.saved_at ?? r.created_at),
    } as NoteVersion);
  }

  orphan = 0;
  for (const r of src.next_session_plans ?? []) {
    if (!isUuid(r.id) || !known(r.patient_id)) {
      orphan++;
      continue;
    }
    push("forecasts", {
      ...meta(r),
      patient_id: r.patient_id,
      content: str(r.content) ?? "",
      planned_date: day(r.planned_date),
      status: str(r.status) === "pending" ? "a_faire" : "transferee",
      note_id: isUuid(r.source_note_id) && notes.has(r.source_note_id) ? r.source_note_id : null,
    } as Forecast);
  }
  skip("prévision(s)", orphan);

  for (const r of src.tasks ?? []) {
    if (!isUuid(r.id)) continue;
    const pid = known(r.patient_id) ? r.patient_id : null;
    if (str(r.patient_id) && !pid) continue;
    push("tasks", {
      ...meta(r),
      patient_id: pid,
      title: str(r.title) ?? "Tâche",
      due_date: day(r.due_date),
      status: str(r.status) === "done" ? "fait" : "a_faire",
      urgent: num(r.priority, 2) <= 1,
      details: str(r.notes),
    } as Task);
  }

  for (const r of src.assessments ?? []) {
    if (!isUuid(r.id) || !known(r.patient_id)) continue;
    push("assessments", {
      ...meta(r),
      patient_id: r.patient_id,
      assessment_date: day(r.assessment_date),
      reason: str(r.reason),
      tests_used: str(r.tests_used),
      results: str(r.results),
      observations: str(r.observations),
      synthesis: str(r.synthesis),
      recommendations: str(r.recommendations),
    } as Assessment);
  }

  const goals = new Set<string>();
  let order = 0;
  for (const r of src.goals ?? []) {
    if (!isUuid(r.id) || !known(r.patient_id) || str(r.archived_at)) continue;
    const st = str(r.status);
    goals.add(String(r.id));
    push("goals", {
      ...meta(r),
      patient_id: r.patient_id,
      title: str(r.title) ?? "Objectif",
      smart_statement: str(r.smart_statement),
      status: (["en_cours", "atteint", "suspendu", "abandonne"].includes(st ?? "") ? st : "en_cours") as Goal["status"],
      progress: Math.max(0, Math.min(100, Math.round(num(r.progress)))),
      target_date: day(r.target_date),
      review_date: day(r.review_date),
      sort_order: order++,
    } as Goal);
  }
  for (const r of src.goal_progress ?? []) {
    if (!isUuid(r.id) || !isUuid(r.goal_id) || !goals.has(r.goal_id)) continue;
    const goal = out.goals!.find((g) => g.id === r.goal_id) as Goal;
    push("goal_progress", {
      ...meta(r),
      goal_id: r.goal_id,
      patient_id: goal.patient_id,
      progress: Math.max(0, Math.min(100, Math.round(num(r.progress)))),
      comment: str(r.note),
      recorded_on: day(r.recorded_at) ?? iso(r.created_at).slice(0, 10),
    } as GoalProgress);
  }

  // Responsables légaux : un contact par lien patient ↔ responsable.
  const guardianById = new Map((src.guardians ?? []).map((g) => [String(g.id), g]));
  for (const link of src.patient_guardians ?? []) {
    const g = guardianById.get(String(link.guardian_id));
    if (!g || !isUuid(link.id) || !known(link.patient_id)) continue;
    const civ = str(g.civility);
    push("guardians", {
      ...meta(link),
      patient_id: link.patient_id,
      civility: civ === "Madame" || civ === "Monsieur" ? civ : null,
      first_name: str(g.first_name) ?? "",
      last_name: str(g.last_name) ?? "",
      relation: str(link.relation),
      email: str(g.email)?.toLowerCase() ?? null,
      phone: str(g.phone),
      receives_reports: g.receives_reports === undefined ? true : bool(g.receives_reports),
      user_id: null, // l'accès à l'espace famille se redonne par une nouvelle invitation
    } as Guardian);
  }

  let droppedTranscripts = 0;
  const CHANNEL: Record<string, Communication["channel"]> = { email: "email", sms: "sms", whatsapp: "whatsapp", call: "appel", voicemail: "vocal", portal: "autre" };
  for (const r of src.communications ?? []) {
    if (!isUuid(r.id)) continue;
    const pid = known(r.patient_id) ? r.patient_id : null;
    if (str(r.patient_id) && !pid) continue;
    const out_ = str(r.direction) === "out";
    const providerId = str(r.provider_message_id);
    if (str(r.transcript)) droppedTranscripts++;
    push("communications", {
      ...meta(r),
      patient_id: pid,
      channel: CHANNEL[str(r.channel) ?? ""] ?? "autre",
      direction: out_ ? "sortant" : "entrant",
      occurred_at: iso(r.sent_at ?? r.created_at),
      counterpart: (out_ ? str(r.to_email) : str(r.from_email)) ?? str(r.author_name),
      subject: str(r.subject),
      body: str(r.body),
      // Seules les informations clés sont gardées, pas les retranscriptions intégrales.
      summary: str(r.summary),
      status: "traite",
      external_id: str(r.provider) === "gmail" && providerId && /^[0-9a-f]{10,}$/i.test(providerId) ? `gmail:${providerId}` : null,
      thread_id: str(r.thread_id),
    } as Communication);
  }

  if (droppedTranscripts)
    warnings.push(
      `${droppedTranscripts} retranscription(s) intégrale(s) non reprise(s) : seuls les résumés des appels et vocaux sont gardés.`,
    );

  for (const r of src.parent_reports ?? []) {
    if (!isUuid(r.id) || !known(r.patient_id)) continue;
    const title = str(r.title);
    push("family_reports", {
      ...meta(r),
      patient_id: r.patient_id,
      note_id: null,
      report_date: day(r.session_date) ?? iso(r.published_at ?? r.created_at).slice(0, 10),
      content: [title, str(r.content)].filter(Boolean).join("\n\n"),
      status: "envoye",
      sent_at: iso(r.published_at ?? r.created_at),
      sent_via: "ancien portail",
      recipients: null,
      published: true,
      patient_first_name: patients.get(r.patient_id)!.first_name,
    } as FamilyReport);
  }

  if (!src.patients?.length) warnings.push("Aucun fichier « patients » : il est indispensable pour rattacher le reste.");
  const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v!.length])) as Report["counts"];
  return { data: out, report: { counts, warnings } };
}

/** Enregistre sur l'appareil et met en file d'envoi (ne remplace pas une version plus récente). */
export async function applyImport(data: Converted): Promise<number> {
  let n = 0;
  const tables = Object.keys(data) as TableName[];
  await db.transaction("rw", [...tables.map((t) => db.table(t)), db.outbox], async () => {
    for (const t of tables) {
      for (const row of data[t] ?? []) {
        const local = (await db.table(t).get(row.id)) as SyncedRow | undefined;
        if (local && local.updated_at >= row.updated_at) continue;
        await db.table(t).put(local ? { ...row, owner_id: local.owner_id } : row);
        await db.outbox.add({ table: t, row_id: row.id, queued_at: new Date().toISOString() });
        n++;
      }
    }
  });
  return n;
}
