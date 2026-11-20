/** Identifiant stable tiré d'un texte (pour les lignes sans identifiant : refaire l'import ne double rien). */
export function stableId(text: string): string {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519) ^ (h2 >>> 13);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2) ^ text.length);
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-a${a.slice(17, 20)}-${a.slice(20, 32)}`;
}

