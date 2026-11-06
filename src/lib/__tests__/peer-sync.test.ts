import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { applyRows, open, rowsToSend, seal } from "../peer-sync";

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
