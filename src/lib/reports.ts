/**
 * Comptes rendus (bilan, évolution, courrier) rédigés dans l'application puis exportés en Word.
 * Ils sont gardés dans la table locale `documents` (catégorie « compte_rendu ») : pas de nouvelle
 * table, inclus dans la sauvegarde chiffrée et transmis par la liaison téléphone ↔ ordinateur.
 */
import { AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { activityHistory, chartSvgString, fieldUnit, numericFields, progressSentence, seriesOf, svgToPng } from "./activity-progress";
import { ageFrom, fmtDay, parseDay } from "./dates";
import { db, getMeta } from "./db";
import { htmlToParagraphs } from "./export-docx";
import { FREQUENCY_LABEL, GOAL_STATUS_LABEL, fullName } from "./labels";
import { newId, stamp } from "./repo";
import type { Activity, Assessment, Goal, IsoDay, Note, Patient, PatientDocument } from "./types";

export type CrKind = "bilan" | "evolution" | "courrier";

export const CR_KIND_LABEL: Record<CrKind, string> = {
  bilan: "Compte rendu de bilan",
  evolution: "Compte rendu d'évolution",
  courrier: "Courrier",
};

export const RECIPIENTS = ["Médecin traitant", "Médecin prescripteur", "Enseignant(e)", "Famille", "MDPH", "Orthophoniste", "Psychomotricien(ne)"];

export interface CrData {
  kind: CrKind;
  title: string;
  recipient: string;
  cr_date: IsoDay | null;
  period_from: IsoDay | null;
  period_to: IsoDay | null;
  assessment_id: string | null;
  html: string;
  /** Compte rendu d'évolution : ajouter les courbes de progression des activités dans le Word. */
  charts?: boolean;
}

export interface Report extends CrData {
  id: string;
  patient_id: string;
  updated_at: string;
}

/** En-tête des comptes rendus (Paramètres). Gardé sur l'appareil, jamais dans le code. */
export interface Cabinet {
  name: string;
  profession: string;
  address: string;
  phone: string;
  email: string;
  rpps: string;
  city: string;
}
export const EMPTY_CABINET: Cabinet = { name: "", profession: "Ergothérapeute D.E.", address: "", phone: "", email: "", rpps: "", city: "" };
export async function getCabinet(): Promise<Cabinet> {
  return { ...EMPTY_CABINET, ...((await getMeta<Partial<Cabinet>>("cabinet")) ?? {}) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (s?: string | null) =>
  s?.trim() ? s.trim().split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join("") : "<p></p>";
const section = (title: string, body: string) => `<h3>${esc(title)}</h3>${body}`;

/* ------------------------------------------------------------------ notes en rubriques */

export { noteParts, type NoteParts } from "./session-note";
import { noteParts } from "./session-note";

/* ------------------------------------------------------------------ pré-remplissage */

export function crFromAssessment(p: Patient, a: Assessment): CrData {
  const html = [
    section("Motif du bilan", para(a.reason ?? p.consultation_reason)),
    a.tests_used ? section("Outils et tests utilisés", para(a.tests_used)) : "",
    a.results ? section("Résultats", para(a.results)) : "",
    a.observations ? section("Observations cliniques", para(a.observations)) : "",
    section("Synthèse", para(a.synthesis)),
    section("Préconisations", para(a.recommendations)),
  ].join("");
  return {
    kind: "bilan",
    title: CR_KIND_LABEL.bilan + " en ergothérapie",
    recipient: "",
    cr_date: null,
    period_from: null,
    period_to: null,
    assessment_id: a.id,
    html,
  };
}

export function inPeriod(n: Note, from: IsoDay | null, to: IsoDay | null) {
  return n.kind === "seance" && !n.deleted_at && (!from || n.note_date >= from) && (!to || n.note_date <= to);
}

/** Mesures des activités enregistrées sur la période, pour le compte rendu. */
export function periodProgress(activities: Activity[], notes: Note[], from: IsoDay | null, to: IsoDay | null) {
  const inP = notes.filter((n) => inPeriod(n, from, to));
  return activities.map((a) => ({ a, h: activityHistory(a, inP) })).filter((x) => x.h.length > 0);
}

export function crEvolution(p: Patient, notes: Note[], goals: Goal[], from: IsoDay | null, to: IsoDay | null, activities: Activity[] = []): CrData {
  const sessions = notes.filter((n) => inPeriod(n, from, to)).sort((a, b) => a.note_date.localeCompare(b.note_date));
  const freq = p.frequency ? FREQUENCY_LABEL[p.frequency as keyof typeof FREQUENCY_LABEL]?.toLowerCase() : null;
  const cadre =
    `Suivi en ergothérapie${freq ? ` ${freq}` : ""}` +
    (sessions.length
      ? ` : ${sessions.length} séance${sessions.length > 1 ? "s" : ""} entre le ${fmtDay(sessions[0]!.note_date)} et le ${fmtDay(sessions.at(-1)!.note_date)}.`
      : ".");
  const active = goals.filter((g) => !g.deleted_at);
  const goalItems = active
    .map((g) => {
      const worked = sessions.filter((n) => n.goal_ids?.includes(g.id)).length;
      const details = [GOAL_STATUS_LABEL[g.status], g.progress ? `avancement ${g.progress} %` : "", worked ? `travaillé en ${worked} séance${worked > 1 ? "s" : ""}` : ""]
        .filter(Boolean)
        .join(", ");
      return `<li>${esc(g.title)}${details ? ` (${esc(details)})` : ""}</li>`;
    })
    .join("");
  const obs = sessions
    .map((n) => { const p = noteParts(n.content_html); return { d: n.note_date, o: p.observe || p.autre }; })
    .filter((x) => x.o)
    .map((x) => `<li><em>${fmtDay(x.d)}</em> : ${esc(x.o)}</li>`)
    .join("");
  const last = [...sessions].reverse().map((n) => noteParts(n.content_html).reprendre).find(Boolean);
  const prog = periodProgress(activities, notes, from, to);
  const progItems = prog.map(({ a, h }) => `<li>${esc(progressSentence(a, h))}</li>`).join("");
  const html = [
    section("Motif de la prise en charge", para(p.consultation_reason)),
    section("Cadre du suivi", para(cadre)),
    goalItems ? section("Objectifs travaillés", `<ul>${goalItems}</ul>`) : "",
    section("Évolution observée", obs ? `<p><em>Observations des séances, à résumer :</em></p><ul>${obs}</ul>` : "<p></p>"),
    progItems ? section("Progression des activités", `<ul>${progItems}</ul>`) : "",
    section("Perspectives", para(last)),
  ].join("");
  const charts = prog.some(({ a, h }) => numericFields(a, h).length > 0);
  return { kind: "evolution", title: CR_KIND_LABEL.evolution + " en ergothérapie", recipient: "", cr_date: null, period_from: from, period_to: to, assessment_id: null, html, charts };
}

export function crLetter(): CrData {
  return { kind: "courrier", title: "", recipient: "", cr_date: null, period_from: null, period_to: null, assessment_id: null, html: "<p></p>" };
}

/** Éléments envoyés à l'assistant (le nom du patient est masqué ensuite par askAssistant). */
export function crMaterial(p: Patient, cr: CrData, notes: Note[], goals: Goal[], max = 9000): string {
  const age = ageFrom(p.birth_date);
  const head = [
    `Type : ${CR_KIND_LABEL[cr.kind]}`,
    cr.recipient ? `Destinataire : ${cr.recipient}` : "",
    `Patient : ${fullName(p)}${age !== null ? `, ${age} ans` : ""}${p.school_class ? `, ${p.school_class}` : ""}`,
    p.consultation_reason ? `Motif de prise en charge : ${p.consultation_reason}` : "",
  ].filter(Boolean);
  const draft = `Brouillon actuel :\n${htmlToMd(cr.html)}`;
  if (cr.kind !== "evolution") return [...head, "", draft].join("\n");
  const sessions = notes.filter((n) => inPeriod(n, cr.period_from, cr.period_to)).sort((a, b) => b.note_date.localeCompare(a.note_date));
  const lines: string[] = [];
  let size = 0;
  for (const n of sessions) {
    const parts = noteParts(n.content_html);
    const l = `- ${fmtDay(n.note_date)} — Fait : ${parts.fait || "—"} | Observé : ${parts.observe || parts.autre || "—"} | À reprendre : ${parts.reprendre || "—"}`;
    if (size + l.length > max) break;
    lines.unshift(l);
    size += l.length;
  }
  const g = goals.filter((x) => !x.deleted_at).map((x) => `- ${x.title} (${GOAL_STATUS_LABEL[x.status]}${x.progress ? `, ${x.progress} %` : ""})`);
  return [...head, "", "Objectifs :", ...g, "", "Notes de séance (de la plus ancienne à la plus récente) :", ...lines, "", draft].join("\n");
}

/* ------------------------------------------------------------------ texte ↔ HTML */

/** HTML de l'éditeur → texte simple avec « ## » pour les intertitres et « - » pour les listes. */
export function htmlToMd(html: string): string {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const out: string[] = [];
  for (const el of [...doc.body.children]) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) out.push(`\n## ${el.textContent?.trim()}`);
    else if (tag === "ul" || tag === "ol") [...el.children].forEach((li) => out.push(`- ${li.textContent?.trim()}`));
    else if (el.textContent?.trim()) out.push(el.textContent.trim());
  }
  return out.join("\n").trim();
}

/** Réponse de l'assistant (« ## Titre », « - point ») → HTML de l'éditeur. */
export function mdToHtml(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const l = raw.trim().replace(/\*\*(.+?)\*\*/g, "$1");
    if (!l) {
      flush();
      continue;
    }
    const h = l.match(/^#{1,4}\s*(.+)$/);
    const li = l.match(/^[-•*]\s+(.+)$/);
    if (h) {
      flush();
      out.push(`<h3>${esc(h[1]!.replace(/\s*:$/, ""))}</h3>`);
    } else if (li) list.push(esc(li[1]!));
    else {
      flush();
      out.push(`<p>${esc(l)}</p>`);
    }
  }
  flush();
  return out.join("") || "<p></p>";
}

/* ------------------------------------------------------------------ enregistrement */

const MIME = "application/vnd.carnet2suivi.cr+json";

export async function readReport(d: PatientDocument): Promise<Report> {
  const text = await (d.blob.text ? d.blob.text() : new Response(d.blob).text());
  return { ...(JSON.parse(text) as CrData), id: d.id, patient_id: d.patient_id, updated_at: d.updated_at };
}

export function reportTitle(cr: CrData) {
  return `${cr.title || CR_KIND_LABEL[cr.kind]}${cr.recipient ? ` — ${cr.recipient}` : ""}`;
}

export async function saveReport(patientId: string, cr: CrData, id?: string): Promise<string> {
  const at = stamp();
  const existing = id ? await db.documents.get(id) : undefined;
  const blob = new Blob([JSON.stringify(cr)], { type: MIME });
  const row: PatientDocument = {
    id: id ?? newId(),
    owner_id: existing?.owner_id ?? null,
    created_at: existing?.created_at ?? at,
    updated_at: at,
    deleted_at: null,
    patient_id: patientId,
    note_id: null,
    title: reportTitle(cr),
    category: "compte_rendu",
    doc_date: cr.cr_date,
    file_name: "compte-rendu.json",
    mime: MIME,
    size: blob.size,
    blob,
  };
  await db.documents.put(row);
  return row.id;
}

/* ------------------------------------------------------------------ Word */

export type ChartImage = { title: string; data: Uint8Array; width: number; height: number };

/** Images des courbes (navigateur) pour un compte rendu d'évolution. */
export async function crCharts(cr: CrData, activities: Activity[], notes: Note[]): Promise<ChartImage[]> {
  if (cr.kind !== "evolution" || !cr.charts) return [];
  const out: ChartImage[] = [];
  for (const { a, h } of periodProgress(activities, notes, cr.period_from, cr.period_to)) {
    for (const f of numericFields(a, h)) {
      const unit = fieldUnit(a.template, f);
      const title = `${a.title} : ${f}${unit ? ` (${unit})` : ""}`;
      out.push({ title, ...(await svgToPng(chartSvgString(seriesOf(h, f), unit, title))) });
    }
  }
  return out;
}

export async function buildReportDocx(cr: CrData, p: Patient, cab: Cabinet, charts: ChartImage[] = []): Promise<Blob> {
  const small = { size: 20 };
  const children: Paragraph[] = [];
  const headerLines = [cab.name, cab.profession, ...cab.address.split("\n"), cab.phone && `Tél. ${cab.phone}`, cab.email, cab.rpps && `RPPS / ADELI : ${cab.rpps}`].filter(Boolean) as string[];
  headerLines.forEach((l, i) => children.push(new Paragraph({ children: [new TextRun({ text: l, bold: i === 0, ...small })] })));
  if (cr.cr_date)
    children.push(
      new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 200 }, children: [new TextRun(`${cab.city ? `${cab.city}, le ` : "Le "}${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(parseDay(cr.cr_date))}`)] }),
    );
  if (cr.recipient) children.push(new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: "À l'attention de : ", bold: true }), new TextRun(cr.recipient)] }));
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 360, after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 4 } },
      children: [new TextRun({ text: (cr.title || CR_KIND_LABEL[cr.kind]).toUpperCase(), bold: true, size: 28 })],
    }),
  );
  const age = ageFrom(p.birth_date, cr.cr_date ?? undefined);
  const ident = [
    fullName(p),
    p.birth_date ? `né(e) le ${fmtDay(p.birth_date)}${age !== null ? ` (${age} ans)` : ""}` : "",
    [p.school_class, p.school_name].filter(Boolean).join(", "),
  ].filter(Boolean);
  children.push(new Paragraph({ children: [new TextRun({ text: "Concernant : ", bold: true }), new TextRun(ident.join(", "))] }));
  if (cr.period_from || cr.period_to)
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Période : ", bold: true }), new TextRun(`${cr.period_from ? `du ${fmtDay(cr.period_from)} ` : ""}${cr.period_to ? `au ${fmtDay(cr.period_to)}` : "à ce jour"}`)],
      }),
    );
  children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
  // Intertitres en gras, avec un peu d'air.
  const body = htmlToParagraphs(cr.html.replace(/<h[1-6]>(.*?)<\/h[1-6]>/g, "<p><strong>$1</strong></p>"));
  children.push(...body);
  if (charts.length) {
    children.push(new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text: "Courbes de progression", bold: true })] }));
    // Largeur utile d'une page A4 : environ 600 px.
    for (const c of charts) {
      const k = Math.min(1, 560 / c.width);
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [new ImageRun({ type: "png", data: c.data, transformation: { width: Math.round(c.width * k), height: Math.round(c.height * k) }, altText: { name: c.title, description: c.title, title: c.title } })],
        }),
      );
    }
  }
  if (cab.name)
    children.push(
      new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 480 }, children: [new TextRun({ text: cab.name, bold: true })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(cab.profession)] }),
    );
  const doc = new Document({
    creator: "Carnet de suivi",
    title: cr.title || CR_KIND_LABEL[cr.kind],
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        children,
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Document confidentiel, couvert par le secret professionnel.", italics: true, size: 16, color: "777777" })] })],
          }),
        },
      },
    ],
  });
  return Packer.toBlob(doc);
}

export function reportFileName(cr: CrData, p: Patient) {
  const base = `${CR_KIND_LABEL[cr.kind]} ${p.first_name} ${p.last_name}${cr.cr_date ? ` ${cr.cr_date}` : ""}`;
  return base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w -]+/g, "").replace(/\s+/g, "-") + ".docx";
}
