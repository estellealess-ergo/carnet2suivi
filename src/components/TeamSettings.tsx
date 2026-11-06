import { Mail, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { disconnectGmail, getMailAccount, startGmailConnect, type MailAccount } from "@/lib/comms";
import { fmtDateTime } from "@/lib/dates";
import { getOwner } from "@/lib/repo";
import { teamAction, useTeam } from "@/lib/team";
import { Button, Field, Input, Pill, toast } from "./ui";

const section = "rounded-lg border border-rule bg-sheet p-5";

export function GmailSettings() {
  const [account, setAccount] = useState<MailAccount>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getMailAccount().then(setAccount);
  }, []);
  return (
    <section className={section}>
      <h2 className="mb-2">Boîte Gmail</h2>
      <p className="mb-3 text-ink-soft">
        Seuls les e-mails échangés avec les adresses enregistrées dans les fiches (patients et familles) sont repris
        dans le dossier. Pour un autre e-mail, ajoute-lui le libellé « Carnet de suivi » dans Gmail : il arrivera dans
        « À rattacher ».
      </p>
      {account ? (
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone="done">Reliée : {account.email}</Pill>
          {account.last_sync_at && <span className="text-sm text-ink-soft">Relevée le {fmtDateTime(account.last_sync_at)}</span>}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await disconnectGmail();
                setAccount(null);
                toast("Boîte Gmail déliée");
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Délier
          </Button>
        </div>
      ) : (
        <Button
          onClick={() => startGmailConnect().catch((e: Error) => toast(e.message, "error"))}
        >
          <Mail className="size-4" /> Relier ma boîte Gmail
        </Button>
      )}
    </section>
  );
}

export function TeamSettings() {
  const { team, reload } = useTeam();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const me = getOwner();
  const isOwner = team.members.find((m) => m.user_id === me)?.role === "titulaire";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={section}>
      <h2 className="mb-2">Équipe du cabinet</h2>
      {!team.practice ? (
        <>
          <p className="mb-3 text-ink-soft">Crée le cabinet pour inviter une collègue et lui partager des dossiers.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nom du cabinet" className="min-w-60 flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du cabinet" />
            </Field>
            <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void run(() => teamAction("create_practice", { name }), "Cabinet créé")}>
              Créer le cabinet
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 font-semibold">{team.practice.name}</p>
          <ul className="mb-4 divide-y divide-rule">
            {team.members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="flex-1">
                  {m.display_name || m.email} <span className="text-sm text-ink-soft">{m.email}</span>
                </span>
                <Pill tone={m.role === "titulaire" ? "pen" : "neutral"}>{m.role === "titulaire" ? "Titulaire" : "Collègue"}</Pill>
                {isOwner && m.user_id !== me && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Retirer ${m.display_name || m.email} du cabinet ? Les dossiers partagés ne lui seront plus accessibles.`))
                        void run(() => teamAction("remove_member", { user_id: m.user_id }), "Collègue retirée");
                    }}
                  >
                    <UserMinus className="size-4" /> Retirer
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <div className="flex flex-wrap items-end gap-2 border-t border-rule pt-4">
              <Field label="Prénom et nom" className="min-w-48 flex-1">
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </Field>
              <Field label="E-mail" className="min-w-56 flex-1">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Button
                variant="primary"
                disabled={busy || !email.trim()}
                onClick={() =>
                  void run(async () => {
                    await teamAction("invite_member", { email, display_name: displayName });
                    setEmail("");
                    setDisplayName("");
                  }, "Invitation envoyée")
                }
              >
                <UserPlus className="size-4" /> Inviter
              </Button>
            </div>
          )}
          <p className="mt-3 text-sm text-ink-soft">
            Chaque dossier reste privé tant que tu ne le partages pas, depuis l'onglet Informations de la fiche patient.
          </p>
        </>
      )}
    </section>
  );
}
