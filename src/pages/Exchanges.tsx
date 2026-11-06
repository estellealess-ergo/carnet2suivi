import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AssignPatient, CommCard } from "@/components/Comms";
import { Button, Empty, PageHeader, toast } from "@/components/ui";
import { getMailAccount, syncGmail, type MailAccount } from "@/lib/comms";
import { fmtDateTime } from "@/lib/dates";
import { fullName } from "@/lib/labels";
import { supabase } from "@/lib/supabase";
import { useCommunications, usePatients } from "@/lib/queries";

/** Tous les échanges à traiter, et ceux qui ne sont rattachés à aucun patient. */
export function Exchanges() {
  const comms = useCommunications();
  const patients = usePatients();
  const byId = new Map(patients.map((p) => [p.id, p]));
  const [account, setAccount] = useState<MailAccount>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getMailAccount().then(setAccount);
  }, []);

  const unassigned = comms.filter((c) => !c.patient_id);
  const todo = comms.filter((c) => c.patient_id && byId.has(c.patient_id) && c.status === "a_traiter");

  return (
    <>
      <PageHeader
        title="Échanges"
        subtitle={account ? `Boîte reliée : ${account.email}${account.last_sync_at ? `, relevée le ${fmtDateTime(account.last_sync_at)}` : ""}` : undefined}
        actions={
          account ? (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const n = await syncGmail();
                  toast(n ? `${n} nouvel${n > 1 ? "s" : ""} e-mail${n > 1 ? "s" : ""}` : "Aucun nouvel e-mail");
                  setAccount(await getMailAccount());
                } catch (e) {
                  toast((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} /> Relever les e-mails
            </Button>
          ) : !supabase ? null : (
            <Link to="/parametres" className="font-semibold text-pen hover:underline">
              Relier Gmail
            </Link>
          )
        }
      />

      {unassigned.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3">À rattacher à un patient</h2>
          <ol className="space-y-3">
            {unassigned.map((c) => (
              <CommCard key={c.id} c={c} assign={<AssignPatient c={c} />} />
            ))}
          </ol>
        </section>
      )}

      <section>
        <h2 className="mb-3">À traiter</h2>
        {todo.length === 0 ? (
          <Empty>Aucun échange en attente.</Empty>
        ) : (
          <ol className="space-y-3">
            {todo.map((c) => (
              <CommCard key={c.id} c={c} patientName={fullName(byId.get(c.patient_id!))} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
