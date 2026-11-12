/**
 * Reprise d'une sauvegarde complète de l'ancienne application (« Tout exporter ») :
 * un .zip qui contient un classeur Excel (un onglet par catégorie, colonnes en français)
 * et un dossier « Fichiers/<Patient>/… » avec les documents, photos et supports.
 *
 * - Ce qui a son équivalent dans l'application est repris à sa place (patients, contacts,
 *   notes, prévisions, tâches, objectifs, bilans, échanges, comptes rendus, documents…).
 * - Le reste (consentements, factures, profil occupationnel, exercices maison…) n'est pas
 *   perdu : il est rangé, lisible, dans les documents du patient (« Repris : … »), ou dans
 *   les ressources du cabinet quand il ne concerne aucun patient.
 * - Les identifiants d'origine sont gardés : refaire l'import ne crée pas de doublons.
 */
import { db } from "./db";
import { applyImport, convert, toHtml, type Converted, type OldTable, type Sources } from "./import-ergocabinet";
import { parseFrenchDate } from "./import-notes";
import { saveReport, type CrData } from "./reports";
import type { Communication, DayChange, FamilyReport, Goal, GoalProgress, Guardian, Note, NoteVersion, Patient, PatientDocument, SyncedRow } from "./types";

type Raw = Record<string, unknown>;

/** Onglets de la sauvegarde → tables d'origine (mêmes titres que l'export, coupés à 31 caractères). */
export const SHEETS: [string, string][] = [
  ["patients", "Patients"],
  ["guardians", "Responsables légaux"],
  ["patient_guardians", "Liens responsables"],
  ["contacts", "Autres contacts"],
  ["consents", "Consentements"],
  ["practitioners", "Praticiens"],
  ["progress_notes", "Notes de séance"],
  ["progress_note_versions", "Anciennes versions notes"],
  ["clinical_sessions", "Séances"],
  ["session_activities", "Activités de séance"],
  ["appointments", "Rendez-vous"],
  ["next_session_plans", "Prévisions"],
  ["tasks", "Tâches"],
  ["goals", "Objectifs"],
  ["goal_progress", "Progrès objectifs"],
  ["goal_measurements", "Mesures objectifs"],
  ["goal_versions", "Historique objectifs"],
  ["session_goal_results", "Résultats par séance"],
  ["progress_reviews", "Points d'étape"],
  ["assessments", "Bilans"],
  ["assessment_results", "Résultats de tests"],
  ["patient_occupations", "Profil occupationnel"],
  ["occupation_ratings", "Cotations occupations"],
  ["occupational_issues", "Difficultés"],
  ["patient_factors", "Facteurs"],
  ["patient_adaptations", "Adaptations"],
  ["home_exercises", "Exercices maison"],
  ["exercise_results", "Retours exercices"],
  ["family_updates", "Transmissions familles"],
  ["parent_reports", "Comptes rendus familles"],
  ["parent_notifications", "Envois aux familles"],
  ["progress_reports", "Rapports"],
  ["communication_threads", "Conversations"],
  ["communications", "Messages"],
  ["call_logs", "Appels"],
  ["message_templates", "Modèles de messages"],
  ["documents", "Documents"],
  ["therapy_supports", "Supports"],
  ["invoices", "Factures"],
  ["payments", "Paiements"],
];

