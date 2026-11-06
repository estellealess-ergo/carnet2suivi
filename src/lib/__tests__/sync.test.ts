import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { create, remove, update } from "../repo";
import { pull, push, syncOnce, type Cursor, type Remote } from "../sync";
import type { SyncedRow, TableName } from "../types";

/** Faux serveur en mémoire qui reproduit les règles du SQL (dernière écriture gagne). */
function fakeServer() {
  const rows = new Map<string, SyncedRow & { server_updated_at: string; table: TableName }>();
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const remote: Remote = {
    async upsert(table, batch) {
      for (const r of batch) {
        const prev = rows.get(r.id);
        if (prev && r.updated_at < prev.updated_at) continue;
        clock += 1000;
        rows.set(r.id, { ...r, table, server_updated_at: new Date(clock).toISOString() });
      }
    },
    async pullAfter(table, after: Cursor | null, limit) {
      return [...rows.values()]
        .filter((r) => r.table === table)
        .filter(
          (r) =>
            !after ||
            (after.id
              ? r.server_updated_at > after.ts || (r.server_updated_at === after.ts && r.id > after.id)
              : r.server_updated_at >= after.ts),
        )
        .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(({ table: _t, ...r }) => r);
    },
  };
  return { rows, remote };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("synchronisation", () => {
  it("envoie les saisies hors ligne puis vide la file d'envoi", async () => {
    const s = fakeServer();
    const p = await create("patients", patientValues("Léa"));
    await create("notes", { patient_id: p.id, kind: "seance", note_date: "2026-11-05", content_html: "<p>a</p>", raw_text: null });
    expect(await db.outbox.count()).toBe(2);
    expect(await push(s.remote)).toBe(2);
    expect(await db.outbox.count()).toBe(0);
    expect(s.rows.size).toBe(2);
  });

  it("n'écrase pas une modification locale plus récente avec une version serveur plus ancienne", async () => {
    const s = fakeServer();
    const p = await create("patients", patientValues("Léa"));
    await syncOnce(s.remote);
    // Le serveur a une version plus ancienne mais encore non relue…
    const old = { ...(await db.patients.get(p.id))!, first_name: "Ancien", updated_at: "2000-01-01T00:00:00.000Z" };
    s.rows.set(p.id, { ...old, table: "patients", server_updated_at: "2099-01-01T00:00:00.000Z" });
    await update("patients", p.id, { first_name: "Récent" });
    await pull(s.remote);
    expect((await db.patients.get(p.id))!.first_name).toBe("Récent");
  });

  it("récupère les changements d'un autre appareil, y compris les suppressions", async () => {
    const s = fakeServer();
    const p = await create("patients", patientValues("Léa"));
    await syncOnce(s.remote);
    const other = { ...(await db.patients.get(p.id))! };
    const later = new Date(Date.now() + 60_000).toISOString();
    await s.remote.upsert("patients", [{ ...other, deleted_at: later, updated_at: later } as SyncedRow]);
    await pull(s.remote);
    expect((await db.patients.get(p.id))!.deleted_at).toBe(later);
  });

  it("pagine sans rien perdre au-delà d'une page", async () => {
    const s = fakeServer();
    for (let i = 0; i < 520; i++) await create("tasks", { patient_id: null, title: `t${i}`, due_date: null, status: "a_faire", urgent: false, details: null });
    await push(s.remote);
    await db.tasks.clear();
    await db.meta.clear();
    expect(await pull(s.remote)).toBe(520);
    expect(await db.tasks.count()).toBe(520);
  });

  it("garde l'ancienne version d'une note quand on la modifie", async () => {
    const p = await create("patients", patientValues("Léa"));
    const n = await create("notes", { patient_id: p.id, kind: "seance", note_date: "2026-11-05", content_html: "<p>v1</p>", raw_text: null });
    await update("notes", n.id, { content_html: "<p>v2</p>" });
    const versions = await db.note_versions.where("note_id").equals(n.id).toArray();
    expect(versions.map((v) => v.content_html)).toEqual(["<p>v1</p>"]);
    await remove("notes", n.id);
    expect((await db.notes.get(n.id))!.deleted_at).not.toBeNull();
  });
});

function patientValues(first: string) {
  return {
    first_name: first, last_name: "Martin", birth_date: null, status: "actif" as const,
    usual_day: null, usual_time: null, usual_place: null, frequency: null, day_order: 0, sort_order: 0,
    school_name: null, school_class: null, phone: null, email: null, consultation_reason: null,
    diagnosis: null, care_start_date: null, pinned_info: null, notes: null,
  };
}

describe("refus du serveur", () => {
  it("met de côté une ligne refusée sans bloquer les autres", async () => {
    const s = fakeServer();
    const p = await create("patients", patientValues("Léa"));
    await create("patients", patientValues("Refusée"));
    const original = s.remote.upsert;
    s.remote.upsert = async (table, rows) => {
      if (rows.some((r) => (r as unknown as { first_name: string }).first_name === "Refusée")) throw new Error("new row violates row-level security policy");
      return original(table, rows);
    };
    await push(s.remote);
    expect(s.rows.has(p.id)).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    const rejected = (await db.meta.get("rejected"))?.value as unknown[];
    expect(rejected).toHaveLength(1);
  });
});
