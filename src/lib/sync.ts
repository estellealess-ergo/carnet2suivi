import { db, getMeta, setMeta } from "./db";
import { TABLES, type SyncedRow, type TableName } from "./types";

/**
 * Accès au serveur, abstrait pour pouvoir être testé sans réseau.
 * L'implémentation réelle (Supabase) est dans supabase.ts.
 */
export interface Remote {
  /** Envoie des lignes ; le serveur ignore une ligne plus ancienne que la sienne. */
  upsert(table: TableName, rows: SyncedRow[]): Promise<void>;
  /**
   * Lignes modifiées sur le serveur strictement après la position donnée,
   * triées par (server_updated_at, id) : pagination sans perte ni doublon.
   */
  pullAfter(
    table: TableName,
    after: Cursor | null,
    limit: number,
  ): Promise<(SyncedRow & { server_updated_at: string })[]>;
}

export type Cursor = { ts: string; id: string };

/**
 * À chaque synchronisation on repart un peu en arrière : une écriture validée
 * tardivement sur le serveur (transaction longue) ne peut pas être manquée.
 * La fusion est idempotente, relire quelques lignes ne coûte rien.
 */
export const OVERLAP_MS = 2 * 60 * 1000;

export function rewind(ts: string): Cursor {
  return { ts: new Date(new Date(ts).getTime() - OVERLAP_MS).toISOString(), id: "" };
}

export type SyncState = {
  status: "idle" | "syncing" | "offline" | "error" | "local";
  pending: number;
  lastSyncAt: string | null;
  error: string | null;
};

const PAGE = 500;

/** Envoie tout ce qui attend dans la file d'envoi. Renvoie le nombre de lignes envoyées. */
export async function push(remote: Remote): Promise<number> {
  const entries = await db.outbox.orderBy("seq").toArray();
  if (entries.length === 0) return 0;
  let sent = 0;
  for (const table of TABLES) {
    const forTable = entries.filter((e) => e.table === table);
    if (forTable.length === 0) continue;
    const ids = [...new Set(forTable.map((e) => e.row_id))];
    const rows = (await db.table(table).bulkGet(ids)).filter(Boolean) as SyncedRow[];
    for (let i = 0; i < rows.length; i += PAGE) {
      const batch = rows.slice(i, i + PAGE);
      try {
        await remote.upsert(table, batch);
      } catch (e) {
        if (isNetworkError(e)) throw e;
        // Une ligne refusée (ex. dossier dont le partage a été retiré) ne doit pas
        // bloquer tout le reste : on envoie ligne par ligne et on met de côté les refus.
        for (const row of batch) {
          try {
            await remote.upsert(table, [row]);
          } catch (err) {
            if (isNetworkError(err)) throw err;
            await keepRejected(table, row, (err as Error).message);
          }
        }
      }
    }
    // On ne retire que les entrées lues au départ : une modification faite
    // pendant l'envoi reste dans la file et partira au prochain passage.
    await db.outbox.bulkDelete(forTable.map((e) => e.seq!));
    sent += rows.length;
  }
  return sent;
}

/** Récupère les changements du serveur et les fusionne dans la base locale. */
export async function pull(remote: Remote): Promise<number> {
  let received = 0;
  for (const table of TABLES) {
    const key = `cursor:${table}`;
    const saved = (await getMeta<string>(key)) ?? null;
    let cursor: Cursor | null = saved ? rewind(saved) : null;
    for (;;) {
      const batch = await remote.pullAfter(table, cursor, PAGE);
      if (batch.length === 0) break;
      await mergeRemote(table, batch);
      received += batch.length;
      const last = batch[batch.length - 1]!;
      cursor = { ts: last.server_updated_at, id: last.id };
      await setMeta(key, last.server_updated_at);
      if (batch.length < PAGE) break;
    }
  }
  return received;
}

/**
 * Règle de fusion : la version la plus récente gagne (updated_at).
 * Une modification locale encore en attente d'envoi n'est jamais écrasée
 * par une version plus ancienne du serveur.
 */
export async function mergeRemote(
  table: TableName,
  batch: (SyncedRow & { server_updated_at?: string })[],
) {
  await db.transaction("rw", db.table(table), db.outbox, async () => {
    const locals = (await db.table(table).bulkGet(batch.map((r) => r.id))) as (
      | SyncedRow
      | undefined
    )[];
    const toPut: SyncedRow[] = [];
    batch.forEach((remoteRow, i) => {
      const { server_updated_at: _ignored, ...row } = remoteRow;
      const local = locals[i];
      if (local && local.updated_at > row.updated_at) return;
      toPut.push(row);
    });
    if (toPut.length) await db.table(table).bulkPut(toPut);
  });
}

export async function syncOnce(remote: Remote) {
  const sent = await push(remote);
  const received = await pull(remote);
  await setMeta("lastSyncAt", new Date().toISOString());
  return { sent, received };
}

export async function pendingCount() {
  return db.outbox.count();
}

function isNetworkError(e: unknown) {
  const m = String((e as Error)?.message ?? e);
  return !navigator.onLine || /fetch|network|Failed to fetch|NetworkError|timeout/i.test(m);
}

export type Rejected = { table: TableName; row: SyncedRow; reason: string; at: string };

/** Modifications refusées par le serveur : conservées sur l'appareil, visibles dans les Paramètres. */
async function keepRejected(table: TableName, row: SyncedRow, reason: string) {
  const list = (await getMeta<Rejected[]>("rejected")) ?? [];
  list.push({ table, row, reason, at: new Date().toISOString() });
  await setMeta("rejected", list.slice(-200));
}
