/**
 * Google Agenda en LECTURE SEULE, directement depuis le navigateur (sans serveur).
 *
 * - Connexion : Google Identity Services, autorisation « calendar.events.readonly » uniquement.
 * - Seule requête faite à Google : la LISTE des événements (GET). Rien n'est jamais écrit dans
 *   l'agenda et aucune information clinique n'y est envoyée.
 * - On ne demande à Google que l'heure et le titre des événements (pas les descriptions, lieux…).
 * - Copie locale (table agenda_events) pour consulter le planning hors ligne ; effacée à la déconnexion.
 */
import { useSyncExternalStore } from "react";
import { addDays } from "./dates";
import { db, getMeta, setMeta } from "./db";
import { matchName, normName, parseTitle } from "./agenda-match";
import { weekdayOf } from "./dates";
import { update } from "./repo";
import type { AgendaEvent, IsoDay, Patient } from "./types";

export const AGENDA_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
/** Demandé seulement si la synchronisation des tâches est activée. */
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const TZ = "Europe/Paris";
/** Lecture : la semaine qui vient (l'accueil en montre 3 jours, Ma journée peut en demander d'autres). */
export const AGENDA_DAYS = 8;

type Token = { access_token: string; expires_at: number; scope?: string };

export interface AgendaState {
  clientId: string | null;
  /** Une connexion a été autorisée sur cet appareil (même si l'accès a expiré depuis). */
  linked: boolean;
  email: string | null;
  /** Accès valable maintenant (une heure après chaque connexion). */
  active: boolean;
  loading: boolean;
  lastFetch: string | null;
  error: string | null;
  /** Jours déjà lus dans l'agenda (copie locale disponible). */
  days: string[];
  /** Fiches dont le jour / l'heure habituels viennent d'être mis à jour d'après l'agenda. */
  updatedFiches: string[];
  /** Synchronisation Google Tasks voulue (réglage) et accès accordé par Google. */
  tasksWanted: boolean;
  tasksGranted: boolean;
}

let state: AgendaState = { clientId: null, linked: false, email: null, active: false, loading: false, lastFetch: null, error: null, days: [], updatedFiches: [], tasksWanted: false, tasksGranted: false };
const listeners = new Set<() => void>();
function set(p: Partial<AgendaState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function useAgendaState(): AgendaState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

let token: Token | null = null;
const tokenValid = () => Boolean(token && token.expires_at > Date.now() + 30_000);

/* ------------------------------------------------------------------ dates à Paris */

/** Jour actuel à Paris, quel que soit le fuseau de l'appareil. */
export function parisToday(now = new Date()): IsoDay {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now) as IsoDay;
}

/** Décalage horaire de Paris ce jour-là (« +01:00 » en hiver, « +02:00 » en été). */
export function parisOffset(day: IsoDay): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(noon).find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

