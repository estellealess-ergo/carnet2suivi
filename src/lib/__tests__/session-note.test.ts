import { describe, expect, it } from "vitest";
import { textToHtml } from "../html";
import { buildNoteHtml, fillTemplate, insertInRubric, jotsToRaw, keywordSuggestions, rawToJots, templateFields } from "../session-note";

describe("note de séance en trois rubriques", () => {
  it("compose la note à partir du débrief, sans rubrique vide", () => {
    const html = buildNoteHtml({ fait: "Dobble, lignage Seyès", observe: "3/5 sans modèle <aide verbale>", reprendre: "" });
    expect(html).toBe(
      "<p><strong>Fait :</strong> Dobble, lignage Seyès</p><p><strong>Observé :</strong> 3/5 sans modèle &lt;aide verbale&gt;</p>",
    );
  });

  it("met en gras les intertitres renvoyés par l'assistant", () => {
    expect(textToHtml("Fait : puzzle\nÀ reprendre : lignage 3 mm")).toBe(
      "<p><strong>Fait :</strong> puzzle<br><strong>À reprendre :</strong> lignage 3 mm</p>",
    );
  });

  it("conserve et relit les mots-clés de séance", () => {
    const raw = jotsToRaw(["puzzle 12/15 aide verbale", "fatigue après 20 min"]);
    expect(rawToJots(raw)).toEqual(["puzzle 12/15 aide verbale", "fatigue après 20 min"]);
    expect(rawToJots("autre texte")).toEqual([]);
    expect(jotsToRaw([])).toBeNull();
  });

  it("propose les débuts de mots-clés les plus utilisés", () => {
    const raws = [jotsToRaw(["Puzzle 12/15", "Dobble 8 min"]), jotsToRaw(["puzzle 14/15", "lignage Seyès 3/5"]), null];
    expect(keywordSuggestions(raws)).toEqual(["Puzzle", "Dobble", "lignage Seyès"]);
  });
});

import { composeFamilyMessage, splitFamilyMessage, whatsappLink, whatsappNumber } from "../session-note";

describe("message aux familles", () => {
  it("assemble et relit le récap et « à faire à la maison »", () => {
    const c = composeFamilyMessage("Très bonne séance.", "5 min de pâte à modeler par jour");
    expect(c).toBe("Très bonne séance.\n\nÀ faire à la maison :\n5 min de pâte à modeler par jour");
    expect(splitFamilyMessage(c)).toEqual({ recap: "Très bonne séance.", home: "5 min de pâte à modeler par jour" });
    expect(composeFamilyMessage("Récap", "")).toBe("Récap");
  });
  it("prépare les numéros et liens WhatsApp", () => {
    expect(whatsappNumber("06 12 34 56 78")).toBe("33612345678");
    expect(whatsappNumber("+262 692 12 34 56")).toBe("262692123456");
    expect(whatsappNumber("12")).toBeNull();
    expect(whatsappLink("06.12.34.56.78", "Bonjour !")).toBe("https://wa.me/33612345678?text=Bonjour%20!");
  });
});

describe("activités enregistrées", () => {
  const t = "Entraînement TypingClub, leçon [leçon] (lettres : [lettres]) : [vitesse] mpm, [précision] % de précision réelle";
  it("repère et remplit les cases", () => {
    expect(templateFields(t)).toEqual(["leçon", "lettres", "vitesse", "précision"]);
    expect(fillTemplate(t, { leçon: "12", lettres: "q, s", vitesse: "18", précision: "92" })).toBe(
      "Entraînement TypingClub, leçon 12 (lettres : q, s) : 18 mpm, 92 % de précision réelle",
    );
  });
  it("ajoute dans la bonne rubrique", () => {
    expect(insertInRubric("<p></p>", "fait", "A")).toBe("<p><strong>Fait :</strong> A</p>");
    const n = "<p><strong>Fait :</strong> A</p><p><strong>À reprendre :</strong> C</p>";
    expect(insertInRubric(n, "fait", "B")).toBe("<p><strong>Fait :</strong> A ; B</p><p><strong>À reprendre :</strong> C</p>");
    expect(insertInRubric(n, "observe", "O")).toBe("<p><strong>Fait :</strong> A</p><p><strong>Observé :</strong> O</p><p><strong>À reprendre :</strong> C</p>");
  });
});
