import { create, getOwner, remove } from "@/lib/repo";
import { useShares } from "@/lib/queries";
import { useTeam } from "@/lib/team";
import type { Patient } from "@/lib/types";
import { toast } from "./ui";

/** Partage du dossier avec des collègues du cabinet (seule la propriétaire peut le modifier). */
export function ShareSection({ patient }: { patient: Patient }) {
  const { team } = useTeam();
  const shares = useShares(patient.id);
  const me = getOwner();
  const colleagues = team.members.filter((m) => m.user_id !== me);
  if (!team.practice || colleagues.length === 0) return null;
  const mine = !patient.owner_id || patient.owner_id === me;
  const owner = team.members.find((m) => m.user_id === patient.owner_id);

  return (
    <section className="mt-6 rounded-lg border border-rule bg-sheet p-4">
      <h2 className="mb-2">Partage du dossier</h2>
      {!mine ? (
        <p className="text-ink-soft">Dossier partagé avec toi par {owner?.display_name || owner?.email || "une collègue"}.</p>
      ) : (
        colleagues.map((m) => {
          const share = shares.find((s) => s.user_id === m.user_id);
          return (
            <label key={m.user_id} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-pen)]"
                checked={!!share}
                onChange={async (e) => {
                  if (e.target.checked) {
                    await create("patient_shares", { patient_id: patient.id, user_id: m.user_id, patient_owner_id: me });
                    toast(`Dossier partagé avec ${m.display_name || m.email}`);
                  } else if (share) {
                    if (!window.confirm(`Ne plus partager ce dossier avec ${m.display_name || m.email} ?`)) return;
                    await remove("patient_shares", share.id);
                    toast("Partage retiré");
                  }
                }}
              />
              Partager avec {m.display_name || m.email}
            </label>
          );
        })
      )}
    </section>
  );
}
