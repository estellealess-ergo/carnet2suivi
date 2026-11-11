import { parseDay, weekdayOf } from "./dates";
import type { DayChange, IsoDay, Patient } from "./types";

/** Numéro de semaine ISO (lundi = début de semaine). */
export function isoWeek(day: IsoDay): number {
  const d = parseDay(day);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export const weekParity = (day: IsoDay): "paire" | "impaire" => (isoWeek(day) % 2 === 0 ? "paire" : "impaire");

export type DayEntry = { patient: Patient; time: string | null; added: boolean };

/**
 * Les patients d'une date : ceux suivis ce jour de la semaine (en tenant compte du rythme
 * une semaine sur deux), moins les séances annulées ce jour-là, plus les séances ajoutées.
 */
export function patientsForDay(patients: Patient[], changes: DayChange[], day: IsoDay): {
  entries: DayEntry[];
  cancelled: Patient[];
} {
  const weekday = weekdayOf(day);
  const parity = weekParity(day);
  const ofDay = changes.filter((c) => c.day === day && !c.deleted_at);
  const cancelledIds = new Set(ofDay.filter((c) => c.kind === "annulation").map((c) => c.patient_id));
  const added = ofDay.filter((c) => c.kind === "ajout");
  const active = (p: Patient) => p.status === "actif" || p.status === "bilan";

  const regular = patients.filter(
    (p) =>
      active(p) &&
      p.usual_day === weekday &&
      !(p.frequency === "bimensuel" && p.week_parity && p.week_parity !== parity),
  );
  const entries: DayEntry[] = regular
    .filter((p) => !cancelledIds.has(p.id))
    .map((p) => ({ patient: p, time: p.usual_time, added: false }));
  for (const c of added) {
    const p = patients.find((x) => x.id === c.patient_id);
    if (p && !entries.some((e) => e.patient.id === p.id)) entries.push({ patient: p, time: c.time ?? p.usual_time, added: true });
  }
  entries.sort((a, b) => a.patient.day_order - b.patient.day_order || (a.time ?? "99").localeCompare(b.time ?? "99"));
  return { entries, cancelled: regular.filter((p) => cancelledIds.has(p.id)) };
}

export type DayGroup = { time: string; entries: DayEntry[] };

/** Patients prévus le même jour à la même heure : c'est une séance de groupe. */
export function groupsOf(entries: DayEntry[]): DayGroup[] {
  const byTime = new Map<string, DayEntry[]>();
  for (const e of entries) {
    const t = e.time?.slice(0, 5);
    if (!t) continue;
    byTime.set(t, [...(byTime.get(t) ?? []), e]);
  }
  return [...byTime.entries()]
    .filter(([, list]) => list.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, list]) => ({ time, entries: list }));
}

/** Adresse des notes côte à côte d'un groupe (six au maximum), datées du jour de la séance. */
export function groupNotesUrl(g: DayGroup, day: string, max = 6) {
  return `/notes?p=${g.entries.slice(0, max).map((e) => e.patient.id).join(",")}&date=${day}`;
}
