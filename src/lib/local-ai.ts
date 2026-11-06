/**
 * Assistant de rédaction intégré à Chrome (modèle Gemini Nano, sur l'ordinateur).
 * Gratuit, sans compte ni clé, et le texte ne quitte pas l'appareil.
 * Disponible sur Chrome pour ordinateur récent ; pas sur téléphone.
 */
import { useSyncExternalStore } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type LM = any;
const lm = (): LM | null => (typeof window !== "undefined" ? ((window as any).LanguageModel ?? null) : null);

const LANG = {
  expectedInputs: [{ type: "text", languages: ["fr"] }],
  expectedOutputs: [{ type: "text", languages: ["fr"] }],
};

export type LocalAiState = "verification" | "pret" | "a-telecharger" | "telechargement" | "indisponible";

let state: LocalAiState = "verification";
let progress = 0;
const listeners = new Set<() => void>();
const set = (s: LocalAiState, p = progress) => {
  state = s;
  progress = p;
  listeners.forEach((l) => l());
};

export async function checkLocalAi(): Promise<LocalAiState> {
  const api = lm();
  if (!api) {
    set("indisponible");
    return state;
  }
  try {
    const a = await api.availability(LANG);
    set(a === "available" ? "pret" : a === "downloading" ? "telechargement" : a === "downloadable" ? "a-telecharger" : "indisponible");
  } catch {
    set("indisponible");
  }
  return state;
}

export const localAiReady = () => state === "pret";

export function useLocalAi() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => `${state}|${progress}`,
  ).split("|") as [LocalAiState, string];
}

/** Télécharge le modèle (une seule fois, plusieurs Go). Doit partir d'un clic. */
export async function downloadLocalAi() {
  const api = lm();
  if (!api) return;
  set("telechargement", 0);
  try {
    const session = await api.create({
      ...LANG,
      monitor(m: any) {
        m.addEventListener("downloadprogress", (e: any) => set("telechargement", Math.round((e.loaded ?? 0) * 100)));
      },
    });
    session.destroy?.();
    set("pret", 100);
  } catch {
    await checkLocalAi();
  }
}

export async function promptLocalAi(system: string, text: string): Promise<string> {
  const api = lm();
  if (!api || state !== "pret") throw new Error("L'assistant n'est pas encore activé sur cet ordinateur (Paramètres).");
  const session = await api.create({ ...LANG, initialPrompts: [{ role: "system", content: system }] });
  try {
    return String(await session.prompt(text)).trim();
  } finally {
    session.destroy?.();
  }
}

if (typeof window !== "undefined") void checkLocalAi();
