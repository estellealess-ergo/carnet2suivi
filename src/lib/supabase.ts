import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Cursor, Remote } from "./sync";
import type { SyncedRow, TableName } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Sans adresse de serveur configurée, l'application fonctionne en « mode local » :
 * tout reste sur l'appareil. Utile pour essayer, mais à ne pas utiliser
 * comme seul stockage de vrais dossiers (pas de sauvegarde serveur).
 */
export const serverConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null = serverConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "carnet2suivi-auth" },
    })
  : null;

export const supabaseRemote = (client: SupabaseClient): Remote => ({
  async upsert(table: TableName, rows: SyncedRow[]) {
    const { error } = await client.from(table).upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`${table} : ${error.message}`);
  },
  async pullAfter(table: TableName, after: Cursor | null, limit: number) {
    let q = client
      .from(table)
      .select("*")
      .order("server_updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (after) {
      q = after.id
        ? q.or(
            `server_updated_at.gt."${after.ts}",and(server_updated_at.eq."${after.ts}",id.gt.${after.id})`,
          )
        : q.gte("server_updated_at", after.ts);
    }
    const { data, error } = await q;
    if (error) throw new Error(`${table} : ${error.message}`);
    return (data ?? []) as (SyncedRow & { server_updated_at: string })[];
  },
});