/** Titres de colonnes français de l'export → noms d'origine (un titre peut couvrir plusieurs colonnes). */
const FR: Record<string, string> = {
  id: "Identifiant", patient_id: "Identifiant patient", first_name: "Prénom", last_name: "Nom",
  birth_date: "Date de naissance", email: "E-mail", phone: "Téléphone", address: "Adresse", city: "Ville",
  postal_code: "Code postal", school: "École", class_level: "Classe", status: "Statut", notes: "Remarques",
  created_at: "Créé le", updated_at: "Modifié le", created_by: "Créé par", content: "Texte",
  family_content: "Texte pour la famille", note_date: "Date", visibility: "Visibilité", title: "Titre",
  description: "Description", due_date: "Échéance", priority: "Priorité", type: "Type", kind: "Type",
  name: "Nom", role: "Rôle", civility: "Civilité", relationship: "Lien", is_primary: "Principal",
  session_date: "Date de séance", duration_min: "Durée (min)", place: "Lieu", activities: "Activités",
  aids: "Aides", engagement: "Engagement", observations: "Observations", advice: "Conseils",
  next_time: "Prochaine fois", summary: "Résumé", starts_at: "Début", progress: "Progression (%)",
  smart_statement: "Objectif SMART", success_indicator: "Indicateur de réussite", target_date: "Date visée",
  review_date: "Date de réévaluation", comments: "Commentaires", recorded_at: "Enregistré le", note: "Note",
  measured_on: "Mesuré le", metric: "Mesure", value: "Valeur", value_max: "Valeur max", label: "Libellé",
  assessment_date: "Date du bilan", reason: "Motif", tests_used: "Tests utilisés", results: "Résultats",
  synthesis: "Synthèse", recommendations: "Recommandations", tool_name: "Outil", domain: "Domaine",
  assessed_on: "Évalué le", score: "Score", result: "Résultat", interpretation: "Interprétation",
  instructions: "Consignes", frequency: "Fréquence", material: "Matériel", rationale: "Objectif visé",
  start_date: "Début", done_at: "Fait le", done: "Fait", difficulty: "Difficulté", comment: "Commentaire",
  period_start: "Début de période", period_end: "Fin de période", worked_on: "Travaillé",
  to_continue: "À poursuivre", exercise: "Exercice", shared_at: "Partagé le", channel: "Canal",
  direction: "Sens", author_name: "Auteur", body: "Message", subject: "Objet", sent_at: "Envoyé le",
  read_at: "Lu le", from_email: "De", to_email: "À", transcript: "Retranscription", caller_name: "Appelant",
  called_at: "Appelé le", duration_sec: "Durée (s)", doc_type: "Type de document", file_url: "Fichier",
  ocr_text: "Texte lu", consent_type: "Consentement", granted: "Accordé", granted_at: "Accordé le",
  revoked_at: "Retiré le", contact_name: "Contact", contact_phone: "Téléphone contact",
  contact_email: "E-mail contact", amount: "Montant", paid_amount: "Montant payé", paid_at: "Payé le",
  invoice_date: "Date facture", number: "Numéro", service: "Prestation", version: "Version",
  reason_text: "Raison", snapshot: "Contenu", media_url: "Média", photo_url: "Photo", video_url: "Vidéo",
  document_url: "Document", link_url: "Lien", audio_url: "Audio", attachments: "Pièces jointes",
  planned_date: "Date prévue", task_type: "Type de tâche", age_group: "Tranche d'âge", school_class: "Classe",
  school_name: "École", referring_pro: "Professionnel adresseur", usual_day: "Jour habituel",
  usual_time: "Heure habituelle", usual_place: "Modalité du suivi", care_start_date: "Début du suivi",
  consultation_reason: "Motif de consultation", diagnosis: "Diagnostic", main_difficulties: "Difficultés principales",
  assessment_summary: "Synthèse des bilans", adaptations: "Adaptations", equipment: "Équipement",
  software: "Logiciels", partners: "Partenaires", tags: "Étiquettes", pinned_info: "Infos épinglées",
  relation: "Lien", is_legal: "Responsable légal", guardian_id: "Identifiant responsable", category: "Catégorie",
  age_range: "Âge", goal_hint: "Objectif", format: "Format", image_url: "Image", success: "Réussite",
  strategy: "Stratégie", source_note_id: "Note d'origine", session_id: "Séance", goal_id: "Objectif lié",
  notify_allowed: "Notifications autorisées", notify_channel: "Canal de notification", receives_reports: "Reçoit les comptes rendus",
  plan: "Prévision", plan_date: "Date prévue", status_label: "Statut",
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const INVERSE = new Map<string, string[]>();
for (const [k, v] of Object.entries(FR)) INVERSE.set(norm(v), [...(INVERSE.get(norm(v)) ?? []), k]);

/** « Contact allowed » (titre sans traduction) → « contact_allowed ». */
const keysFor = (header: string) => INVERSE.get(norm(header)) ?? [norm(header).replace(/\s+/g, "_")];

export function sheetToRows(data: unknown[][]): Raw[] {
  const [head, ...rows] = data;
  if (!head) return [];
  const headers = head.map((h) => String(h ?? "").trim());
  if (headers.length === 1 && headers[0] === "Information") return [];
  return rows
    .filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""))
    .map((r) => {
      const o: Raw = {};
      headers.forEach((h, i) => {
        const v = r[i] === null || r[i] === undefined ? "" : r[i] instanceof Date ? (r[i] as Date).toISOString() : String(r[i]);
        o[`__${h}`] = v; // titre d'origine, pour les documents de reprise
        for (const k of keysFor(h)) if (!(k in o) || o[k] === "") o[k] = v;
      });
      return o;
    });
}

/* ------------------------------------------------------------------ lecture du fichier */

export type Backup = { tables: Record<string, Raw[]>; files: Map<string, Blob>; sheetsFound: number };

