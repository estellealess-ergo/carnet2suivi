import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import type {
  Assessment,
  Communication,
  FamilyReport,
  Forecast,
  Goal,
  GoalProgress,
  Guardian,
  Note,
  NoteVersion,
  Patient,
  PatientShare,
  Task,
} from "./types";

/** Requêtes « vivantes » : l'écran se met à jour dès que la base locale change. */

const live = <T>(fn: () => Promise<T>, deps: unknown[], fallback: T): T =>
  useLiveQuery(fn, deps) ?? fallback;

export function usePatients(): Patient[] {
  return live(
    async () =>
      (await db.patients.toArray())
        .filter((p) => !p.deleted_at)
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            a.last_name.localeCompare(b.last_name, "fr") ||
            a.first_name.localeCompare(b.first_name, "fr"),
        ),
    [],
    [],
  );
}

export function usePatient(id: string | undefined): Patient | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.patients.get(id)) ?? null) : null), [id]);
}

export function useNotes(patientId: string | undefined): Note[] {
  return live(
    async () =>
      patientId
        ? (await db.notes.where("patient_id").equals(patientId).toArray())
            .filter((n) => !n.deleted_at)
            .sort((a, b) => b.note_date.localeCompare(a.note_date) || b.created_at.localeCompare(a.created_at))
        : [],
    [patientId],
    [],
  );
}

export function useNoteVersions(noteId: string | undefined): NoteVersion[] {
  return live(
    async () =>
      noteId
        ? (await db.note_versions.where("note_id").equals(noteId).toArray()).sort((a, b) =>
            b.saved_at.localeCompare(a.saved_at),
          )
        : [],
    [noteId],
    [],
  );
}

export function useForecasts(patientId?: string): Forecast[] {
  return live(
    async () => {
      const rows = patientId
        ? await db.forecasts.where("patient_id").equals(patientId).toArray()
        : await db.forecasts.toArray();
      return rows
        .filter((f) => !f.deleted_at)
        .sort((a, b) => (a.planned_date ?? "9999").localeCompare(b.planned_date ?? "9999"));
    },
    [patientId],
    [],
  );
}

export function useTasks(patientId?: string): Task[] {
  return live(
    async () => {
      const rows = patientId
        ? await db.tasks.where("patient_id").equals(patientId).toArray()
        : await db.tasks.toArray();
      return rows
        .filter((t) => !t.deleted_at)
        .sort(
          (a, b) =>
            Number(b.urgent) - Number(a.urgent) ||
            (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
        );
    },
    [patientId],
    [],
  );
}

export function useAssessments(patientId: string | undefined): Assessment[] {
  return live(
    async () =>
      patientId
        ? (await db.assessments.where("patient_id").equals(patientId).toArray())
            .filter((a) => !a.deleted_at)
            .sort((a, b) => (b.assessment_date ?? "").localeCompare(a.assessment_date ?? ""))
        : [],
    [patientId],
    [],
  );
}

export function useGoals(patientId: string | undefined): Goal[] {
  return live(
    async () =>
      patientId
        ? (await db.goals.where("patient_id").equals(patientId).toArray())
            .filter((g) => !g.deleted_at)
            .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
        : [],
    [patientId],
    [],
  );
}

export function useGoalProgress(patientId: string | undefined): GoalProgress[] {
  return live(
    async () =>
      patientId
        ? (await db.goal_progress.where("patient_id").equals(patientId).toArray())
            .filter((g) => !g.deleted_at)
            .sort((a, b) => b.recorded_on.localeCompare(a.recorded_on))
        : [],
    [patientId],
    [],
  );
}

export function useGuardians(patientId?: string): Guardian[] {
  return live(
    async () => {
      const rows = patientId
        ? await db.guardians.where("patient_id").equals(patientId).toArray()
        : await db.guardians.toArray();
      return rows.filter((g) => !g.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    [patientId],
    [],
  );
}

/** Échanges d'un patient, ou tous les échanges si aucun patient n'est précisé. */
export function useCommunications(patientId?: string): Communication[] {
  return live(
    async () => {
      const rows = patientId
        ? await db.communications.where("patient_id").equals(patientId).toArray()
        : await db.communications.toArray();
      return rows.filter((c) => !c.deleted_at).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    },
    [patientId],
    [],
  );
}

export function useFamilyReports(patientId?: string): FamilyReport[] {
  return live(
    async () => {
      const rows = patientId
        ? await db.family_reports.where("patient_id").equals(patientId).toArray()
        : await db.family_reports.toArray();
      return rows
        .filter((r) => !r.deleted_at)
        .sort((a, b) => b.report_date.localeCompare(a.report_date) || b.created_at.localeCompare(a.created_at));
    },
    [patientId],
    [],
  );
}

export function useNotesOn(day: string): Note[] {
  return live(
    async () =>
      (await db.notes.where("note_date").equals(day).toArray()).filter((n) => !n.deleted_at && n.kind === "seance"),
    [day],
    [],
  );
}

export function useShares(patientId?: string): PatientShare[] {
  return live(
    async () => {
      const rows = patientId
        ? await db.patient_shares.where("patient_id").equals(patientId).toArray()
        : await db.patient_shares.toArray();
      return rows.filter((s) => !s.deleted_at);
    },
    [patientId],
    [],
  );
}

