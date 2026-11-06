import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { db, getMeta, setMeta } from "./db";
import { setOwner } from "./repo";
import { supabase } from "./supabase";
import { startSync } from "./sync-controller";
import { detectMode } from "./team";

type AuthState = {
  ready: boolean;
  session: Session | null;
  /** Vrai sans serveur configuré : tout reste sur l'appareil. */
  localOnly: boolean;
  /** Compte professionnel ou compte famille (espace parents). */
  mode: "pro" | "famille";
  signOut: (wipe: boolean) => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth hors AuthProvider");
  return v;
}

/** Efface toutes les données de l'appareil (ordinateur partagé, changement de compte). */
export async function wipeLocalData() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

async function adoptUser(userId: string) {
  const previous = await getMeta<string>("user_id");
  if (previous && previous !== userId) {
    // Un autre compte s'était servi de cet appareil : on repart d'une base vide.
    await wipeLocalData();
  }
  await setMeta("user_id", userId);
  setOwner(userId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<"pro" | "famille">("pro");

  useEffect(() => {
    if (!supabase) {
      setOwner(null);
      startSync(false);
      setReady(true);
      return;
    }
    // La session est conservée sur l'appareil : l'app s'ouvre aussi hors connexion.
    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        await adoptUser(data.session.user.id);
        setMode(await detectMode(data.session.user.id));
      }
      setSession(data.session);
      startSync(Boolean(data.session));
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      void (async () => {
        if (s) {
          await adoptUser(s.user.id);
          setMode(await detectMode(s.user.id));
        }
        setSession(s);
        startSync(Boolean(s));
      })();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async (wipe: boolean) => {
    if (wipe) await wipeLocalData();
    await supabase?.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ ready, session, localOnly: !supabase, mode, signOut }}>{children}</Ctx.Provider>
  );
}
