import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { applyImport, convert, parseCsv, tableFromFilename, toHtml } from "../import-ergocabinet";

const P1 = "aaaaaaaa-0000-4000-8000-000000000001";
const N1 = "bbbbbbbb-0000-4000-8000-000000000001";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("reprise ErgoCabinet", () => {
  it("lit un CSV avec guillemets, virgules et retours à la ligne", () => {
    const rows = parseCsv('id,content,note_date\n1,"Bonjour, ""Léo""\nligne 2",2026-10-01\n');
    expect(rows).toEqual([{ id: "1", content: 'Bonjour, "Léo"\nligne 2', note_date: "2026-10-01" }]);
  });

  it("reconnaît les noms de fichiers exportés", () => {
    expect(tableFromFilename("patients_rows.csv")).toBe("patients");
    expect(tableFromFilename("progress_note_versions_rows.csv")).toBe("progress_note_versions");
    expect(tableFromFilename("patient_guardians.json")).toBe("patient_guardians");
    expect(tableFromFilename("factures.csv")).toBeNull();
  });

  it("garde le HTML existant et convertit le texte brut", () => {
    expect(toHtml("<p><strong>a</strong></p>")).toBe("<p><strong>a</strong></p>");
    expect(toHtml("Données : x")).toContain("<strong>Données :</strong>");
  });

  it("convertit les tables et ignore ce qui n'est rattaché à aucun patient", () => {
    const { data, report } = convert({
      patients: [{ id: P1, first_name: "Léo", last_name: "Durand", status: "termine", usual_place: "atelier", usual_day: "Jeudi", usual_time: "09:00:00", created_at: "2026-09-01 10:00:00+00" }],
      progress_notes: [
        { id: N1, patient_id: P1, content: "Séance puzzle", note_date: "2026-10-01" },
        { id: "bbbbbbbb-0000-4000-8000-000000000009", patient_id: "cccccccc-0000-4000-8000-000000000000", content: "orpheline" },
      ],
      next_session_plans: [{ id: "dddddddd-0000-4000-8000-000000000001", patient_id: P1, content: "Dobble", status: "pending", planned_date: "" }],
      tasks: [{ id: "eeeeeeee-0000-4000-8000-000000000001", patient_id: "", title: "Commander", status: "todo", priority: "1" }],
      guardians: [{ id: "ffffffff-0000-4000-8000-000000000001", first_name: "Claire", last_name: "Durand", email: "Claire@Mail.fr", civility: "Madame", receives_reports: "true" }],
      patient_guardians: [{ id: "ffffffff-0000-4000-8000-000000000002", guardian_id: "ffffffff-0000-4000-8000-000000000001", patient_id: P1, relation: "mère" }],
      communications: [{ id: "99999999-0000-4000-8000-000000000001", patient_id: P1, channel: "call", direction: "in", sent_at: "2026-10-02T08:00:00Z", transcript: "allô" }],
      parent_reports: [{ id: "88888888-0000-4000-8000-000000000001", patient_id: P1, title: "Séance du 1er", content: "Très bien", published_at: "2026-10-01T18:00:00Z" }],
    });
    const p = data.patients![0] as unknown as Record<string, unknown>;
    expect(p.status).toBe("archive");
    expect(p.usual_place).toBe("autre");
    expect(p.usual_time).toBe("09:00");
    expect(report.counts.notes).toBe(1);
    expect(report.warnings.join(" ")).toContain("1 note(s) ignoré(s)");
    expect((data.forecasts![0] as unknown as { status: string }).status).toBe("a_faire");
    expect((data.tasks![0] as unknown as { urgent: boolean; patient_id: null }).urgent).toBe(true);
    expect((data.guardians![0] as unknown as { email: string; relation: string }).email).toBe("claire@mail.fr");
    expect((data.communications![0] as unknown as { channel: string }).channel).toBe("appel");
    expect(data.communications![0]).not.toHaveProperty("transcript");
    expect(report.warnings.join(" ")).toContain("1 retranscription(s) intégrale(s) non reprise(s)");
    expect((data.family_reports![0] as unknown as { patient_first_name: string; published: boolean }).published).toBe(true);
  });

  it("refaire l'import ne crée pas de doublon et n'écrase pas une version plus récente", async () => {
    const src = { patients: [{ id: P1, first_name: "Léo", last_name: "Durand", updated_at: "2026-09-01T00:00:00Z" }] };
    expect(await applyImport(convert(src).data)).toBe(1);
    await db.patients.update(P1, { first_name: "Léo modifié", updated_at: "2026-11-01T00:00:00Z" });
    expect(await applyImport(convert(src).data)).toBe(0);
    expect((await db.patients.get(P1))!.first_name).toBe("Léo modifié");
    expect(await db.patients.count()).toBe(1);
  });
});
