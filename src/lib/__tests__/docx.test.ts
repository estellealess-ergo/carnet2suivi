import { describe, expect, it } from "vitest";
import { htmlToParagraphs } from "../export-docx";

describe("export Word", () => {
  it("convertit gras, couleurs et listes en paragraphes", () => {
    const paras = htmlToParagraphs('<p><strong>Données :</strong> <span style="color: rgb(200, 0, 0)">rouge</span></p><ul><li><p>a</p></li><li><p>b</p></li></ul>');
    expect(paras.length).toBe(3);
  });
});
