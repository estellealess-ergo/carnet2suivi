import { describe, expect, it } from "vitest";
import { cellToDate, matchPatient, notesFromTable, notesFromText, parseFrenchDate } from "../import-notes";
import type { Patient } from "../types";

describe("importation de notes", () => {
  it("reconnaît les dates françaises", () => {
    expect(parseFrenchDate("12/10/2026")).toBe("2026-10-12");
    expect(parseFrenchDate("5-3-26")).toBe("2026-03-05");
    expect(parseFrenchDate("jeudi 1er octobre 2026")).toBe("2026-10-01");
    expect(parseFrenchDate("2026-10-12")).toBe("2026-10-12");
    expect(parseFrenchDate("puzzle 12/15")).toBeNull();
    expect(cellToDate(46307)).toBe("2026-10-12");
  });

  it("découpe un texte aux dates", () => {
    const notes = notesFromText("Antécédents : rien\n\nSéance du 12/10/2026 : puzzle 12/15\nbonne attention\n\n19/10/2026\nDobble 8 min");
    expect(notes).toEqual([
      { date: null, text: "Antécédents : rien" },
      { date: "2026-10-12", text: "puzzle 12/15\nbonne attention" },
      { date: "2026-10-19", text: "Dobble 8 min" },
    ]);
  });

  it("lit un tableau en devinant les colonnes", () => {
    const r = notesFromTable([
      ["Prénom", "Nom", "Date de séance", "Observations"],
      ["Léo", "Durand", "12/10/2026", "Puzzle 12/15"],
      ["Inès", "Moreau", "", "Dobble"],
      ["", "", "", ""],
    ]);
    expect(r.missing).toEqual([]);
    expect(r.notes).toEqual([
      { patientLabel: "Léo Durand", first: "Léo", last: "Durand", date: "2026-10-12", text: "Puzzle 12/15" },
      { patientLabel: "Inès Moreau", first: "Inès", last: "Moreau", date: null, text: "Dobble" },
    ]);
  });

  it("retrouve le patient quel que soit l'ordre et les accents", () => {
    const pts = [{ id: "1", first_name: "Léo", last_name: "Durand" }] as Patient[];
    expect(matchPatient({ patientLabel: "DURAND leo" }, pts)?.id).toBe("1");
    expect(matchPatient({ patientLabel: "Léon Durand" }, pts)).toBeNull();
  });
});
