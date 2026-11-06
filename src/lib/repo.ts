import { db } from "./db";
import type { Note, SyncedRow, TableName, Tables } from "./types";

/** Signal émis après chaque écriture locale : le moteur de synchronisation s'y abonne. */
export const changes = new EventTarget();

let currentOwner: string | null = null;
export function setOwner(id: string | null) {
  currentOwner = id;
}
export function getOwner() {
  return currentOwner;
}

/** Horodatage strictement croissant sur cet appareil (deux écritures dans la même ms restent ordonnées). */
let lastStamp = 0;
export function stamp(): string {
  const now = Math.max(Date.now(), lastStamp + 1);
  lastStamp = now;
  return new Date(now).toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

type Insert<K extends TableName> = Omit<Tables[K], keyof SyncedRow> & Partial<Pick<SyncedRow, "id">>;
type Patch<K extends TableName> = Partial<Omit<Tables[K], keyof SyncedRow>>;

async function enqueue(table: TableName, rowId: string) {
  await db.outbox.add({ table, row_id: rowId, queued_at: new Date().toISOString() });
}

function emit() {
  changes.dispatchEvent(new Event("change"));
}

export async function create<K extends TableName>(table: K, values: Insert<K>): Promise<Tables[K]> {
  const at = stamp();
  const row = {
    ...values,
    id: values.id ?? newId(),
    owner_id: currentOwner,
    created_at: at,
    updated_at: at,
    deleted_at: null,
  } as unknown as Tables[K];
  await db.transaction("rw", db.table(table), db.outbox, async () => {
    await db.table(table).put(row);
    await enqueue(table, row.id);
  });
  emit();
  return row;
}

export async function update<K extends TableName>(table: K, id: string, patch: Patch<K>) {
  await db.transaction("rw", db.table(table), db.outbox, db.note_versions, async () => {
    const prev = (await db.table(table).get(id)) as Tables[K] | undefined;
    if (!prev) throw new Error("Élément introuvable sur cet appareil.");
    const at = stamp();
    // Historique des versions : on garde le texte AVANT modification d'une note.
    if (table === "notes" && "content_html" in patch) {
      const note = prev as unknown as Note;
      if (note.content_html && note.content_html !== (patch as Partial<Note>).content_html) {
        const v = {
          id: newId(),
          owner_id: currentOwner,
          created_at: at,
          updated_at: at,
          deleted_at: null,
          note_id: id,
          patient_id: note.patient_id,
          content_html: note.content_html,
          saved_at: note.updated_at,
        };
        await db.note_versions.put(v);
        await enqueue("note_versions", v.id);
      }
    }
    await db.table(table).put({ ...prev, ...patch, updated_at: at });
    await enqueue(table, id);
  });
  emit();
}

export async function remove(table: TableName, id: string) {
  await db.transaction("rw", db.table(table), db.outbox, async () => {
    const prev = await db.table(table).get(id);
    if (!prev) return;
    const at = stamp();
    await db.table(table).put({ ...prev, deleted_at: at, updated_at: at });
    await enqueue(table, id);
  });
  emit();
}

/** Restaure un élément supprimé (ex. remettre une prévision). */
export async function restore(table: TableName, id: string) {
  await db.transaction("rw", db.table(table), db.outbox, async () => {
    const prev = await db.table(table).get(id);
    if (!prev) return;
    await db.table(table).put({ ...prev, deleted_at: null, updated_at: stamp() });
    await enqueue(table, id);
  });
  emit();
}

export const alive = <T extends { deleted_at: string | null }>(r: T) => r.deleted_at === null;
