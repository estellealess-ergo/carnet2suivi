import { useState } from "react";
import { teamAction } from "@/lib/team";
import { supabase } from "@/lib/supabase";
import { syncNow } from "@/lib/sync-controller";
import type { Guardian } from "@/lib/types";
import { Button, Pill, toast } from "./ui";

/** Accès d'un parent à l'espace famille (comptes rendus publiés uniquement). */
export function FamilyAccess({ guardian: g }: { guardian: Guardian }) {
  const [busy, setBusy] = useState(false);
  if (!supabase) return null;
  const run = async (action: "invite_family" | "revoke_family") => {
    setBusy(true);
    try {
      await teamAction(action, { guardian_id: g.id });
      await syncNow();
      toast(action === "invite_family" ? "Invitation envoyée par e-mail" : "Accès retiré");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {g.user_id ? (
        <>
          <Pill tone="done">Accès à l'espace famille</Pill>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("revoke_family")}>
            Retirer l'accès
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          disabled={busy || !g.email}
          title={g.email ? undefined : "Ajoute d'abord une adresse e-mail"}
          onClick={() => void run("invite_family")}
        >
          Inviter dans l'espace famille
        </Button>
      )}
    </div>
  );
}
