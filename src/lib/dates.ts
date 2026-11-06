import type { IsoDay, Weekday } from "./types";

/** Jour local (et non UTC) au format AAAA-MM-JJ : évite le décalage d'un jour le soir. */
export function localDay(d: Date = new Date()): IsoDay {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(day: IsoDay, n: number): IsoDay {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d + n));
}

export function parseDay(day: IsoDay): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export const WEEKDAYS: Weekday[] = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

export function weekdayOf(day: IsoDay = localDay()): Weekday {
  const idx = parseDay(day).getDay(); // 0 = dimanche
  return WEEKDAYS[(idx + 6) % 7]!;
}

const short = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const long = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export const fmtDay = (day?: IsoDay | null) => (day ? short.format(parseDay(day)) : "Sans date");
export const fmtLongDay = (day: IsoDay) => long.format(parseDay(day));
export const fmtDateTime = (iso?: string | null) =>
  iso ? `${short.format(new Date(iso))} à ${time.format(new Date(iso))}` : "—";

/** « Aujourd'hui », « Demain », « En retard de 3 j »… */
export function relativeDay(day: IsoDay, today: IsoDay = localDay()): string {
  const diff = Math.round((parseDay(day).getTime() - parseDay(today).getTime()) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff === 2) return "Après-demain";
  if (diff === -1) return "Hier";
  if (diff < 0) return `En retard de ${-diff} j`;
  return `Dans ${diff} jours`;
}

export function ageFrom(birth?: IsoDay | null, today: IsoDay = localDay()): number | null {
  if (!birth) return null;
  const b = parseDay(birth);
  const t = parseDay(today);
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
}

/**
 * Répartit des éléments datés sur le tableau de bord :
 * en retard (toujours visibles), aujourd'hui, demain, après-demain.
 * Les éléments sans date ou plus lointains ne sont pas retenus.
 */
export function bucketByHorizon<T>(
  items: T[],
  getDay: (t: T) => IsoDay | null,
  today: IsoDay = localDay(),
): { overdue: T[]; days: { day: IsoDay; items: T[] }[] } {
  const days = [0, 1, 2].map((n) => ({ day: addDays(today, n), items: [] as T[] }));
  const overdue: T[] = [];
  for (const it of items) {
    const d = getDay(it);
    if (!d) continue;
    if (d < today) overdue.push(it);
    else days.find((x) => x.day === d)?.items.push(it);
  }
  overdue.sort((a, b) => (getDay(a) ?? "").localeCompare(getDay(b) ?? ""));
  return { overdue, days };
}
