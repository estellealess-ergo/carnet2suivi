import type { GoalStatus, PatientStatus, Place } from "./types";

export const STATUS_LABEL: Record<PatientStatus, string> = {
  actif: "En cours de suivi",
  bilan: "En cours de bilan",
  liste_attente: "Liste d'attente",
  pause: "En pause",
  non_suivi: "Non suivi",
  archive: "Archivé",
};

export const PLACE_LABEL: Record<Place, string> = {
  cabinet: "Cabinet",
  domicile: "Domicile",
  ecole: "École",
  teleconsultation: "Téléconsultation",
  autre: "Autre",
};

export const FREQUENCY_LABEL = {
  ponctuel: "Ponctuel",
  hebdomadaire: "Hebdomadaire",
  bimensuel: "Bimensuel",
} as const;

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  en_cours: "En cours",
  atteint: "Atteint",
  suspendu: "Suspendu",
  abandonne: "Abandonné",
};

export function fullName(p?: { first_name?: string | null; last_name?: string | null } | null) {
  if (!p) return "—";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Sans nom";
}

export function initials(p?: { first_name?: string | null; last_name?: string | null } | null) {
  if (!p) return "?";
  return `${p.first_name?.[0] ?? ""}${p.last_name?.[0] ?? ""}`.toUpperCase() || "?";
}
