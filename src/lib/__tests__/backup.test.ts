import { beforeEach, describe, expect, it } from "vitest";
import { buildBackup, daysSinceBackup, restoreBackup } from "../backup";
import { db } from "../db";
import { create } from "../repo";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const patient = {
  first_name: "Léo", last_name: "Durand", birth_date: null, status: "actif" as const, usual_day: null, usual_time: null,
  usual_place: null, frequency: null, day_order: 0, sort_order: 0, school_name: null, school_class: null, phone: null,
  email: null, consultation_reason: null, diagnosis: null, care_start_date: null, pinned_info: "Allergie latex", notes: null,
};

describe("sauvegarde chiffrée", () => {
  it("le fichier ne contient aucune donnée lisible et se restaure avec le bon mot de passe", async () => {
    await create("patients", patient);
    const text = await (await buildBackup("cheval-bleu-42")).text();
    expect(text).not.toContain("Léo");
    expect(text).not.toContain("latex");
    expect(await daysSinceBackup()).toBe(0);

    await db.patients.clear();
    await expect(restoreBackup(text, "mauvais")).rejects.toThrow("Mot de passe incorrect");
    await expect(restoreBackup(text, null)).rejects.toThrow("protégée");
    expect(await restoreBackup(text, "cheval-bleu-42")).toBe(1);
    expect((await db.patients.toArray())[0]!.pinned_info).toBe("Allergie latex");
  });

  it("relit aussi les anciennes sauvegardes non chiffrées", async () => {
    const p = await create("patients", patient);
    const old = JSON.stringify({ app: "carnet2suivi", version: 1, data: { patients: [{ ...p, first_name: "Ancien", updated_at: "2099-01-01T00:00:00.000Z" }] } });
    expect(await restoreBackup(old, null)).toBe(1);
    expect((await db.patients.get(p.id))!.first_name).toBe("Ancien");
  });
});
