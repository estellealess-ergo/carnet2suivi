/**
 * Retire les noms avant tout envoi à un service d'IA, puis les remet dans la réponse.
 * Les noms ne quittent jamais l'appareil : le service ne voit que des étiquettes.
 */

export type Person = { first_name?: string | null; last_name?: string | null };

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPseudonymizer(people: { person: Person; label: string }[]) {
  // Plus long d'abord : « Marie Dupont » avant « Marie ».
  const pairs: [string, string][] = [];
  people.forEach(({ person, label }) => {
    const first = person.first_name?.trim();
    const last = person.last_name?.trim();
    if (first && last) {
      pairs.push([`${first} ${last}`, `${label}`]);
      pairs.push([`${last} ${first}`, `${label}`]);
    }
    if (first) pairs.push([first, `${label}-PRÉNOM`]);
    if (last) pairs.push([last, `${label}-NOM`]);
  });
  pairs.sort((a, b) => b[0].length - a[0].length);

  return {
    hide(text: string): string {
      let out = text;
      for (const [name, tag] of pairs) {
        if (name.length < 2) continue;
        // Respecte les limites de mots, y compris avec les lettres accentuées.
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "giu");
        out = out.replace(re, `[${tag}]`);
      }
      return out;
    },
    reveal(text: string): string {
      let out = text;
      for (const { person, label } of people) {
        const first = person.first_name?.trim() ?? "";
        const last = person.last_name?.trim() ?? "";
        out = out
          .replaceAll(`[${label}-PRÉNOM]`, first)
          .replaceAll(`[${label}-NOM]`, last)
          .replaceAll(`[${label}]`, `${first} ${last}`.trim());
      }
      return out;
    },
  };
}
