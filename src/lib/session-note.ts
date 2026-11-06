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
