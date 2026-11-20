/**
 * Synchronisation dans les deux sens avec Google Tasks, depuis le navigateur (sans serveur).
 *
 * - Une liste dédiée « Carnet de suivi » dans Google Tasks ; aucune autre liste n'est touchée.
 * - Côté app : les tâches (« Tâches ») et les prévisions / « À préparer » des patients.
 * - Vers Google ne part que le TEXTE de la tâche, sa date et « fait / à faire ». Jamais le nom de
 *   famille ; le prénom seulement si la praticienne l'a choisi (réglage, désactivé par défaut).
 * - Règle : on compare les valeurs (texte, date, fait) ; s'il y a une différence, le côté modifié
 *   le plus récemment gagne. Rien n'est jamais supprimé physiquement dans l'app.
 */
import { useSyncExternalStore } from "react";
import { db, getMeta, setMeta } from "./db";
import { googleAccessToken, googleTokenHasTasks, onAgendaRefreshed } from "./google-agenda";
import { create, remove, update } from "./repo";
import { stableId } from "./stable-id";
import type { Forecast, Patient, Task } from "./types";

const API = "https://tasks.googleapis.com/tasks/v1";
export const LIST_TITLE = "Carnet de suivi";

export type GTask = { id: string; title?: string; notes?: string; status?: "needsAction" | "completed"; due?: string; updated?: string; deleted?: boolean };

export interface TasksSyncState {
  running: boolean;
  lastSync: string | null;
  error: string | null;
  firstName: boolean;
  summary: string | null;
}
let state: TasksSyncState = { running: false, lastSync: null, error: null, firstName: false, summary: null };
const listeners = new Set<() => void>();
function set(p: Partial<TasksSyncState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function useTasksSync(): TasksSyncState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

/* ------------------------------------------------------------------ correspondance (testée à part) */

export type Item =
  | { kind: "task"; row: Task; patient: Patient | null }
  | { kind: "forecast"; row: Forecast; patient: Patient | null };

/** Ce que Google doit montrer pour un élément de l'app. */
export function expected(it: Item, withFirstName: boolean): { title: string; due: string | null; done: boolean; remove: boolean } {
  const text = it.kind === "task" ? it.row.title : it.row.content;
  const prefix = withFirstName && it.patient ? `${it.patient.first_name} : ` : "";
  const day = it.kind === "task" ? it.row.due_date : it.row.planned_date;
  const done = it.kind === "task" ? it.row.status === "fait" : it.row.status === "faite" || it.row.status === "transferee";
  const gone = Boolean(it.row.deleted_at) || (it.kind === "forecast" && it.row.status === "abandonnee");
  return { title: `${prefix}${text}`.trim(), due: day ? `${day}T00:00:00.000Z` : null, done, remove: gone };
}

/** Texte de l'app à partir du titre Google (on retire le prénom ajouté par l'app). */
export function textFromGoogle(title: string, patient: Patient | null): string {
  const t = title.trim();
  if (patient) {
    const p = `${patient.first_name} : `;
    if (t.toLowerCase().startsWith(p.toLowerCase())) return t.slice(p.length).trim();
  }
  return t;
}

const sameDue = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").slice(0, 10) === (b ?? "").slice(0, 10);

export function differs(e: ReturnType<typeof expected>, g: GTask): boolean {
  return (g.title ?? "").trim() !== e.title || !sameDue(g.due, e.due) || (g.status === "completed") !== e.done;
}

/** État convenu lors de la dernière synchronisation, pour savoir QUEL côté a changé depuis
 * (sans dépendre de l'heure des appareils). */
export type Snap = { title: string; due: string; done: boolean };
export const snapOfApp = (e: ReturnType<typeof expected>): Snap => ({ title: e.title, due: (e.due ?? "").slice(0, 10), done: e.done });
export const snapOfGoogle = (g: GTask): Snap => ({ title: (g.title ?? "").trim(), due: (g.due ?? "").slice(0, 10), done: g.status === "completed" });
const sameSnap = (a: Snap, b: Snap | undefined) => Boolean(b) && a.title === b!.title && a.due === b!.due && a.done === b!.done;

/** Qui gagne quand les deux côtés diffèrent : celui qui a changé depuis la dernière fois ;
 * si les deux ont changé, le plus récent. */
export function winner(app: Snap, google: Snap, last: Snap | undefined, googleUpdated: string, appUpdated: string): "app" | "google" {
  const appChanged = !sameSnap(app, last);
  const googleChanged = !sameSnap(google, last);
  if (appChanged && !googleChanged) return "app";
  if (googleChanged && !appChanged) return "google";
  return googleUpdated > appUpdated ? "google" : "app";
}

/* ------------------------------------------------------------------ appels à Google Tasks */

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = googleAccessToken();
  if (!token) throw new Error("La connexion à Google a expiré : clique sur « Reconnecter ».");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 403) throw new Error("Google refuse l'accès aux tâches : active « Google Tasks API » et l'accès « tasks » dans ton projet Google, puis reconnecte-toi.");
  if (res.status === 401) throw new Error("La connexion à Google a expiré : clique sur « Reconnecter ».");
  if (!res.ok && res.status !== 204 && res.status !== 404) throw new Error("Google Tasks n'a pas répondu.");
  return (res.status === 204 || res.status === 404 ? null : await res.json()) as T;
}

