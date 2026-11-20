/**
 * Lecture des titres de rendez-vous Google Agenda et correspondance avec les patients.
 * « Milo P. » → un patient ; « Groupe : Prénom N., Prénom N. » → plusieurs patients.
 */
import type { DayEntry } from "./schedule";
import type { AgendaEvent, Patient } from "./types";

/** Comparaison sans accents, majuscules, points ni espaces en trop. */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTitle(title: string): { group: boolean; names: string[] } {
  const m = title.match(/^\s*groupe\s*[:\-–—]?\s*(.*)$/i);
  if (m) return { group: true, names: m[1]!.split(/[,;]/).map((x) => x.trim()).filter(Boolean) };
  const t = title.trim();
  return { group: false, names: t ? [t] : [] };
}

export type NameMatch = { name: string; patient: Patient | null; ignored: boolean };

/**
 * 1. Un « Nom dans l'agenda » enregistré sur une fiche.
 * 2. Sinon, prénom + initiale du nom (« Milo P. ») ou prénom seul, s'il ne désigne qu'un patient.
 */
export function matchName(name: string, patients: Patient[], ignored: Set<string> = new Set()): NameMatch {
  const n = normName(name);
  const alive = patients.filter((p) => !p.deleted_at);
  const saved = alive.find((p) => (p.calendar_names ?? []).some((c) => normName(c) === n));
  if (saved) return { name, patient: saved, ignored: false };
  if (ignored.has(n)) return { name, patient: null, ignored: true };
  const parts = n.split(" ");
  // « pape-demba s » → prénom « pape-demba », initiale « s » ; « alyosha » → prénom seul.
  const initial = parts.length > 1 && parts.at(-1)!.length <= 2 ? parts.at(-1)! : null;
  const first = (initial ? parts.slice(0, -1) : parts).join(" ");
  let candidates = alive.filter((p) => {
    const f = normName(p.first_name);
    const l = normName(p.last_name);
    if (f !== first && `${f} ${l}` !== n) return false;
    return !initial || l.startsWith(initial);
  });
  if (candidates.length > 1) {
    const actifs = candidates.filter((p) => p.status === "actif");
    if (actifs.length === 1) candidates = actifs;
  }
  return { name, patient: candidates.length === 1 ? candidates[0]! : null, ignored: false };
}

export type AgendaSlot = {
  day: string;
  time: string;
  events: AgendaEvent[];
  group: boolean;
  matches: NameMatch[];
};

/** Rendez-vous d'un jour, regroupés par heure : plusieurs patients à la même heure = un groupe. */
export function slotsOfDay(events: AgendaEvent[], patients: Patient[], ignored: Set<string>): AgendaSlot[] {
  const byTime = new Map<string, AgendaEvent[]>();
  for (const e of [...events].sort((a, b) => a.time.localeCompare(b.time))) byTime.set(e.time, [...(byTime.get(e.time) ?? []), e]);
  return [...byTime.entries()].map(([time, evs]) => {
    const parsed = evs.map((e) => parseTitle(e.title));
    const matches = parsed.flatMap((p) => p.names.map((nm) => matchName(nm, patients, ignored)));
    const patientsHere = new Set(matches.filter((m) => m.patient).map((m) => m.patient!.id));
    return { day: evs[0]!.day, time, events: evs, group: parsed.some((p) => p.group) || patientsHere.size > 1, matches };
  });
}

/** Ma journée d'après l'agenda : un patient par ligne, à l'heure de son rendez-vous. */
export function agendaEntries(events: AgendaEvent[], patients: Patient[], ignored: Set<string>): { entries: DayEntry[]; unmatched: string[] } {
  const entries: DayEntry[] = [];
  const unmatched: string[] = [];
  for (const e of [...events].sort((a, b) => a.time.localeCompare(b.time))) {
    for (const n of parseTitle(e.title).names) {
      const m = matchName(n, patients, ignored);
      if (m.patient) {
        if (!entries.some((x) => x.patient.id === m.patient!.id)) entries.push({ patient: m.patient, time: e.time, added: false });
      } else if (!m.ignored) unmatched.push(n);
    }
  }
  return { entries, unmatched: [...new Set(unmatched)] };
}