export async function readBackup(file: File): Promise<Backup> {
  const files = new Map<string, Blob>();
  let xlsx: Blob | File = file;
  if (/\.zip$/i.test(file.name)) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(file);
    let found: Blob | null = null;
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (/\.xlsx$/i.test(path) && !found) found = await entry.async("blob");
      else if (/^Fichiers\//.test(path)) files.set(path.slice("Fichiers/".length), await entry.async("blob"));
    }
    if (!found) throw new Error("Pas de classeur Excel dans ce fichier .zip.");
    xlsx = found;
  }
  const { default: readXlsx } = await import("read-excel-file/browser");
  const sheets = await readXlsx(xlsx as File);
  const tables: Record<string, Raw[]> = {};
  let sheetsFound = 0;
  for (const { sheet, data } of sheets) {
    const t = SHEETS.find(([, label]) => label.slice(0, 31) === sheet.trim())?.[0];
    if (!t) continue;
    sheetsFound++;
    tables[t] = sheetToRows(data as unknown[][]);
  }
  if (!sheetsFound) throw new Error("Ce classeur ne ressemble pas à une sauvegarde complète (onglets Patients, Notes de séance…).");
  return { tables, files, sheetsFound };
}

/* ------------------------------------------------------------------ outils */

const s = (v: unknown) => {
  const x = v === null || v === undefined ? "" : String(v).trim();
  return x && x !== "null" ? x : null;
};
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isoDay = (v: unknown) => {
  const x = s(v);
  if (!x) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10);
  return parseFrenchDate(x);
};
const now = () => new Date().toISOString();
const meta = (id: string, r?: Raw): SyncedRow => {
  const c = s(r?.created_at);
  const at = c && !Number.isNaN(Date.parse(c)) ? new Date(c).toISOString() : now();
  const u = s(r?.updated_at);
  return { id, owner_id: null, created_at: at, updated_at: u && !Number.isNaN(Date.parse(u)) ? new Date(u).toISOString() : at, deleted_at: null };
};
const nameKey = (last: string, first: string) => norm(`${last}|${first}`).replace(/[^a-z|]/g, "");

/** Identifiant stable tiré d'un texte (pour les lignes sans identifiant : refaire l'import ne double rien). */
export function stableId(text: string): string {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519) ^ (h2 >>> 13);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2) ^ text.length);
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-a${a.slice(17, 20)}-${a.slice(20, 32)}`;
}

/** Colonnes techniques qu'on ne recopie pas dans les documents de reprise. */
const HIDDEN = /^(identifiant.*|cree par|visibilite|wizard|is template|provider sid|attempts|corrected from|.* id)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shown = (v: unknown) => {
  const x = s(v);
  return x && !UUID.test(x) && x !== "[]" && x !== "{}" ? x : null;
};

/** Titres restés en anglais dans l'export → français, pour les documents de reprise. */
const DISPLAY: Record<string, string> = {
  method: "Moyen de paiement", "display name": "Nom", "is active": "Actif", "contact allowed": "Contact autorisé",
  "saved at": "Enregistré le", "change type": "Type de modification", "aid level": "Niveau d'aide",
  "observed performance": "Performance observée", "perceived performance": "Performance perçue",
  "priority level": "Priorité", "difficulty level": "Niveau de difficulté", "evaluated on": "Évalué le",
  "rated on": "Coté le", "identified on": "Identifié le", "resolved at": "Résolu le", "started on": "Commencé le",
  "ended on": "Terminé le", "reviewed on": "Revu le", decision: "Décision", "current performance": "Performance actuelle",
  "current satisfaction": "Satisfaction actuelle", "initial performance": "Performance initiale",
  "initial satisfaction": "Satisfaction initiale", "real time min": "Temps réel (min)", "reported by": "Signalé par",
  "reporter role": "Rôle", "recipient name": "Destinataire", "recipient kind": "Type de destinataire", error: "Erreur",
  "last message at": "Dernier message le", "needs reply": "Réponse attendue", "unread count": "Non lus",
  "external ref": "Référence", "adult involvement": "Implication de l'adulte", "family expectations": "Attentes de la famille",
  "participation impact": "Impact sur la participation", "observed difficulty": "Difficulté observée",
  "is priority": "Prioritaire", informant: "Informateur", context: "Contexte", environment: "Environnement",
  "activity used": "Activité utilisée", adaptation: "Adaptation", "aid score": "Score d'aide",
  performance: "Performance", "performance score": "Score de performance", "is legal": "Responsable légal",
  "link validated": "Lien validé", "ocr status": "Lecture du texte", "ocr done at": "Texte lu le",
};
const label = (h: string) => DISPLAY[norm(h)] ?? h;
const yesNo = (v: string) => (v === "true" ? "oui" : v === "false" ? "non" : v);

function archiveHtml(title: string, sections: { title: string; rows: Raw[] }[]): string {
  const fmt = (v: string) => (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") + (v.length > 10 && !/T00:00/.test(v) ? ` ${v.slice(11, 16)}` : "") : v);
  const body = sections
    .filter((sec) => sec.rows.length)
    .map((sec) => {
      const cols = [...new Set(sec.rows.flatMap((r) => Object.keys(r).filter((k) => k.startsWith("__")).map((k) => k.slice(2))))].filter(
        (c) => !HIDDEN.test(norm(c)) && c !== "Patient" && sec.rows.some((r) => shown(r[`__${c}`])),
      );
      const items = sec.rows
        .map(
          (r) =>
            `<div class="item">${cols
              .filter((c) => shown(r[`__${c}`]))
              .map((c) => `<div><b>${esc(label(c))} :</b> ${esc(yesNo(fmt(String(r[`__${c}`])))).replace(/\n/g, "<br>")}</div>`)
              .join("")}</div>`,
        )
        .join("");
      return `<h2>${esc(sec.title)} <small>(${sec.rows.length})</small></h2>${items}`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1f2a33}h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #dbe2e7}small{color:#55636e;font-weight:normal}.item{border:1px solid #dbe2e7;border-radius:8px;padding:.6rem .8rem;margin:.6rem 0}b{color:#55636e;font-weight:600}</style></head><body><h1>${esc(title)}</h1><p><small>Repris de l'ancienne application.</small></p>${body}</body></html>`;
}

