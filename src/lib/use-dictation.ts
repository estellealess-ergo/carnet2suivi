import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Recognition = any;

function getRecognitionCtor(): (new () => Recognition) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const dictationSupported = () => typeof window !== "undefined" && !!getRecognitionCtor();

/**
 * Dictée vocale du navigateur, en continu. Chaque phrase reconnue est transmise
 * à onText ; la dictée redémarre seule si le navigateur l'interrompt.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const cb = useRef(onText);
  cb.current = onText;

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "fr-FR";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) cb.current(String(e.results[i][0].transcript).trim());
      }
    };
    r.onend = () => {
      if (wanted.current) r.start();
      else setListening(false);
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") stop();
    };
    rec.current = r;
    wanted.current = true;
    r.start();
    setListening(true);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);
  return { listening, start, stop, supported: dictationSupported() };
}
