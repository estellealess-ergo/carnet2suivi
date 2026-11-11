import { describe, expect, it } from "vitest";
import { groupsOf, isoWeek, patientsForDay, weekParity } from "../schedule";
import type { DayChange, Patient } from "../types";

const P = (id: string, extra: Partial<Patient> = {}) =>
  ({ id, first_name: id, last_name: "", status: "actif", usual_day: "Jeudi", usual_time: "09:00", day_order: 0, deleted_at: null, ...extra }) as Patient;
const change = (patient_id: string, day: string, kind: "ajout" | "annulation", time: string | null = null) =>
  ({ id: `${patient_id}${day}${kind}`, patient_id, day, kind, time, deleted_at: null }) as DayChange;

describe("planning par date", () => {
  it("calcule la semaine ISO et sa parité", () => {
    expect(isoWeek("2026-11-05")).toBe(45);
    expect(weekParity("2026-11-05")).toBe("impaire");
    expect(weekParity("2026-11-12")).toBe("paire");
    expect(isoWeek("2027-01-01")).toBe(53);
  });

  it("gère le rythme une semaine sur deux", () => {
    const pts = [P("hebdo"), P("pair", { frequency: "bimensuel", week_parity: "paire" }), P("impair", { frequency: "bimensuel", week_parity: "impaire" })];
    expect(patientsForDay(pts, [], "2026-11-05").entries.map((e) => e.patient.id)).toEqual(["hebdo", "impair"]);
    expect(patientsForDay(pts, [], "2026-11-12").entries.map((e) => e.patient.id)).toEqual(["hebdo", "pair"]);
  });

  it("retire les séances annulées et ajoute les séances ponctuelles", () => {
    const pts = [P("a"), P("b"), P("c", { usual_day: "Lundi", day_order: 5 })];
    const r = patientsForDay(pts, [change("a", "2026-11-05", "annulation"), change("c", "2026-11-05", "ajout", "16:00")], "2026-11-05");
    expect(r.entries.map((e) => [e.patient.id, e.time, e.added])).toEqual([["b", "09:00", false], ["c", "16:00", true]]);
    expect(r.cancelled.map((p) => p.id)).toEqual(["a"]);
  });

  it("ignore les patients archivés ou en pause", () => {
    expect(patientsForDay([P("x", { status: "pause" })], [], "2026-11-05").entries).toEqual([]);
  });
});


describe("séances de groupe", () => {
  it("regroupe les patients prévus à la même heure", () => {
    const p = (id: string) => ({ id, first_name: id }) as never;
    const g = groupsOf([
      { patient: p("a"), time: "10:00", added: false },
      { patient: p("b"), time: "09:00", added: false },
      { patient: p("c"), time: "10:00:00", added: true },
      { patient: p("d"), time: null, added: false },
      { patient: p("e"), time: null, added: false },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.time).toBe("10:00");
    expect(g[0]!.entries.map((e) => e.patient.id)).toEqual(["a", "c"]);
  });
});
