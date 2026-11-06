/** Petits outils pour passer du texte mis en forme (HTML) au texte brut et inversement. */

export function htmlToText(html: string): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<\/(p|h[1-6]|li|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Texte brut → HTML simple. Met en gras les intertitres de la note de séance
 * (« Fait : », « Observé : », « À reprendre : ») et ceux des anciennes notes DAP.
 */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return "";
      if (lines.every((l) => /^[-•*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li><p>${esc(l.replace(/^[-•*]\s+/, ""))}</p></li>`).join("")}</ul>`;
      }
      return `<p>${lines
        .map((l) => {
          const m = l.match(/^(Fait|Observé|À reprendre|Données|Analyse|Plan)\s*:\s*(.*)$/);
          return m ? `<strong>${esc(m[1]!)} :</strong> ${esc(m[2]!)}` : esc(l);
        })
        .join("<br>")}</p>`;
    })
    .join("");
}

export function isEmptyHtml(html: string | null | undefined) {
  return !html || htmlToText(html).trim() === "";
}
