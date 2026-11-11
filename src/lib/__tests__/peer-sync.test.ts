import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { applyRows, dropCopies, open, pendingDb, restorePending, rowsToSend, seal } from "../peer-sync";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("liaison directe", () => {
  it("envoie seulement ce qui manque ou est plus récent", () => {
    const mine: [string, string][] = [["a", "2026-11-01"], ["b", "2026-11-03"], ["c", "2026-11-02"]];
    const theirs: [string, string][] = [["a", "2026-11-01"], ["b", "2026-11-02"], ["c", "2026-11-05"]];
    expect(rowsToSend(mine, theirs)).toEqual(["b"]);
    expect(rowsToSend(mine, [])).toEqual(["a", "b", "c"]);
  });

  it("la version la plus récente gagne, une plus ancienne est ignorée", async () => {
    const base = { patient_id: "p1", kind: "seance", note_date: "2026-11-06", raw_text: null, owner_id: null, created_at: "2026-11-06T08:00:00Z", deleted_at: null };
    await db.notes.put({ ...base, id: "n1", content_html: "<p>local</p>", updated_at: "2026-11-06T10:00:00Z" } as never);
    const n = await applyRows("notes", [
      { ...base, id: "n1", content_html: "<p>ancienne</p>", updated_at: "2026-11-06T09:00:00Z" },
      { ...base, id: "n2", content_html: "<p>nouvelle</p>", updated_at: "2026-11-06T09:00:00Z" },
    ]);
    expect(n).toBe(1);
    expect((await db.notes.get("n1"))!.content_html).toBe("<p>local</p>");
    await applyRows("notes", [{ ...base, id: "n1", content_html: "<p>téléphone</p>", updated_at: "2026-11-06T11:00:00Z" }]);
    expect((await db.notes.get("n1"))!.content_html).toBe("<p>téléphone</p>");
  });

  it("chiffre les messages : illisibles sans la bonne clé", async () => {
    const k1 = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const k2 = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const sealed = await seal(k1, { t: "synced" });
    expect(new TextDecoder().decode(sealed)).not.toContain("synced");
    expect(await open(k1, sealed)).toEqual({ t: "synced" });
    await expect(open(k2, sealed)).rejects.toThrow();
  });
});

describe("copie de sécurité des modifications en attente", () => {
  const row = (at: string, html: string) => ({ id: "n9", patient_id: "p1", kind: "seance", note_date: "2026-11-11", raw_text: null, owner_id: null, created_at: at, updated_at: at, deleted_at: null, content_html: html });
  it("remet une modification perdue, puis s'efface quand l'autre appareil l'a reçue", async () => {
    await pendingDb.pending.clear();
    await pendingDb.pending.put({ key: "notes:n9", table: "notes", id: "n9", updated_at: "2026-11-11T10:00:00Z", row: row("2026-11-11T10:00:00Z", "<p>hors ligne</p>") });
    expect(await restorePending()).toBe(1);
    expect((await db.notes.get("n9"))!.content_html).toBe("<p>hors ligne</p>");
    // Accusé d'une version plus ancienne : la copie reste.
    await dropCopies("notes", [["n9", "2026-11-11T09:00:00Z"]]);
    expect(await pendingDb.pending.count()).toBe(1);
    await dropCopies("notes", [["n9", "2026-11-11T10:00:00Z"]]);
    expect(await pendingDb.pending.count()).toBe(0);
  });
});