async function listId(): Promise<string> {
  const saved = await getMeta<string>("gtasks_list_id");
  const lists = (await call<{ items?: { id: string; title: string }[] }>("/users/@me/lists?maxResults=100")).items ?? [];
  const found = lists.find((l) => l.id === saved) ?? lists.find((l) => l.title === LIST_TITLE);
  if (found) {
    if (found.id !== saved) await setMeta("gtasks_list_id", found.id);
    return found.id;
  }
  const created = await call<{ id: string }>("/users/@me/lists", { method: "POST", body: JSON.stringify({ title: LIST_TITLE }) });
  await setMeta("gtasks_list_id", created.id);
  return created.id;
}

async function allGoogleTasks(list: string): Promise<GTask[]> {
  const out: GTask[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ showCompleted: "true", showHidden: "true", showDeleted: "true", maxResults: "100" });
    if (page) q.set("pageToken", page);
    const r = await call<{ items?: GTask[]; nextPageToken?: string }>(`/lists/${list}/tasks?${q}`);
    out.push(...(r.items ?? []));
    page = r.nextPageToken;
  } while (page);
  return out;
}

/* ------------------------------------------------------------------ synchronisation */

let applying = false;
let queued = false;

export async function syncTasks(): Promise<void> {
  if (!googleTokenHasTasks() || !(await getMeta<boolean>("gtasks_enabled"))) return;
  if (state.running) {
    queued = true;
    return;
  }
  set({ running: true, error: null });
  const withFirstName = Boolean(await getMeta<boolean>("gtasks_first_name"));
  let pushed = 0,
    pulled = 0;
  try {
    const list = await listId();
    const google = await allGoogleTasks(list);
    const byGid = new Map(google.map((g) => [g.id, g]));
    const patients = new Map(((await db.patients.toArray()) as Patient[]).map((p) => [p.id, p]));
    const items: Item[] = [
      ...((await db.tasks.toArray()) as Task[]).map((row) => ({ kind: "task" as const, row, patient: row.patient_id ? (patients.get(row.patient_id) ?? null) : null })),
      ...((await db.forecasts.toArray()) as Forecast[]).map((row) => ({ kind: "forecast" as const, row, patient: patients.get(row.patient_id) ?? null })),
    ];
    // Tâches Google déjà reliées (y compris par l'autre appareil, via la liaison directe).
    const linked = new Set<string>(items.map((i) => i.row.google_task_id).filter((x): x is string => Boolean(x)));
    const snaps = (await getMeta<Record<string, Snap>>("gtasks_snap")) ?? {};
    const nextSnaps: Record<string, Snap> = {};
    applying = true;

    for (const it of items) {
      const e = expected(it, withFirstName);
      const gid = it.row.google_task_id;
      const g = gid ? byGid.get(gid) : undefined;
      const table = it.kind === "task" ? "tasks" : "forecasts";

      if (!gid) {
        // Nouveau côté app : on crée la tâche Google (sauf si déjà faite ou retirée).
        if (e.remove || e.done) continue;
        // Déjà envoyée par l'autre appareil (téléphone ou ordinateur) : on la relie au lieu d'en créer une seconde.
        const twin = google.find((x) => !x.deleted && !linked.has(x.id) && (x.title ?? "").trim() === e.title);
        if (twin) {
          linked.add(twin.id);
          await update(table, it.row.id, { google_task_id: twin.id });
          nextSnaps[twin.id] = snapOfGoogle(twin);
          continue;
        }
        const made = await call<GTask>(`/lists/${list}/tasks`, { method: "POST", body: JSON.stringify({ title: e.title, due: e.due ?? undefined, status: "needsAction" }) });
        await update(table, it.row.id, { google_task_id: made.id });
        linked.add(made.id);
        nextSnaps[made.id] = snapOfApp(e);
        pushed++;
        continue;
      }
      if (!g || g.deleted) {
        // Supprimée dans Google : retirée dans l'app (jamais effacée).
        if (!e.remove) {
          if (it.kind === "task") await remove("tasks", it.row.id);
          else await update("forecasts", it.row.id, { status: "abandonnee" });
          pulled++;
        }
        continue;
      }
      if (e.remove) {
        await call(`/lists/${list}/tasks/${g.id}`, { method: "DELETE" });
        pushed++;
        continue;
      }
      if (!differs(e, g)) {
        nextSnaps[g.id] = snapOfApp(e);
        continue;
      }
      const googleNewer = winner(snapOfApp(e), snapOfGoogle(g), snaps[g.id], g.updated ?? "", it.row.updated_at) === "google";
      if (googleNewer) {
        const text = textFromGoogle(g.title ?? "", it.patient);
        const day = g.due ? g.due.slice(0, 10) : null;
        const done = g.status === "completed";
        if (it.kind === "task") await update("tasks", it.row.id, { title: text || it.row.title, due_date: day, status: done ? "fait" : "a_faire" });
        else
          await update("forecasts", it.row.id, {
            content: text || it.row.content,
            planned_date: day ?? it.row.planned_date,
            status: done ? (it.row.status === "transferee" ? "transferee" : "faite") : "a_faire",
          });
        // Ce que l'app montre maintenant (le prénom éventuel est remis à la prochaine fois si besoin).
        nextSnaps[g.id] = snapOfGoogle(g);
        pulled++;
      } else {
        await call(`/lists/${list}/tasks/${g.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: e.title, due: e.due, status: e.done ? "completed" : "needsAction", ...(e.done ? {} : { completed: null }) }),
        });
        nextSnaps[g.id] = snapOfApp(e);
        pushed++;
      }
    }

    // Nouvelles tâches créées dans Google : elles arrivent dans « Tâches » (sans patient).
    for (const g of google) {
      if (linked.has(g.id) || g.deleted || g.status === "completed" || !(g.title ?? "").trim()) continue;
      const id = stableId(`gtask|${g.id}`);
      const existing = await db.tasks.get(id);
      if (existing) {
        if (!existing.google_task_id) await update("tasks", id, { google_task_id: g.id });
        continue;
      }
      await create("tasks", { id, patient_id: null, title: g.title!.trim(), due_date: g.due ? g.due.slice(0, 10) : null, status: "a_faire", urgent: false, details: g.notes ?? null, google_task_id: g.id } as never);
      nextSnaps[g.id] = snapOfGoogle(g);
      pulled++;
    }
    const at = new Date().toISOString();
    await setMeta("gtasks_snap", nextSnaps);
    await setMeta("gtasks_last_sync", at);
    set({ lastSync: at, summary: pushed || pulled ? `${pushed} envoyée(s) vers Google, ${pulled} reçue(s)` : "Tout est à jour" });
  } catch (e) {
    set({ error: e instanceof TypeError ? "Pas de connexion internet : les tâches se synchroniseront plus tard." : (e as Error).message });
  } finally {
    applying = false;
    set({ running: false });
    if (queued) {
      queued = false;
      void syncTasks();
    }
  }
}

/* ------------------------------------------------------------------ déclenchement */

let timer: ReturnType<typeof setTimeout> | null = null;
function soon() {
  if (applying || !googleTokenHasTasks()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncTasks(), 2500);
}

let started = false;
export async function initTasksSync() {
  if (started) return;
  started = true;
  set({ firstName: Boolean(await getMeta<boolean>("gtasks_first_name")), lastSync: (await getMeta<string>("gtasks_last_sync")) ?? null });
  onAgendaRefreshed(() => void syncTasks());
  // Une tâche cochée, ajoutée ou redatée dans l'app part vers Google quelques secondes après.
  for (const t of [db.tasks, db.forecasts]) {
    t.hook("creating", function () {
      this.onsuccess = soon;
    });
    t.hook("updating", function () {
      this.onsuccess = soon;
    });
  }
}

export async function setFirstName(on: boolean) {
  await setMeta("gtasks_first_name", on);
  set({ firstName: on });
  void syncTasks();
}
