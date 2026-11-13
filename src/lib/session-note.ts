/**
 * Note de séance hebdomadaire en trois rubriques courtes : Fait / Observé / À reprendre.
 * Les mots-clés notés pendant la séance et les réponses du débrief guidé servent à la composer.
 */

export const RUBRICS = [
  {
    key: "fait",
    title: "Fait",
    question: "Qu'avez-vous fait pendant la séance ?",
    hint: "Activités, supports, jeux, exercices.",
  },
  {
    key: "observe",
    title: "Observé",
    question: "Qu'as-tu observé ?",
    hint: "Réussites et chiffres, niveau d'aide, engagement, ce que l'enfant ou le parent a dit.",
  },
  {
    key: "reprendre",
    title: "À reprendre",
    question: "Qu'est-ce qui est à reprendre ou à prévoir ?",
    hint: "Prochaine séance, matériel, contact avec l'école ou la famille.",
  },
] as const;

export type RubricKey = (typeof RUBRICS)[number]["key"];
export type Debrief = Record<RubricKey, string>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Compose la note : chaque rubrique non vide devient un paragraphe à intertitre gras. */
export function buildNoteHtml(d: Debrief): string {
  return RUBRICS.filter((r) => d[r.key].trim())
    .map((r) => `<p><strong>${r.title} :</strong> ${esc(d[r.key].trim()).replace(/\n+/g, "<br>")}</p>`)
    .join("");
}

/** Mots-clés de séance, conservés dans le brouillon brut de la note (raw_text). */
export function jotsToRaw(jots: string[]): string | null {
  return jots.length ? `Mots-clés de séance :\n${jots.map((j) => `- ${j}`).join("\n")}` : null;
}

export function rawToJots(raw: string | null | undefined): string[] {
  if (!raw?.startsWith("Mots-clés de séance :")) return [];
  return raw
    .split("\n")
    .slice(1)
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/**
 * Suggestions de mots-clés apprises des séances précédentes : le début de chaque mot-clé
 * (avant le premier chiffre), les plus fréquents d'abord. Ex. « puzzle 12/15 » → « puzzle ».
 */
export function keywordSuggestions(raws: (string | null)[], max = 8): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const raw of raws) {
    for (const jot of rawToJots(raw)) {
      const head = jot.split(/[\d:,(]/)[0]!.trim().replace(/\s+/g, " ");
      if (head.length < 3 || head.length > 40) continue;
      const k = head.toLocaleLowerCase("fr");
      const c = counts.get(k);
      if (c) c.n++;
      else counts.set(k, { label: head, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "fr"))
    .slice(0, max)
    .map((c) => c.label);
}

/* ------------------------------------------------------------------ message aux familles */

const HOME = "À faire à la maison :";

/** Le message aux familles : le récap de la séance, puis ce qu'il faut faire à la maison. */
export function composeFamilyMessage(recap: string, home: string): string {
  return [recap.trim(), home.trim() ? `${HOME}\n${home.trim()}` : ""].filter(Boolean).join("\n\n");
}

export function splitFamilyMessage(content: string): { recap: string; home: string } {
  const i = content.indexOf(HOME);
  if (i < 0) return { recap: content.trim(), home: "" };
  return { recap: content.slice(0, i).trim(), home: content.slice(i + HOME.length).trim() };
}

/** Numéro au format international pour WhatsApp (06 12 34 56 78 → 33612345678). */
export function whatsappNumber(phone: string): string | null {
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^0[1-9]\d{8}$/.test(d)) d = `33${d.slice(1)}`;
  return /^\d{8,15}$/.test(d) ? d : null;
}

export function whatsappLink(phone: string, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/* ------------------------------------------------------------------ activités enregistrées */

/** Cases à remplir d'un modèle d'activité : « leçon [leçon] : [vitesse] mpm » → ["leçon", "vitesse"]. */
export function templateFields(template: string): string[] {
  return [...new Set([...template.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.trim()))];
}

/** Remplit le modèle ; une case laissée vide devient « — ». */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\[([^\]]+)\]/g, (_, k: string) => values[k.trim()]?.trim() || "—").replace(/\s+/g, " ").trim();
}

/** Ajoute une ligne dans la bonne rubrique de la note (la crée au bon endroit si besoin). */
export function insertInRubric(html: string, rubric: RubricKey, text: string): string {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const body = doc.body;
  const title = RUBRICS.find((r) => r.key === rubric)!.title;
  const order = RUBRICS.map((r) => r.title);
  const startsWith = (el: Element, t: string) => new RegExp(`^${t}\\s*:`, "i").test(el.textContent?.trim() ?? "");
  const paras = [...body.querySelectorAll("p")];
  const target = paras.find((p) => startsWith(p, title));
  if (target) {
    const content = target.textContent!.replace(new RegExp(`^${title}\\s*:`, "i"), "").trim();
    target.append(doc.createTextNode(content ? ` ; ${text}` : ` ${text}`));
    return body.innerHTML;
  }
  const p = doc.createElement("p");
  p.innerHTML = `<strong>${title} :</strong> ${esc(text)}`;
  // Avant la première rubrique qui vient après celle-ci, sinon à la fin (ou au début pour « Fait »).
  const after = order.slice(order.indexOf(title) + 1);
  const next = paras.find((x) => after.some((t) => startsWith(x, t)));
  if (next) next.before(p);
  else if (rubric === "fait" && body.firstChild && !paras.some((x) => order.some((t) => startsWith(x, t)))) body.prepend(p);
  else body.append(p);
  // Retire un paragraphe vide laissé par l'éditeur.
  [...body.querySelectorAll("p")].forEach((x) => !x.textContent?.trim() && x !== p && x.remove());
  return body.innerHTML;
}

/**
 * Chiffres des notes brutes absents du texte mis au propre (ex. « 18 », « 92 % ») :
 * signale ce que l'assistant aurait pu oublier.
 */
export function forgottenFacts(source: string, result: string): string[] {
  const nums = (t: string) => [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(%|mpm|min|ans?|cm|s\b)?/gi)].map((m) => ({ n: m[1]!.replace(",", "."), raw: m[0].trim() }));
  const out = new Set(nums(result).map((x) => x.n));
  const seen = new Set<string>();
  return nums(source)
    .filter((x) => !out.has(x.n) && !seen.has(x.n) && (seen.add(x.n), true))
    .map((x) => x.raw);
}

/* ------------------------------------------------------------------ rubriques d'une note */

export type NoteParts = { fait: string; observe: string; reprendre: string; autre: string };

/** Retrouve les rubriques Fait / Observé / À reprendre d'une note de séance. */
export function noteParts(html: string): NoteParts {
  const out: NoteParts = { fait: "", observe: "", reprendre: "", autre: "" };
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const blocks = [...doc.body.querySelectorAll("p, li, h1, h2, h3")].map((el) => el.textContent?.trim() ?? "").filter(Boolean);
  let current: keyof NoteParts = "autre";
  for (const b of blocks) {
    const m = b.match(/^(Fait|Observé|Observe|À reprendre|A reprendre)\s*:\s*(.*)$/i);
    if (m) {
      const k = m[1]!.toLowerCase();
      current = k.startsWith("fait") ? "fait" : k.startsWith("obs") ? "observe" : "reprendre";
      if (m[2]) out[current] += (out[current] ? " " : "") + m[2];
    } else out[current] += (out[current] ? " " : "") + b;
  }
  return out;
}

