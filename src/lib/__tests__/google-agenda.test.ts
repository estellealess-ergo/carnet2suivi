import { describe, expect, it } from "vitest";
import { parisDayTime, parisOffset, parisToday, toAgendaEvents } from "../google-agenda";

describe("Google Agenda (lecture seule)", () => {
  it("calcule l'heure de Paris quel que soit le fuseau de l'appareil", () => {
    expect(parisOffset("2026-11-24")).toBe("+01:00");
    expect(parisOffset("2026-07-14")).toBe("+02:00");
    expect(parisDayTime("2026-11-24T10:40:00+01:00")).toEqual({ day: "2026-11-24", time: "10:40" });
    // Un horaire en UTC tard le soir tombe le lendemain à Paris.
    expect(parisDayTime("2026-11-24T23:30:00Z")).toEqual({ day: "2026-11-25", time: "00:30" });
    expect(parisToday(new Date("2026-11-24T23:30:00Z"))).toBe("2026-11-25");
  });
  it("ne garde que les rendez-vous avec horaire, ni annulés ni sur la journée", () => {
    const ev = toAgendaEvents([
      { id: "1", summary: "Nina R.", start: { dateTime: "2026-11-24T09:30:00+01:00" }, end: { dateTime: "2026-11-24T10:15:00+01:00" } },
      { id: "2", summary: "Férié", start: { date: "2026-11-24" }, end: { date: "2026-11-25" } },
      { id: "3", summary: "Annulé", status: "cancelled", start: { dateTime: "2026-11-24T11:00:00+01:00" } },
      { id: "4", start: { dateTime: "2026-11-24T12:00:00+01:00" } },
    ]);
    expect(ev).toEqual([
      { id: "1", day: "2026-11-24", time: "09:30", end: "10:15", title: "Nina R.", recurring: false },
      { id: "4", day: "2026-11-24", time: "12:00", end: null, title: "(sans titre)", recurring: false },
    ]);
  });
});

import { db } from "../db";
import { syncUsualTimes } from "../google-agenda";
import { agendaEntries } from "../agenda-match";
import { applyDayChanges } from "../schedule";
import type { AgendaEvent, DayChange, Patient } from "../types";

describe("horaires alignés sur l'agenda", () => {
  const P = (id: string, first: string, last: string, extra: Partial<Patient> = {}) =>
    ({ id, owner_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", deleted_at: null, first_name: first, last_name: last, status: "actif", usual_day: "Lundi", usual_time: "09:00", usual_place: null, frequency: "hebdomadaire", day_order: 0, sort_order: 0, birth_date: null, school_name: null, school_class: null, phone: null, email: null, consultation_reason: null, diagnosis: null, care_start_date: null, pinned_info: null, notes: null, ...extra }) as Patient;
  const ev = (id: string, day: string, time: string, title: string, recurring = true): AgendaEvent => ({ id, day, time, end: null, title, recurring });

  it("met à jour le jour et l'heure habituels d'après les rendez-vous répétés", async () => {
    await db.patients.clear();
    await db.patients.bulkPut([P("a", "Nina", "Roux"), P("b", "Hugo", "Petit", { usual_day: "Mardi", usual_time: "10:40" }), P("c", "Éloïse", "Durand")]);
    const changed = await syncUsualTimes([
      ev("1", "2026-11-24", "10:40", "Groupe : Nina R., Hugo P."), // mardi
      ev("2", "2026-11-25", "14:00", "Éloïse D.", false), // ponctuel : pas pris en compte
    ]);
    expect(changed).toEqual(["Nina Roux"]);
    const a = await db.patients.get("a");
    expect([a!.usual_day, a!.usual_time]).toEqual(["Mardi", "10:40"]);
    expect((await db.patients.get("c"))!.usual_day).toBe("Lundi");
  });

  it("Ma journée d'après l'agenda, avec ajouts et annulations", () => {
    const ps = [P("a", "Nina", "Roux"), P("b", "Hugo", "Petit"), P("c", "Éloïse", "Durand")];
    const { entries, unmatched } = agendaEntries([ev("1", "2026-11-24", "10:40", "Groupe : Nina R., Hugo P."), ev("2", "2026-11-24", "09:30", "Pilates")], ps, new Set());
    expect(entries.map((e) => [e.patient.id, e.time])).toEqual([["a", "10:40"], ["b", "10:40"]]);
    expect(unmatched).toEqual(["Pilates"]);
    const changes = [
      { id: "x", patient_id: "b", day: "2026-11-24", kind: "annulation", time: null, deleted_at: null },
      { id: "y", patient_id: "c", day: "2026-11-24", kind: "ajout", time: "16:00", deleted_at: null },
    ] as DayChange[];
    const r = applyDayChanges(entries, ps, changes, "2026-11-24");
    expect(r.entries.map((e) => [e.patient.id, e.time])).toEqual([["a", "10:40"], ["c", "16:00"]]);
    expect(r.cancelled.map((p) => p.id)).toEqual(["b"]);
  });
});
