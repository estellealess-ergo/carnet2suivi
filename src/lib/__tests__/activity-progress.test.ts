import { describe, expect, it } from "vitest";
import { activityHistory, chartSvgString, fieldUnit, numericFields, progressSentence, seriesOf } from "../activity-progress";
import { fillTemplate, insertInRubric } from "../session-note";
import type { Activity, Note } from "../types";

const T = "Entraînement TypingClub, leçon [leçon] (lettres : [lettres]) : [vitesse] mpm, [précision] % de précision réelle";
const act = { id: "a", title: "TypingClub", template: T, rubric: "fait", sort_order: 0 } as Activity;
const note = (id: string, date: string, html: string) => ({ id, note_date: date, kind: "seance", content_html: html, deleted_at: null }) as Note;

describe("progression d'une activité", () => {
  const l1 = fillTemplate(T, { leçon: "12", lettres: "q, s", vitesse: "12", précision: "85" });
  const l2 = fillTemplate(T, { leçon: "13", lettres: "a, ;", vitesse: "15,5", précision: "90" });
  const l3 = fillTemplate(T, { leçon: "14", lettres: "g", vitesse: "18", précision: "92" });
  const notes = [
    note("n3", "2026-10-20", insertInRubric("<p><strong>Fait :</strong> puzzle</p>", "fait", l3)),
    note("n1", "2026-10-06", insertInRubric("", "fait", l1)),
    note("n2", "2026-10-13", `<p><strong>Fait :</strong> ${l2} ; jeu de l'oie</p><p><strong>Observé :</strong> fatigue</p>`),
    note("n4", "2026-10-27", "<p>Rien à voir</p>"),
  ];
  const h = activityHistory(act, notes);
  it("retrouve les valeurs dans les notes, dans l'ordre des dates", () => {
    expect(h.map((x) => x.values["vitesse"])).toEqual(["12", "15,5", "18"]);
    expect(h[1]!.values["lettres"]).toBe("a, ;");
    expect(numericFields(act, h)).toEqual(["leçon", "vitesse", "précision"]);
    expect(seriesOf(h, "vitesse").map((p) => p.value)).toEqual([12, 15.5, 18]);
  });
  it("unités et synthèse", () => {
    expect(fieldUnit(T, "vitesse")).toBe("mpm");
    expect(fieldUnit(T, "précision")).toBe("%");
    expect(fieldUnit(T, "leçon")).toBe("");
    expect(progressSentence(act, h)).toBe("TypingClub (3 séances, du 06/10/2026 au 20/10/2026) : leçon de 12 à 14 ; vitesse de 12 mpm à 18 mpm ; précision de 85 % à 92 %.");
  });
  it("dessine un graphique", () => {
    const svg = chartSvgString(seriesOf(h, "vitesse"), "mpm", "Vitesse (mpm)");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("18 mpm");
  });
});