/** Jour et heure à Paris d'un horaire Google (« 2026-11-24T10:40:00+01:00 »). */
export function parisDayTime(iso: string): { day: IsoDay; time: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${g("year")}-${g("month")}-${g("day")}` as IsoDay, time: `${g("hour")}:${g("minute")}` };
}

/* ------------------------------------------------------------------ Google Identity Services */

type GisTokenClient = { requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (r: { access_token?: string; expires_in?: number; error?: string; scope?: string }) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }) => GisTokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
};
declare global {
  interface Window {
    google?: Gis;
  }
}

let gisLoading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  gisLoading ??= new Promise<Gis>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google) : reject(new Error("Google n'a pas pu être chargé.")));
    s.onerror = () => {
      gisLoading = null;
      reject(new Error("Google n'est pas joignable : vérifie la connexion internet."));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Ouvre la fenêtre Google (doit être appelé depuis un clic). */
export async function connectGoogle(firstTime = false): Promise<void> {
  const clientId = state.clientId;
  if (!clientId) throw new Error("Colle d'abord l'identifiant OAuth (ID client).");
  set({ error: null, loading: true });
  try {
    const gis = await loadGis();
    await new Promise<void>((resolve, reject) => {
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: state.tasksWanted ? `${AGENDA_SCOPE} ${TASKS_SCOPE}` : AGENDA_SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) return reject(new Error(r.error === "access_denied" ? "Connexion refusée." : "La connexion à Google a échoué."));
          if (r.scope && !r.scope.includes("calendar.events.readonly")) return reject(new Error("L'accès à l'agenda n'a pas été autorisé : coche la case Google Agenda."));
          token = { access_token: r.access_token, expires_at: Date.now() + (r.expires_in ?? 3600) * 1000, scope: r.scope };
          resolve();
        },
        error_callback: (e) =>
          reject(new Error(e.type === "popup_closed" ? "Fenêtre Google fermée avant la fin." : e.type === "popup_failed_to_open" ? "Le navigateur a bloqué la fenêtre Google : autorise les fenêtres pour ce site." : "La connexion à Google a échoué.")),
      });
      client.requestAccessToken({ prompt: firstTime || !state.email ? "consent" : "", login_hint: state.email ?? undefined });
    });
    await setMeta("agenda_linked", true);
    await setMeta("agenda_token", token);
    set({ linked: true, active: true, tasksGranted: Boolean(token?.scope?.includes("/auth/tasks")) });
    await refreshAgenda();
  } catch (e) {
    set({ error: (e as Error).message });
    throw e;
  } finally {
    set({ loading: false });
  }
}

export async function disconnectGoogle() {
  const t = token?.access_token;
  token = null;
  if (t) {
    try {
      (await loadGis()).accounts.oauth2.revoke(t);
    } catch {
      /* hors ligne : l'accès expirera de lui-même dans l'heure */
    }
  }
  await Promise.all([db.agenda_events.clear(), db.meta.bulkDelete(["agenda_linked", "agenda_token", "agenda_email", "agenda_last_fetch", "agenda_days"])]);
  set({ linked: false, active: false, email: null, lastFetch: null, error: null, days: [], updatedFiches: [], tasksGranted: false });
}

export async function saveClientId(id: string) {
  const v = id.trim() || null;
  await setMeta("google_client_id", v);
  set({ clientId: v });
}

/* ------------------------------------------------------------------ lecture des rendez-vous */

type GEvent = { id: string; status?: string; summary?: string; recurringEventId?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };

/** Événements Google → rendez-vous de l'app (annulés et journées entières ignorés). */
export function toAgendaEvents(items: GEvent[]): AgendaEvent[] {
  return items
    .filter((e) => e.status !== "cancelled" && e.start?.dateTime)
    .map((e) => {
      const { day, time } = parisDayTime(e.start!.dateTime!);
      return {
        id: e.id,
        day,
        time,
        end: e.end?.dateTime ? parisDayTime(e.end.dateTime).time : null,
        title: (e.summary ?? "").trim() || "(sans titre)",
        recurring: Boolean(e.recurringEventId),
      };
    });
}

/** Lit la semaine qui vient (à partir d'aujourd'hui). */
export function refreshAgenda(): Promise<number> {
  const first = parisToday();
  return fetchRange(first, addDays(first, AGENDA_DAYS));
}

/** Lit un jour précis (Ma journée sur une autre date), avec la semaine qui suit. */
export function fetchAround(day: IsoDay): Promise<number> {
  return fetchRange(day, addDays(day, 7));
}

/**
 * Lit les rendez-vous de [first, end[ (heure de Paris). Garde l'ancienne copie si Google n'est pas
 * joignable. Seule requête : GET sur la liste des événements.
 */
async function fetchRange(first: IsoDay, end: IsoDay): Promise<number> {
  if (!tokenValid()) {
    set({ active: false });
    throw new Error("La connexion à Google a expiré : clique sur « Reconnecter ».");
  }
  set({ loading: true, error: null });
  try {
    const q = new URLSearchParams({
      timeMin: `${first}T00:00:00${parisOffset(first)}`,
      timeMax: `${end}T00:00:00${parisOffset(end)}`,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      timeZone: TZ,
      // Le strict nécessaire : titre, horaires, et si le rendez-vous est répété.
      fields: "summary,items(id,status,summary,start,end,recurringEventId)",
    });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token!.access_token}` },
    });
    if (res.status === 401) {
      token = null;
      set({ active: false });
      throw new Error("La connexion à Google a expiré : clique sur « Reconnecter ».");
    }
    if (!res.ok) throw new Error(res.status === 403 ? "Google refuse l'accès : vérifie que l'API Google Calendar est activée dans ton projet." : "Google Agenda n'a pas répondu.");
    const body = (await res.json()) as { summary?: string; items?: GEvent[] };
    const events = toAgendaEvents(body.items ?? []);
    const days: string[] = [];
    for (let d = first; d < end; d = addDays(d, 1)) days.push(d);
    const inRange = new Set(days);
    const oldest = addDays(parisToday(), -60);
    await db.transaction("rw", db.agenda_events, async () => {
      // On remplace la copie des jours lus, et on oublie ce qui a plus de deux mois.
      const old = await db.agenda_events.toArray();
      await db.agenda_events.bulkDelete(old.filter((e) => inRange.has(e.day) || e.day < oldest).map((e) => e.id));
      await db.agenda_events.bulkPut(events);
    });
    const known = [...new Set([...state.days, ...days])].filter((d) => d >= oldest).sort();
    const at = new Date().toISOString();
    await Promise.all([setMeta("agenda_last_fetch", at), setMeta("agenda_days", known)]);
    if (body.summary?.includes("@")) await setMeta("agenda_email", body.summary);
    set({ lastFetch: at, email: body.summary?.includes("@") ? body.summary : state.email, active: true, days: known });
    const updated = await syncUsualTimes(events);
    if (updated.length) set({ updatedFiches: updated });
    afterRefresh?.();
    return events.length;
  } catch (e) {
    set({ error: e instanceof TypeError ? "Pas de connexion internet : le dernier planning connu reste affiché." : (e as Error).message });
    throw e;
  } finally {
    set({ loading: false });
  }
}