const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", mp3: "audio/mpeg", m4a: "audio/mp4" };
const safe = (x: string) => x.replace(/[\\/:*?"<>|]+/g, "_").trim() || "sans-nom";

/* ------------------------------------------------------------------ conversion */

export type ImportPlan = {
  data: Converted;
  documents: PatientDocument[];
  reports: { patient_id: string; id: string; cr: CrData }[];
  counts: { label: string; n: number }[];
  warnings: string[];
};

/** Patients reconnus (« cabinet » = ressources sans patient). */
export const CABINET = "cabinet";

export function planImport(b: Backup): ImportPlan {
  const T = b.tables;
  const warnings: string[] = [];
  const src: Sources = {};
  for (const t of ["patients", "guardians", "patient_guardians", "clinical_sessions", "next_session_plans", "tasks", "goals", "goal_progress", "assessments", "communications", "parent_reports"] as OldTable[])
    if (T[t]) src[t] = T[t] as never;
  const { data, report } = convert(src);
  warnings.push(...report.warnings);
  const push = <K extends keyof Converted>(t: K, row: SyncedRow) => ((data[t] ??= []) as SyncedRow[]).push(row);

  const patients = new Map((data.patients ?? []).map((p) => [p.id, p as Patient]));
  const byName = new Map<string, string>();
  for (const p of patients.values()) byName.set(nameKey(p.last_name, p.first_name), p.id);
  const fullName = (id: string) => {
    const p = patients.get(id);
    return p ? `${p.first_name} ${p.last_name}`.trim() : "";
  };
  // L'export range les fichiers dans « Fichiers/<Nom> <Prénom>/ ».
  const folderOf = (id: string) => {
    const p = patients.get(id);
    return safe(p ? `${p.last_name} ${p.first_name}`.trim() : "Cabinet");
  };
  const pid = (v: unknown) => {
    const x = s(v);
    return x && patients.has(x) ? x : null;
  };

  // Fiche patient : ce que l'ancienne fiche avait en plus va dans « Remarques ».
  for (const r of T.patients ?? []) {
    const p = patients.get(String(r.id));
    if (!p) continue;
    const extra = [
      ["Adresse", r.address],
      ["Professionnel adresseur", r.referring_pro],
      ["Synthèse des bilans", r.assessment_summary],
      ["Adaptations", r.adaptations],
      ["Équipement", r.equipment],
      ["Logiciels", r.software],
      ["Partenaires", r.partners],
      ["Étiquettes", r.tags],
    ]
      .filter(([, v]) => s(v) && s(v) !== "[]")
      .map(([k, v]) => `${k} : ${s(v)}`);
    if (extra.length) p.notes = [p.notes, ...extra].filter(Boolean).join("\n\n");
  }

  // Autres contacts (enseignant, médecin…) : avec les responsables, sans envoi des comptes rendus.
  for (const r of T.contacts ?? []) {
    const p = pid(r.patient_id);
    if (!p) continue;
    const name = s(r.name) ?? "";
    const [first, ...rest] = name.split(/\s+/);
    push("guardians", {
      ...meta(s(r.id) ?? stableId(`contact|${p}|${name}`), r),
      patient_id: p,
      civility: null,
      first_name: rest.length ? first! : "",
      last_name: rest.length ? rest.join(" ") : name,
      relation: s(r.role) ?? "Autre contact",
      email: s(r.email)?.toLowerCase() ?? null,
      phone: s(r.phone),
      receives_reports: false,
      user_id: null,
    } as Guardian);
  }

  // Notes de séance : une ligne par séance (Nom, Prénom, Date, Note de séance, Note pour la famille).
  const notesByPatient = new Map<string, Note[]>();
  let unknownNotes = 0;
  for (const r of T.progress_notes ?? []) {
    const last = s(r["__Nom"] ?? r.last_name) ?? "";
    const first = s(r["__Prénom"] ?? r.first_name) ?? "";
    const p = byName.get(nameKey(last, first));
    const date = isoDay(r["__Date"] ?? r.note_date);
    const text = s(r["__Note de séance"] ?? r.content) ?? "";
    const fam = s(r["__Note pour la famille"] ?? r.family_content);
    if (!p || !date || (!text && !fam)) {
      unknownNotes++;
      continue;
    }
    const id = stableId(`note|${p}|${date}|${text}`);
    const n: Note = { ...meta(id), created_at: `${date}T12:00:00.000Z`, updated_at: `${date}T12:00:00.000Z`, patient_id: p, kind: "seance", note_date: date, content_html: toHtml(text || fam), raw_text: null };
    push("notes", n);
    notesByPatient.set(p, [...(notesByPatient.get(p) ?? []), n]);
    if (fam)
      push("family_reports", {
        ...meta(stableId(`famille|${id}`)),
        patient_id: p,
        note_id: id,
        report_date: date,
        content: fam,
        status: "envoye",
        sent_at: `${date}T18:00:00.000Z`,
        sent_via: "ancienne application",
        recipients: null,
        published: false,
        patient_first_name: patients.get(p)!.first_name,
      } as FamilyReport);
  }
  if (unknownNotes) warnings.push(`${unknownNotes} note(s) sans patient reconnu (nom, prénom) ou sans date : non reprise(s).`);

  // Anciennes versions : rattachées à la note dont le texte correspond.
  const plain = (h: string) => norm(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const versionsLeft: Raw[] = [];
  const byOldNote = new Map<string, Raw[]>();
  for (const r of T.progress_note_versions ?? []) byOldNote.set(String(r.note_id), [...(byOldNote.get(String(r.note_id)) ?? []), r]);
  for (const [, versions] of byOldNote) {
    const p = pid(versions[0]!.patient_id);
    const candidates = p ? (notesByPatient.get(p) ?? []) : [];
    const texts = new Set(versions.map((v) => plain(toHtml(v.content))));
    const note = candidates.find((n) => texts.has(plain(n.content_html)));
    if (!note || !p) {
      versionsLeft.push(...versions);
      continue;
    }
    for (const v of versions)
      push("note_versions", {
        ...meta(s(v.id) ?? stableId(`version|${note.id}|${v.saved_at}`), v),
        note_id: note.id,
        patient_id: p,
        content_html: toHtml(v.content),
        saved_at: meta("x", { created_at: v.saved_at ?? v.created_at }).created_at,
      } as NoteVersion);
  }

  // Activités de séance : ajoutées à la note de la séance.
  const notesById = new Map((data.notes ?? []).map((n) => [n.id, n as Note]));
  const activitiesLeft: Raw[] = [];
  for (const r of T.session_activities ?? []) {
    const n = notesById.get(String(r.session_id));
    if (!n) {
      activitiesLeft.push(r);
      continue;
    }
    const bits = [s(r.success) && `réussite : ${s(r.success)}`, s(r.difficulty) && `difficulté : ${s(r.difficulty)}`, s(r.engagement) && `engagement : ${s(r.engagement)}`, s(r.strategy) && `stratégie : ${s(r.strategy)}`, s(r.notes)].filter(Boolean);
    n.content_html += `<p><strong>Activité :</strong> ${esc(s(r.title) ?? "")}${bits.length ? ` (${esc(bits.join(" ; "))})` : ""}</p>`;
  }

  // Rendez-vous à venir → ajouts dans Ma journée ; les passés sont gardés dans les documents.
  const today = new Date().toISOString().slice(0, 10);
  const apptsLeft: Raw[] = [];
  for (const r of T.appointments ?? []) {
    const p = pid(r.patient_id);
    const start = s(r.starts_at);
    const d = start ? new Date(start) : null;
    const dayStr = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
    if (p && dayStr && dayStr >= today && !/annul|cancel/i.test(s(r.status) ?? ""))
      push("day_changes", { ...meta(s(r.id) ?? stableId(`rdv|${p}|${start}`), r), patient_id: p, day: dayStr, kind: "ajout", time: `${String(d!.getHours()).padStart(2, "0")}:${String(d!.getMinutes()).padStart(2, "0")}` } as DayChange);
    else apptsLeft.push(r);
  }

  // Mesures d'objectif → progrès (avec la valeur en commentaire).
  const goals = new Map((data.goals ?? []).map((g) => [g.id, g as Goal]));
  const measuresLeft: Raw[] = [];
  for (const r of T.goal_measurements ?? []) {
    const g = goals.get(String(r.goal_id));
    if (!g) {
      measuresLeft.push(r);
      continue;
    }
    const v = Number(String(r.value).replace(",", "."));
    const max = Number(String(r.value_max).replace(",", "."));
    push("goal_progress", {
      ...meta(s(r.id) ?? stableId(`mesure|${g.id}|${r.measured_on}|${r.value}`), r),
      goal_id: g.id,
      patient_id: g.patient_id,
      progress: Number.isFinite(v) && Number.isFinite(max) && max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : g.progress,
      comment: [s(r.label) ?? s(r.metric), `${s(r.value) ?? ""}${s(r.value_max) ? ` / ${s(r.value_max)}` : ""}`, s(r.note)].filter(Boolean).join(" : "),
      recorded_on: isoDay(r.measured_on) ?? today,
    } as GoalProgress);
  }

  // Résultats de tests → ajoutés aux résultats du bilan.
  const assessments = new Map((data.assessments ?? []).map((a) => [a.id, a as unknown as { results: string | null }]));
  const testsLeft: Raw[] = [];
  for (const r of T.assessment_results ?? []) {
    const a = assessments.get(String(r.assessment_id));
    if (!a || s(r.is_template) === "true") {
      if (s(r.is_template) !== "true") testsLeft.push(r);
      continue;
    }
    const line = [s(r.tool_name), s(r.domain)].filter(Boolean).join(" – ") + ` : ${[s(r.score), s(r.result), s(r.interpretation)].filter(Boolean).join(", ")}`;
    a.results = [a.results, line].filter(Boolean).join("\n");
  }

  // Transmissions aux familles → historique des envois.
  for (const r of T.family_updates ?? []) {
    const p = pid(r.patient_id);
    if (!p) continue;
    const content = [
      s(r.content),
      s(r.worked_on) && `Travaillé : ${s(r.worked_on)}`,
      s(r.progress) && `Progrès : ${s(r.progress)}`,
      s(r.to_continue) && `À poursuivre : ${s(r.to_continue)}`,
      s(r.exercise) && `À faire à la maison : ${s(r.exercise)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!content) continue;
    const d = isoDay(r.shared_at) ?? isoDay(r.period_end) ?? isoDay(r.created_at) ?? today;
    push("family_reports", {
      ...meta(s(r.id) ?? stableId(`transmission|${p}|${d}|${content}`), r),
      patient_id: p,
      note_id: null,
      report_date: d,
      content,
      status: s(r.shared_at) ? "envoye" : "brouillon",
      sent_at: s(r.shared_at) ? meta("x", { created_at: r.shared_at }).created_at : null,
      sent_via: "ancienne application",
      recipients: null,
      published: false,
      patient_first_name: patients.get(p)!.first_name,
    } as FamilyReport);
  }

  // Appels : les informations clés (résumé, notes), jamais la retranscription intégrale.
  for (const r of T.call_logs ?? []) {
    const p = pid(r.patient_id);
    if (s(r.patient_id) && !p) continue;
    push("communications", {
      ...meta(s(r.id) ?? stableId(`appel|${r.called_at}|${r.phone}`), r),
      patient_id: p,
      channel: "appel",
      direction: "entrant",
      occurred_at: meta("x", { created_at: r.called_at ?? r.created_at }).created_at,
      counterpart: s(r.caller_name) ?? s(r.phone),
      subject: null,
      body: s(r.notes),
      summary: s(r.summary),
      status: "traite",
      external_id: null,
      thread_id: null,
    } as Communication);
  }
  if ((T.call_logs ?? []).some((r) => s(r.transcript))) warnings.push("Appels : seuls les résumés et notes sont repris, pas les retranscriptions intégrales.");

  // Rapports → comptes rendus d'évolution (onglet Comptes rendus).
  const reports: ImportPlan["reports"] = [];
  for (const r of T.progress_reports ?? []) {
    const p = pid(r.patient_id);
    if (!p || !s(r.content)) continue;
    reports.push({
      patient_id: p,
      id: s(r.id) ?? stableId(`rapport|${p}|${r.content}`),
      cr: {
        kind: "evolution",
        title: "Compte rendu d'évolution en ergothérapie",
        recipient: "",
        cr_date: isoDay(r.period_end) ?? isoDay(r.created_at),
        period_from: isoDay(r.period_start),
        period_to: isoDay(r.period_end),
        assessment_id: null,
        html: toHtml(r.content),
      },
    });
  }

  /* ---------------- documents et fichiers */
  const documents: PatientDocument[] = [];
  const used = new Set<string>();
  const filesOf = (folder: string) => [...b.files.entries()].filter(([path]) => path.startsWith(`${folder}/`));
  const findFile = (folder: string, name: string, url: string | null) => {
    const ext = url?.split(".").pop() ?? "";
    const wanted = [safe(name), `${safe(name)}.${ext}`].map(norm);
    return filesOf(folder).find(([path]) => !used.has(path) && wanted.includes(norm(path.split("/").pop()!.replace(/^\d{4}-/, ""))));
  };
  const addFile = (patientId: string, path: string, blob: Blob, title: string, extra: Partial<PatientDocument> = {}) => {
    used.add(path);
    const fileName = path.split("/").pop()!.replace(/^\d{4}-/, "");
    const ext = fileName.split(".").pop()!.toLowerCase();
    const mime = blob.type || MIME[ext] || "application/octet-stream";
    documents.push({
      ...meta(stableId(`fichier|${path}|${blob.size}`)),
      patient_id: patientId,
      note_id: null,
      title,
      category: mime.startsWith("image/") ? "photo" : "autre",
      doc_date: null,
      file_name: fileName,
      mime,
      size: blob.size,
      blob: mime === blob.type ? blob : new Blob([blob], { type: mime }),
      ...extra,
    });
  };
  const CAT: Record<string, PatientDocument["category"]> = { bilan: "bilan", courrier: "courrier", ecole: "ecole", école: "ecole", medical: "medical", médical: "medical", ordonnance: "medical" };
  for (const r of T.documents ?? []) {
    const p = pid(r.patient_id) ?? CABINET;
    const folder = p === CABINET ? "Cabinet" : folderOf(p);
    const name = s(r.name) ?? String(s(r.file_url) ?? "").split("/").pop() ?? "Document";
    const f = findFile(folder, name, s(r.file_url));
    const extra: Partial<PatientDocument> = {
      ...meta(s(r.id) ?? stableId(`doc|${p}|${name}`), r),
      category: CAT[norm(s(r.doc_type) ?? "")] ?? undefined,
      doc_date: isoDay(r.created_at),
      text: s(r.ocr_text),
    };
    if (f) addFile(p, f[0], f[1], name.replace(/\.[a-z0-9]{2,4}$/i, ""), Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)));
    else if (s(r.ocr_text))
      documents.push({
        ...(meta(String(extra.id)) as SyncedRow),
        patient_id: p,
        note_id: null,
        title: `${name} (texte lu)`,
        category: extra.category ?? "autre",
        doc_date: extra.doc_date ?? null,
        file_name: `${safe(name)}.txt`,
        mime: "text/plain",
        size: new Blob([s(r.ocr_text)!]).size,
        blob: new Blob([s(r.ocr_text)!], { type: "text/plain" }),
        text: s(r.ocr_text),
      });
  }

  // Documents de reprise lisibles, pour ce qui n'a pas d'équivalent dans l'application.
  const GROUPS: { title: string; parts: [string, Raw[] | undefined][] }[] = [
    { title: "Consentements", parts: [["Consentements", T.consents]] },
    { title: "Factures et paiements", parts: [["Factures", T.invoices], ["Paiements", (T.payments ?? []).map((pay) => ({ ...pay, patient_id: (T.invoices ?? []).find((i) => s(i.id) === s(pay.invoice_id))?.patient_id ?? "" }))]] },
    { title: "Séances et rendez-vous", parts: [["Rendez-vous", apptsLeft], ["Activités de séance", activitiesLeft], ["Anciennes versions de notes", versionsLeft]] },
    { title: "Suivi des objectifs", parts: [["Historique des objectifs", T.goal_versions], ["Résultats par séance", T.session_goal_results], ["Points d'étape", T.progress_reviews], ["Mesures", measuresLeft]] },
    { title: "Profil occupationnel", parts: [["Profil occupationnel", T.patient_occupations], ["Cotations", T.occupation_ratings], ["Difficultés", T.occupational_issues], ["Facteurs", T.patient_factors], ["Adaptations", T.patient_adaptations], ["Résultats de tests", testsLeft]] },
    { title: "Exercices maison", parts: [["Exercices maison", T.home_exercises], ["Retours des familles", (T.exercise_results ?? []).map((x) => ({ ...x, patient_id: x.patient_id || (T.home_exercises ?? []).find((e) => s(e.id) === s(x.exercise_id))?.patient_id || "" }))]] },
    { title: "Envois aux familles", parts: [["Envois", T.parent_notifications]] },
    { title: "Conversations", parts: [["Conversations", T.communication_threads]] },
    { title: "Modèles de messages", parts: [["Modèles", T.message_templates]] },
    { title: "Praticiens", parts: [["Praticiens", T.practitioners]] },
    { title: "Supports", parts: [["Supports", T.therapy_supports]] },
  ];
  const owners = new Set<string>([CABINET, ...patients.keys()]);
  for (const g of GROUPS) {
    for (const owner of owners) {
      const sections = g.parts.map(([title, rows]) => ({ title, rows: (rows ?? []).filter((r) => (pid(r.patient_id) ?? CABINET) === owner) })).filter((x) => x.rows.length);
      if (!sections.length) continue;
      const who = owner === CABINET ? "cabinet" : fullName(owner);
      const html = archiveHtml(`${g.title} — ${who}`, sections);
      const blob = new Blob([html], { type: "text/html" });
      documents.push({ ...meta(stableId(`reprise|${g.title}|${owner}`)), patient_id: owner, note_id: null, title: `Repris : ${g.title}`, category: "autre", doc_date: null, file_name: `${safe(g.title)}.html`, mime: "text/html", size: blob.size, blob });
    }
  }

  // Tous les autres fichiers du .zip (photos, vidéos, supports…) : rangés chez le bon patient.
  const folderOwner = new Map<string, string>([["Cabinet", CABINET], ...[...patients.keys()].map((id) => [folderOf(id), id] as [string, string])]);
  for (const [path, blob] of b.files) {
    if (used.has(path)) continue;
    const owner = folderOwner.get(path.split("/")[0]!) ?? CABINET;
    const name = path.split("/").pop()!.replace(/^\d{4}-/, "");
    addFile(owner, path, blob, name === "photo-profil" || /^photo-profil\./.test(name) ? "Photo de profil" : name.replace(/\.[a-z0-9]{2,4}$/i, ""));
  }

  const n = (t: keyof Converted) => data[t]?.length ?? 0;
  const counts = [
    { label: "Patients", n: n("patients") },
    { label: "Responsables et contacts", n: n("guardians") },
    { label: "Notes de séance", n: n("notes") },
    { label: "Anciennes versions de notes", n: n("note_versions") },
    { label: "Prévisions", n: n("forecasts") },
    { label: "Tâches", n: n("tasks") },
    { label: "Rendez-vous à venir (Ma journée)", n: n("day_changes") },
    { label: "Objectifs", n: n("goals") },
    { label: "Progrès et mesures", n: n("goal_progress") },
    { label: "Bilans", n: n("assessments") },
    { label: "Envois et transmissions aux familles", n: n("family_reports") },
    { label: "Échanges (messages, appels)", n: n("communications") },
    { label: "Comptes rendus", n: reports.length },
    { label: "Documents, photos et fichiers", n: documents.filter((d) => !d.title.startsWith("Repris : ")).length },
    { label: "Documents de reprise (consentements, factures, profil occupationnel, exercices…)", n: documents.filter((d) => d.title.startsWith("Repris : ")).length },
  ].filter((c) => c.n > 0);
  return { data, documents, reports, counts, warnings };
}

/** Enregistre tout sur l'appareil. Une version plus récente déjà présente n'est pas remplacée. */
export async function applyFullImport(plan: ImportPlan): Promise<number> {
  let n = await applyImport(plan.data);
  for (const d of plan.documents) {
    const local = await db.documents.get(d.id);
    if (local && local.updated_at >= d.updated_at) continue;
    await db.documents.put(d);
    n++;
  }
  for (const r of plan.reports) {
    if (await db.documents.get(r.id)) continue;
    await saveReport(r.patient_id, r.cr, r.id);
    n++;
  }
  return n;
}
