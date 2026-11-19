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
      { id: "1", day: "2026-11-24", time: "09:30", end: "10:15", title: "Nina R." },
      { id: "4", day: "2026-11-24", time: "12:00", end: null, title: "(sans titre)" },
    ]);
  });
});
