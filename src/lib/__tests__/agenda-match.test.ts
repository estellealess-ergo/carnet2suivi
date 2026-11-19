import { describe, expect, it } from "vitest";
import { matchName, normName, parseTitle, slotsOfDay } from "../agenda-match";
import type { AgendaEvent, Patient } from "../types";

const P = (id: string, first: string, last: string, extra: Partial<Patient> = {}) =>
  ({ id, first_name: first, last_name: last, status: "actif", deleted_at: null, ...extra }) as Patient;
const patients = [
  P("a", "Nina", "Roux"),
  P("b", "Hugo", "Petit"),
  P("c", "Hugo", "Martin"),
  P("d", "Éloïse", "Durand"),
  P("e", "Jean-Marc", "Leroy"),
  P("f", "Ilyès", "Benali"),
  P("g", "Sam", "Noël", { calendar_names: ["Sammy N."] }),
];

describe("titres de l'agenda", () => {
  it("lit les rendez-vous individuels et de groupe", () => {
    expect(parseTitle("Nina R.")).toEqual({ group: false, names: ["Nina R."] });
    expect(parseTitle("Groupe : Hugo P., Éloïse D., Ilyès")).toEqual({ group: true, names: ["Hugo P.", "Éloïse D.", "Ilyès"] });
    expect(normName(" Éloïse  D. ")).toBe("eloise d");
  });
  it("retrouve les patients", () => {
    expect(matchName("Nina R.", patients).patient?.id).toBe("a");
    expect(matchName("Hugo M.", patients).patient?.id).toBe("c");
    expect(matchName("Hugo", patients).patient).toBeNull(); // deux Hugo : on demande
    expect(matchName("Eloise D.", patients).patient?.id).toBe("d");
    expect(matchName("Jean-Marc L.", patients).patient?.id).toBe("e");
    expect(matchName("Ilyès", patients).patient?.id).toBe("f");
    expect(matchName("Sammy N.", patients).patient?.id).toBe("g");
    expect(matchName("Pilates", patients).patient).toBeNull();
    expect(matchName("Pilates", patients, new Set(["pilates"])).ignored).toBe(true);
  });
  it("regroupe par heure", () => {
    const ev = (id: string, time: string, title: string): AgendaEvent => ({ id, day: "2026-11-24", time, end: null, title });
    const slots = slotsOfDay([ev("1", "10:00", "Groupe : Nina R., Hugo P."), ev("2", "09:00", "Éloïse D."), ev("3", "11:00", "Ilyès"), ev("4", "11:00", "Jean-Marc L.")], patients, new Set());
    expect(slots.map((s) => [s.time, s.group, s.matches.map((m) => m.patient?.id)])).toEqual([
      ["09:00", false, ["d"]],
      ["10:00", true, ["a", "b"]],
      ["11:00", true, ["f", "e"]],
    ]);
  });
});
