import Dexie, { type Table } from "dexie";
import type { Draft, OutboxEntry, Tables } from "./types";

/**
 * Base locale de l'appareil (IndexedDB).
 * C'est la source de vérité de l'interface : tout s'y écrit d'abord,
 * puis le moteur de synchronisation envoie les changements au serveur.
 */
export class LocalDb extends Dexie {
  patients!: Table<Tables["patients"], string>;
  notes!: Table<Tables["notes"], string>;
  note_versions!: Table<Tables["note_versions"], string>;
  forecasts!: Table<Tables["forecasts"], string>;
  tasks!: Table<Tables["tasks"], string>;
  assessments!: Table<Tables["assessments"], string>;
  goals!: Table<Tables["goals"], string>;
  goal_progress!: Table<Tables["goal_progress"], string>;
  guardians!: Table<Tables["guardians"], string>;
  communications!: Table<Tables["communications"], string>;
  family_reports!: Table<Tables["family_reports"], string>;
  patient_shares!: Table<Tables["patient_shares"], string>;
  outbox!: Table<OutboxEntry, number>;
  drafts!: Table<Draft, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = "carnet2suivi") {
    super(name);
    this.version(1).stores({
      patients: "id, status, usual_day, updated_at",
      notes: "id, patient_id, note_date, updated_at",
      note_versions: "id, note_id, updated_at",
      forecasts: "id, patient_id, status, planned_date, updated_at",
      tasks: "id, patient_id, status, due_date, updated_at",
      assessments: "id, patient_id, updated_at",
      goals: "id, patient_id, updated_at",
      goal_progress: "id, goal_id, patient_id, updated_at",
      outbox: "++seq, [table+row_id]",
      drafts: "key",
      meta: "key",
    });
    // Étapes 2 et 3 : communications, familles, partage des dossiers.
    this.version(2).stores({
      guardians: "id, patient_id, updated_at",
      communications: "id, patient_id, status, occurred_at, external_id, updated_at",
      family_reports: "id, patient_id, note_id, report_date, updated_at",
      patient_shares: "id, patient_id, user_id, updated_at",
      pending_audio: "id, communication_id",
    });
    // Plus aucun enregistrement audio : la table d'attente est supprimée.
    this.version(3).stores({ pending_audio: null });
  }
}

export const db = new LocalDb();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
