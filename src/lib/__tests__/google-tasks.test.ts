import { describe, expect, it } from "vitest";
import { differs, expected, textFromGoogle, winner } from "../google-tasks";
import type { Forecast, Patient, Task } from "../types";

const milo = { id: "p", first_name: "Milo", last_name: "Durand" } as Patient;
const fc = (extra: Partial<Forecast> = {}) => ({ id: "f", patient_id: "p", content: "À préparer : labyrinthes niveau 3", planned_date: "2026-11-27", status: "a_faire", note_id: null, deleted_at: null, updated_at: "2026-11-20T10:00:00Z", ...extra }) as Forecast;

describe("Google Tasks", () => {
  it("n'envoie jamais le nom de famille ; le prénom seulement si choisi", () => {
    expect(expected({ kind: "forecast", row: fc(), patient: milo }, false).title).toBe("À préparer : labyrinthes niveau 3");
    expect(expected({ kind: "forecast", row: fc(), patient: milo }, true).title).toBe("Milo : À préparer : labyrinthes niveau 3");
    expect(JSON.stringify(expected({ kind: "forecast", row: fc(), patient: milo }, true))).not.toContain("Durand");
  });
  it("traduit statuts et dates", () => {
    const e = expected({ kind: "forecast", row: fc({ status: "transferee" }), patient: milo }, false);
    expect([e.done, e.remove, e.due]).toEqual([true, false, "2026-11-27T00:00:00.000Z"]);
    expect(expected({ kind: "forecast", row: fc({ status: "abandonnee" }), patient: milo }, false).remove).toBe(true);
    const t = { id: "t", patient_id: null, title: "Commander de la pâte", due_date: null, status: "fait", urgent: false, details: null, deleted_at: null } as unknown as Task;
    expect(expected({ kind: "task", row: t, patient: null }, true)).toEqual({ title: "Commander de la pâte", due: null, done: true, remove: false });
  });
  it("compare et relit les titres", () => {
    const e = expected({ kind: "forecast", row: fc(), patient: milo }, false);
    expect(differs(e, { id: "g", title: "À préparer : labyrinthes niveau 3", due: "2026-11-27T00:00:00.000Z", status: "needsAction" })).toBe(false);
    expect(differs(e, { id: "g", title: "À préparer : labyrinthes niveau 3", due: "2026-11-28T00:00:00.000Z", status: "needsAction" })).toBe(true);
    expect(textFromGoogle("Milo : À préparer : X", milo)).toBe("À préparer : X");
    expect(textFromGoogle("Acheter des feutres", null)).toBe("Acheter des feutres");
  });
  it("le côté qui a changé gagne, même si les horloges sont décalées", () => {
    const last = { title: "A", due: "2026-11-25", done: false };
    const appDone = { ...last, done: true };
    expect(winner(appDone, last, last, "2099-01-01", "2000-01-01")).toBe("app");
    expect(winner(last, { ...last, due: "2026-11-27" }, last, "2000-01-01", "2099-01-01")).toBe("google");
    expect(winner(appDone, { ...last, due: "2026-11-27" }, last, "2026-11-24T10:00Z", "2026-11-24T09:00Z")).toBe("google");
    // Prénom ajouté par le réglage : seul le titre côté app change → l'app gagne.
    expect(winner({ ...last, title: "Milo : A" }, last, last, "2099", "2000")).toBe("app");
  });
});
