import { db } from "./db";
import { getOwner } from "./repo";
import { TABLES } from "./types";

/**
 * Après un retrait de partage, le serveur ne renvoie plus le dossier : on l'efface
 * aussi de l'appareil de la collègue.
 */
export async function purgeInaccessible() {
  const me = getOwner();
  if (!me) return;
  const shares = await db.patient_shares.toArray();
  const allowed = new Set(shares.filter((s) => s.user_id === me && !s.deleted_at).map((s) => s.patient_id));
  const lost = (await db.patients.toArray())
    .filter((p) => p.owner_id && p.owner_id !== me && !allowed.has(p.id))
    .map((p) => p.id);
  if (lost.length === 0) return;
  const lostSet = new Set(lost);
  await db.transaction("rw", TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      if (t === "patients") await db.patients.bulkDelete(lost);
      else await db.table(t).filter((r: { patient_id?: string | null }) => !!r.patient_id && lostSet.has(r.patient_id)).delete();
    }
  });
}