/**
 * Horaires des fiches alignés sur l'agenda : pour un patient qui a un rendez-vous RÉPÉTÉ
 * (toujours le même jour et la même heure dans la période lue), on met à jour le jour et
 * l'heure habituels de sa fiche. Rien n'est écrit dans Google ; seules les fiches changent.
 * Un patient vu à deux créneaux différents (deux séances par semaine…) n'est pas modifié.
 */
export async function syncUsualTimes(events: AgendaEvent[]): Promise<string[]> {
  const patients = (await db.patients.toArray()).filter((p) => !p.deleted_at) as Patient[];
  const ignored = new Set((await getIgnored()).map(normName));
  const slots = new Map<string, Set<string>>();
  for (const e of events.filter((x) => x.recurring)) {
    for (const n of parseTitle(e.title).names) {
      const p = matchName(n, patients, ignored).patient;
      if (!p) continue;
      slots.set(p.id, (slots.get(p.id) ?? new Set()).add(`${weekdayOf(e.day)}|${e.time}`));
    }
  }
  const changed: string[] = [];
  for (const [id, set_] of slots) {
    if (set_.size !== 1) continue;
    const [wd, time] = [...set_][0]!.split("|") as [Patient["usual_day"], string];
    const p = patients.find((x) => x.id === id)!;
    if (p.usual_day === wd && (p.usual_time ?? "").slice(0, 5) === time) continue;
    await update("patients", id, { usual_day: wd, usual_time: time });
    changed.push(`${p.first_name} ${p.last_name}`.trim());
  }
  return changed;
}

/** Au démarrage : relit l'état et, si l'accès est encore valable, actualise. */
export async function initAgenda() {
  const [clientId, linked, saved, email, lastFetch, days] = await Promise.all([
    getMeta<string | null>("google_client_id"),
    getMeta<boolean>("agenda_linked"),
    getMeta<Token | null>("agenda_token"),
    getMeta<string>("agenda_email"),
    getMeta<string>("agenda_last_fetch"),
    getMeta<string[]>("agenda_days"),
  ]);
  token = saved && saved.expires_at > Date.now() ? saved : null;
  const tasksWanted = Boolean(await getMeta<boolean>("gtasks_enabled"));
  set({
    clientId: clientId ?? null,
    linked: Boolean(linked),
    email: email ?? null,
    lastFetch: lastFetch ?? null,
    active: tokenValid(),
    days: days ?? [],
    tasksWanted,
    tasksGranted: Boolean(token?.scope?.includes("/auth/tasks")),
  });
  if (linked && tokenValid()) void refreshAgenda().catch(() => undefined);
}

/** Actualise si possible, sinon ouvre la reconnexion (depuis un clic). */
export async function refreshOrReconnect(day?: IsoDay) {
  const other = Boolean(day && day !== parisToday());
  if (!tokenValid()) {
    await connectGoogle(false); // relit déjà la semaine qui vient
    if (other) await fetchAround(day!);
    return;
  }
  await (other ? fetchAround(day!) : refreshAgenda());
}

export function clearUpdatedFiches() {
  set({ updatedFiches: [] });
}

/** L'accès Google est-il valable maintenant (pour lire une autre date sans clic) ? */
export const agendaTokenValid = () => tokenValid();

/** Jeton d'accès valable (pour Google Tasks), ou null. */
export const googleAccessToken = () => (tokenValid() ? token!.access_token : null);
export const googleTokenHasTasks = () => tokenValid() && Boolean(token?.scope?.includes("/auth/tasks"));

/** Active / coupe la synchronisation des tâches (la reconnexion Google ajoute l'accès Tâches). */
export async function setTasksWanted(on: boolean) {
  await setMeta("gtasks_enabled", on);
  set({ tasksWanted: on });
}

/** Après chaque lecture de l'agenda, les tâches se synchronisent aussi (voir google-tasks.ts). */
let afterRefresh: (() => void) | null = null;
export function onAgendaRefreshed(f: () => void) {
  afterRefresh = f;
}

/** Noms de l'agenda à ne plus proposer (ex. « Pilates »). */
export async function getIgnored(): Promise<string[]> {
  return (await getMeta<string[]>("agenda_ignored")) ?? [];
}
export async function ignoreName(n: string) {
  const list = new Set(await getIgnored());
  list.add(n);
  await setMeta("agenda_ignored", [...list]);
}
