import { useEffect, useState } from "react";
import { callFunction } from "./comms";
import { getMeta, setMeta } from "./db";
import { supabase } from "./supabase";

export type Member = {
  user_id: string;
  role: "titulaire" | "membre";
  display_name: string;
  email: string;
};
export type Team = { practice: { id: string; name: string } | null; members: Member[] };

/** Cabinet et collègues (en ligne ; dernière version gardée pour le hors-ligne). */
export async function loadTeam(): Promise<Team> {
  const cached = (await getMeta<Team>("team")) ?? { practice: null, members: [] };
  if (!supabase || !navigator.onLine) return cached;
  const { data: practices, error } = await supabase.from("practices").select("id,name").limit(1);
  if (error) return cached;
  const practice = practices?.[0] ?? null;
  let members: Member[] = [];
  if (practice) {
    const { data } = await supabase
      .from("practice_members")
      .select("user_id,role,display_name,email")
      .eq("practice_id", practice.id)
      .order("created_at");
    members = (data ?? []) as Member[];
  }
  const team = { practice, members };
  await setMeta("team", team);
  return team;
}

export function useTeam() {
  const [team, setTeam] = useState<Team>({ practice: null, members: [] });
  const reload = () => void loadTeam().then(setTeam);
  useEffect(reload, []);
  return { team, reload };
}

export const teamAction = (action: string, payload: Record<string, unknown> = {}) =>
  callFunction<Record<string, unknown>>("team", { action, ...payload });

/**
 * Compte famille ou compte professionnel ? Un compte relié à une fiche de contact
 * familial et sans cabinet est un compte famille. Décidé en ligne, mémorisé ensuite.
 */
export async function detectMode(userId: string): Promise<"pro" | "famille"> {
  const cached = await getMeta<"pro" | "famille">("mode");
  if (!supabase || !navigator.onLine) return cached ?? "pro";
  const [{ data: m }, { data: g }] = await Promise.all([
    supabase.from("practice_members").select("user_id").eq("user_id", userId).limit(1),
    supabase.from("guardians").select("id").eq("user_id", userId).limit(1),
  ]);
  const mode = !m?.length && g?.length ? "famille" : "pro";
  await setMeta("mode", mode);
  return mode;
}

