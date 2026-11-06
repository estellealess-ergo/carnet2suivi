import { useSyncExternalStore } from "react";
import { getMeta } from "./db";
import { purgeInaccessible } from "./purge";
import { changes } from "./repo";
import { supabase, supabaseRemote } from "./supabase";
import { pendingCount, syncOnce, type SyncState } from "./sync";

/**
 * Pilote la synchronisation : au démarrage, après chaque saisie (avec un court délai),
 * au retour du réseau et toutes les minutes. Sans serveur configuré : mode local.
 */
let state: SyncState = {
  status: supabase ? "idle" : "local",
  pending: 0,
  lastSyncAt: null,
  error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

let running = false;
let again = false;
let signedIn = false;

export async function syncNow() {
  set({ pending: await pendingCount() });
  if (!supabase || !signedIn) return;
  if (!navigator.onLine) {
    set({ status: "offline" });
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  set({ status: "syncing", error: null });
  try {
    await syncOnce(supabaseRemote(supabase));
    await purgeInaccessible();
    set({
      status: "idle",
      lastSyncAt: new Date().toISOString(),
      pending: await pendingCount(),
    });
  } catch (e) {
    set({
      status: navigator.onLine ? "error" : "offline",
      error: (e as Error).message,
      pending: await pendingCount(),
    });
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncNow();
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

export function startSync(isSignedIn: boolean) {
  signedIn = isSignedIn;
  if (!started) {
    started = true;
    changes.addEventListener("change", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), 1500);
    });
    window.addEventListener("online", () => void syncNow());
    window.addEventListener("offline", () => set({ status: "offline" }));
    setInterval(() => void syncNow(), 60_000);
    void getMeta<string>("lastSyncAt").then((v) => set({ lastSyncAt: v ?? null }));
  }
  void syncNow();
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
