import { LogOut } from "lucide-react";
import { Button, Empty } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fmtLongDay } from "@/lib/dates";
import { useFamilyReports, useGuardians } from "@/lib/queries";
import { useSyncState } from "@/lib/sync-controller";

/**
 * Espace famille : un parent y lit les comptes rendus que la praticienne a publiés
 * pour son enfant. Aucune autre donnée du dossier n'y est accessible.
 */
export function FamilySpace() {
  const { signOut } = useAuth();
  const reports = useFamilyReports().filter((r) => r.published);
  const me = useGuardians()[0];
  const sync = useSyncState();
  const children = [...new Set(reports.map((r) => r.patient_first_name))];
  const hello = me?.civility ? `Bonjour ${me.civility} ${me.last_name}` : `Bonjour${me?.first_name ? ` ${me.first_name}` : ""}`;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <header className="mb-8 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-pen">Espace famille</p>
          <h1 className="mt-1">{hello}</h1>
          <p className="mt-1 text-ink-soft">Voici les nouvelles du suivi en ergothérapie.</p>
        </div>
        <Button variant="ghost" onClick={() => void signOut(true)}>
          <LogOut className="size-4" /> Se déconnecter
        </Button>
      </header>
      {reports.length === 0 ? (
        <Empty>{sync.status === "syncing" ? "Chargement…" : "Aucun compte rendu pour le moment. Vous recevrez un e-mail lorsqu'un nouveau message sera disponible."}</Empty>
      ) : (
        children.map((child) => (
          <section key={child} className="mb-10">
            {children.length > 1 && <h2 className="mb-3">{child}</h2>}
            <ol className="space-y-4">
              {reports
                .filter((r) => r.patient_first_name === child)
                .map((r) => (
                  <li key={r.id} className="rounded-lg border border-rule bg-sheet p-5">
                    <p className="mb-2 font-bold first-letter:uppercase">{fmtLongDay(r.report_date)}</p>
                    <p className="whitespace-pre-wrap leading-relaxed">{r.content}</p>
                  </li>
                ))}
            </ol>
          </section>
        ))
      )}
    </main>
  );
}
