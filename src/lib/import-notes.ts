/**
 * Importation de notes existantes, d'où qu'elles viennent :
 * - un tableau (Excel ou CSV) avec une ligne par séance : patient, date, texte ;
 * - un texte ou un document Word pour un patient, découpé aux dates rencontrées.
 */
import { normalize } from "./search";
import type { IsoDay, Patient } from "./types";

const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Reconnaît une date française ou ISO ; renvoie AAAA-MM-JJ ou null. */
export function parseFrenchDate(s: string): IsoDay | null {
  const t = normalize(s);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = t.match(/^(?:[a-z]+\s+)?(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!);
    if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`;
  }
  return null;
}

/** Une date Excel peut arriver comme objet Date ou comme nombre de jours depuis 1900. */
export function cellToDate(v: unknown): IsoDay | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return typeof v === "string" ? parseFrenchDate(v.trim()) : null;
}

export type ImportedNote = { patientLabel: string; first?: string; last?: string; date: IsoDay | null; text: string };

const COLS = {
  patient: ["patient", "enfant", "nom complet", "beneficiaire", "eleve"],
  first: ["prenom"],
  last: ["nom", "nom de famille"],
  date: ["date", "date de seance", "seance", "jour"],
  text: ["note", "notes", "observation", "observations", "contenu", "texte", "compte rendu", "compte-rendu", "commentaire", "remarques"],
};

/** Tableau (première ligne = titres des colonnes) → notes. Les colonnes sont devinées d'après leur titre. */
export function notesFromTable(rows: unknown[][]): { notes: ImportedNote[]; missing: string[] } {
  const [head, ...body] = rows;
  if (!head) return { notes: [], missing: ["la ligne de titres"] };
  const titles = head.map((h) => normalize(String(h ?? "")));
  const find = (keys: string[]) => titles.findIndex((t) => keys.includes(t));
  const iPatient = find(COLS.patient);
  const iFirst = find(COLS.first);
  const iLast = find(COLS.last);
  const iDate = find(COLS.date);
  let iText = find(COLS.text);
  if (iText < 0) {
    // À défaut, la colonne dont les cellules sont les plus longues.
    const lengths = titles.map((_, i) => body.reduce((n, r) => n + String(r[i] ?? "").length, 0));
    iText = lengths.indexOf(Math.max(...lengths));
  }
  const missing: string[] = [];
  if (iPatient < 0 && iLast < 0 && iFirst < 0) missing.push("une colonne « Patient » (ou « Nom » et « Prénom »)");
  if (iDate < 0) missing.push("une colonne « Date »");
  const notes = body
    .map((r) => {
      const first = iFirst >= 0 ? String(r[iFirst] ?? "").trim() : undefined;
      const last = iLast >= 0 ? String(r[iLast] ?? "").trim() : undefined;
      const label = iPatient >= 0 ? String(r[iPatient] ?? "").trim() : [first, last].filter(Boolean).join(" ");
      return { patientLabel: label, first, last, date: iDate >= 0 ? cellToDate(r[iDate]) : null, text: String(r[iText] ?? "").trim() };
    })
    .filter((n) => n.text && n.patientLabel);
  return { notes, missing };
}

/** Date en début de ligne (avec « Séance du », « Le »… facultatifs) : la date et le reste de la ligne. */
export function leadingDate(line: string): { date: IsoDay; rest: string } | null {
  const t = line.replace(/^(séance|seance|note|observation|compte[- ]rendu)?\s*(du|le)?\s*:?\s*/i, "");
  const patterns = [
    /^\d{4}-\d{2}-\d{2}/,
    /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/,
    /^(?:[a-zéû]+\s+)?\d{1,2}(?:er)?\s+[a-zéû]+\s+\d{4}/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const date = parseFrenchDate(m[0]);
    if (date) return { date, rest: t.slice(m[0].length).replace(/^\s*[:\-–—,.]?\s*/, "") };
  }
  return null;
}

/**
 * Texte d'un seul patient → notes : chaque ligne qui commence par une date ouvre une nouvelle note.
 * Le texte placé avant la première date forme une note sans date.
 */
export function notesFromText(text: string): { date: IsoDay | null; text: string }[] {
  const out: { date: IsoDay | null; text: string }[] = [];
  let current: { date: IsoDay | null; lines: string[] } = { date: null, lines: [] };
  const flush = () => {
    const body = current.lines.join("\n").trim();
    if (body) out.push({ date: current.date, text: body });
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const found = raw.trim() ? leadingDate(raw.trim()) : null;
    if (found) {
      flush();
      current = { date: found.date, lines: found.rest ? [found.rest] : [] };
    } else current.lines.push(raw);
  }
  flush();
  return out;
}

/** Retrouve un patient par son nom, quel que soit l'ordre prénom / nom et les accents. */
export function matchPatient(n: Pick<ImportedNote, "patientLabel" | "first" | "last">, patients: Patient[]): Patient | null {
  const key = (s: string) => normalize(s).split(" ").filter(Boolean).sort().join(" ");
  const target = key(n.patientLabel);
  return (
    patients.find((p) => key(`${p.first_name} ${p.last_name}`) === target) ??
    (n.first && n.last ? null : patients.find((p) => key(p.first_name) === target || key(p.last_name) === target)) ??
    null
  );
}

/** Découpe « Prénom Nom » pour créer un patient manquant. */
export function splitName(n: Pick<ImportedNote, "patientLabel" | "first" | "last">): { first_name: string; last_name: string } {
  if (n.first || n.last) return { first_name: n.first ?? "", last_name: n.last ?? "" };
  const parts = n.patientLabel.split(/\s+/);
  return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") };
}
