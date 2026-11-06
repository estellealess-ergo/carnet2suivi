import { describe, expect, it } from "vitest";
import { addDays, bucketByHorizon, localDay, relativeDay, weekdayOf } from "../dates";
import { buildPseudonymizer } from "../pseudonymize";
import { htmlToText, textToHtml } from "../html";

describe("dates", () => {
  it("utilise le jour local, pas UTC", () => {
    expect(localDay(new Date(2026, 10, 5, 23, 30))).toBe("2026-11-05");
  });
  it("calcule les jours et les libellés", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-05")).toBe("Jeudi");
    expect(relativeDay("2026-11-02", "2026-11-05")).toBe("En retard de 3 j");
    expect(relativeDay("2026-11-07", "2026-11-05")).toBe("Après-demain");
  });
  it("tableau de bord : en retard + aujourd'hui et les deux jours suivants", () => {
    const items = ["2026-11-01", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", null].map((d) => ({ d }));
    const r = bucketByHorizon(items, (x) => x.d, "2026-11-05");
    expect(r.overdue.map((x) => x.d)).toEqual(["2026-11-01"]);
    expect(r.days.map((x) => x.items.length)).toEqual([1, 1, 1]);
  });
});

describe("pseudonymisation", () => {
  it("masque puis remet les noms, sans toucher aux mots qui les contiennent", () => {
    const p = buildPseudonymizer([{ person: { first_name: "Léo", last_name: "Durand" }, label: "PATIENT" }]);
    const hidden = p.hide("Léo Durand a réussi. Léo est content. Léonard aussi.");
    expect(hidden).toBe("[PATIENT] a réussi. [PATIENT-PRÉNOM] est content. Léonard aussi.");
    expect(hidden).not.toMatch(/Durand/);
    expect(p.reveal("[PATIENT-PRÉNOM] a progressé.")).toBe("Léo a progressé.");
  });
});

describe("texte mis en forme", () => {
  it("met en gras les intertitres DAP", () => {
    const html = textToHtml("Données : puzzle 12 pièces\n\nAnalyse : bonne attention\n\nPlan : continuer");
    expect(html).toContain("<strong>Données :</strong> puzzle 12 pièces");
    expect(htmlToText(html)).toContain("Plan : continuer");
  });
});
