/** Recherche tolérante : sans accents, sans majuscules, mots dans n'importe quel ordre. */
export function normalize(s: string): string {
  return s.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}

export function matches(haystack: string, query: string): boolean {
  const words = normalize(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const h = normalize(haystack);
  return words.every((w) => h.includes(w));
}
