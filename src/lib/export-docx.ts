import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type IRunOptions,
} from "docx";
import { ageFrom, fmtDay } from "./dates";
import { GOAL_STATUS_LABEL, STATUS_LABEL, fullName } from "./labels";
import type { Assessment, Goal, Note, Patient } from "./types";

/** Convertit le HTML limité de l'éditeur en paragraphes Word (gras, italique, couleur, listes). */
export function htmlToParagraphs(html: string): Paragraph[] {
  const doc = new DOMParser().parseFromString(html || "<p></p>", "text/html");
  const out: Paragraph[] = [];

  const runs = (node: Node, style: Partial<IRunOptions> = {}): TextRun[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ? [new TextRun({ ...style, text: node.textContent })] : [];
    }
    if (!(node instanceof HTMLElement)) return [];
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return [new TextRun({ ...style, break: 1 })];
    const next: Partial<IRunOptions> = { ...style };
    if (tag === "strong" || tag === "b") Object.assign(next, { bold: true });
    if (tag === "em" || tag === "i") Object.assign(next, { italics: true });
    if (tag === "u") Object.assign(next, { underline: {} });
    const color = node.style?.color;
    if (color) {
      const hex = toHex(color);
      if (hex) Object.assign(next, { color: hex });
    }
    return [...node.childNodes].flatMap((c) => runs(c, next));
  };

  const block = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      [...el.children].forEach((li) =>
        out.push(new Paragraph({ children: runs(li), bullet: { level: 0 } })),
      );
    } else if (/^h[1-6]$/.test(tag)) {
      out.push(new Paragraph({ children: runs(el, { bold: true }) }));
    } else {
      out.push(new Paragraph({ children: runs(el), spacing: { after: 80 } }));
    }
  };

  [...doc.body.children].forEach(block);
  if (out.length === 0 && doc.body.textContent?.trim()) {
    out.push(new Paragraph({ children: runs(doc.body) }));
  }
  return out;
}

function toHex(color: string): string | null {
  if (color.startsWith("#")) return color.slice(1, 7);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
  new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });

const field = (label: string, value?: string | null) =>
  value
    ? new Paragraph({ children: [new TextRun({ text: `${label} : `, bold: true }), new TextRun(value)] })
    : null;

export type DossierExport = {
  patient: Patient;
  notes: Note[];
  assessments: Assessment[];
  goals: Goal[];
  from?: string | null;
  to?: string | null;
};

export async function buildDossierDocx(d: DossierExport): Promise<Blob> {
  const { patient: p } = d;
  const age = ageFrom(p.birth_date);
  const inRange = (day: string | null) =>
    !!day && (!d.from || day >= d.from) && (!d.to || day <= d.to);
  const notes = d.notes
    .filter((n) => n.kind === "seance" && inRange(n.note_date))
    .sort((a, b) => a.note_date.localeCompare(b.note_date));

  const children = [
    new Paragraph({
      text: `Dossier d'ergothérapie — ${fullName(p)}`,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    h("Informations", HeadingLevel.HEADING_1),
    field("Date de naissance", p.birth_date ? `${fmtDay(p.birth_date)}${age !== null ? ` (${age} ans)` : ""}` : null),
    field("Statut", STATUS_LABEL[p.status]),
    field("Début du suivi", p.care_start_date ? fmtDay(p.care_start_date) : null),
    field("Motif de consultation", p.consultation_reason),
    field("Diagnostic connu", p.diagnosis),
    field("Établissement", [p.school_name, p.school_class].filter(Boolean).join(" — ") || null),
  ];

  const assessments = d.assessments.filter((a) => !a.deleted_at);
  if (assessments.length) {
    children.push(h("Bilans", HeadingLevel.HEADING_1));
    for (const a of assessments) {
      children.push(h(`Bilan du ${fmtDay(a.assessment_date)}`, HeadingLevel.HEADING_2));
      children.push(
        field("Motif", a.reason),
        field("Outils utilisés", a.tests_used),
        field("Résultats", a.results),
        field("Observations", a.observations),
        field("Synthèse", a.synthesis),
        field("Préconisations", a.recommendations),
      );
    }
  }

  const goals = d.goals.filter((g) => !g.deleted_at);
  if (goals.length) {
    children.push(h("Objectifs", HeadingLevel.HEADING_1));
    for (const g of goals) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: g.title, bold: true }),
            new TextRun(` — ${GOAL_STATUS_LABEL[g.status]}, ${g.progress} %`),
          ],
        }),
      );
      if (g.smart_statement) children.push(new Paragraph({ text: g.smart_statement, indent: { left: 720 } }));
    }
  }

  if (notes.length) {
    children.push(h("Notes de séance", HeadingLevel.HEADING_1));
    for (const n of notes) {
      children.push(h(`Séance du ${fmtDay(n.note_date)}`, HeadingLevel.HEADING_2));
      children.push(...htmlToParagraphs(n.content_html));
    }
  }

  const doc = new Document({
    creator: "Carnet de suivi",
    title: `Dossier ${fullName(p)}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: children.filter((c): c is Paragraph => c !== null) }],
  });
  return Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * Carnet de liaison pour la famille : tous les récaps transmis et ce qu'il faut faire à la maison.
 * Sans serveur, c'est ce qui remplace l'espace famille (à envoyer ou imprimer).
 */
export async function buildFamilyBookletDocx(p: Patient, reports: { report_date: string; content: string }[]): Promise<Blob> {
  const { splitFamilyMessage } = await import("./session-note");
  const children: Paragraph[] = [
    new Paragraph({ text: `Carnet de liaison — ${p.first_name}`, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: "Suivi en ergothérapie", alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
  ];
  const sorted = [...reports].sort((a, b) => b.report_date.localeCompare(a.report_date));
  const homes = sorted.map((r) => ({ day: r.report_date, ...splitFamilyMessage(r.content) })).filter((r) => r.home);
  if (homes[0]) {
    children.push(h("À faire à la maison en ce moment", HeadingLevel.HEADING_1));
    homes[0].home.split("\n").filter(Boolean).forEach((l) => children.push(new Paragraph({ text: l.replace(/^[-•]\s*/, ""), bullet: { level: 0 } })));
  }
  children.push(h("Les séances", HeadingLevel.HEADING_1));
  for (const r of sorted) {
    const { recap, home } = splitFamilyMessage(r.content);
    children.push(h(`Séance du ${fmtDay(r.report_date)}`, HeadingLevel.HEADING_2));
    recap.split("\n").filter(Boolean).forEach((l) => children.push(new Paragraph({ text: l, spacing: { after: 80 } })));
    if (home) {
      children.push(new Paragraph({ children: [new TextRun({ text: "À faire à la maison : ", bold: true })] }));
      home.split("\n").filter(Boolean).forEach((l) => children.push(new Paragraph({ text: l.replace(/^[-•]\s*/, ""), bullet: { level: 0 } })));
    }
  }
  const doc = new Document({
    creator: "Carnet de suivi",
    title: `Carnet de liaison ${p.first_name}`,
    styles: { default: { document: { run: { font: "Calibri", size: 24 } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
