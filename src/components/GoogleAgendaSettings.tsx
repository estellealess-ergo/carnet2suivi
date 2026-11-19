import { CalendarCheck, CalendarX, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtDateTime } from "@/lib/dates";
import { connectGoogle, disconnectGoogle, refreshOrReconnect, saveClientId, useAgendaState } from "@/lib/google-agenda";
import { Button, Field, Input, Modal, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

/** Paramètres : relier Google Agenda en lecture seule. */
export function GoogleAgendaSettings() {
  const s = useAgendaState();
  const [id, setId] = useState(s.clientId ?? "");
  const [leaving, setLeaving] = useState(false);
  useEffect(() => setId(s.clientId ?? ""), [s.clientId]);
  const dirty = id.trim() !== (s.clientId ?? "");
  const saveId = async () => {
    if (id.trim() && !/\.apps\.googleusercontent\.com$/.test(id.trim())) {
      toast("Cet identifiant ne ressemble pas à un ID client Google (il finit par .apps.googleusercontent.com).", "error");
      return false;
    }
    await saveClientId(id);
    toast("Identifiant enregistré");
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "Identifiant Google", onSave: saveId });

  const run = (f: () => Promise<unknown>, ok: string) => () =>
    void f()
      .then(() => toast(ok))
      .catch((e) => toast((e as Error).message, "error"));

  return (
    <section id="agenda" className="rounded-lg border border-rule bg-sheet p-5">
      <h2 className="mb-2">Google Agenda</h2>
      <p className="mb-3 text-ink-soft">
        Affiche tes rendez-vous d'aujourd'hui et des deux jours suivants dans l'accueil, pour ouvrir la bonne note en un
        clic. <strong>Lecture seule</strong> : l'application ne modifie jamais ton agenda et n'y envoie rien. Elle ne lit
        que l'heure et le titre des rendez-vous, et en garde une copie sur cet appareil pour les consulter hors ligne.
      </p>

      <p className="mb-3 flex items-center gap-2 font-semibold">
        {s.linked ? <CalendarCheck className="size-5 text-done" aria-hidden /> : <CalendarX className="size-5 text-ink-soft" aria-hidden />}
        {s.linked
          ? `Connectée${s.email ? ` : ${s.email}` : ""}${s.active ? "" : " (accès à renouveler)"}`
          : "Non connectée"}
      </p>
      {s.linked && (
        <p className="-mt-2 mb-3 text-sm text-ink-soft">
          {s.lastFetch ? `Rendez-vous mis à jour le ${fmtDateTime(s.lastFetch)}.` : "Pas encore de rendez-vous lus."} Google donne un accès d'une heure :
          ensuite, « Actualiser » te redemande ton compte en un clic.
        </p>
      )}
      {s.error && <p className="mb-3 text-sm text-late">{s.error}</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        {!s.linked ? (
          <Button variant="primary" disabled={!s.clientId || s.loading} onClick={run(() => connectGoogle(true), "Google Agenda relié")}>
            <CalendarCheck className="size-4" /> Se connecter avec Google
          </Button>
        ) : (
          <>
            <Button disabled={s.loading} onClick={run(refreshOrReconnect, "Rendez-vous à jour")}>
              <RefreshCw className={`size-4 ${s.loading ? "animate-spin" : ""}`} /> {s.active ? "Actualiser" : "Reconnecter"}
            </Button>
            <Button variant="ghost" onClick={() => setLeaving(true)}>
              <LogOut className="size-4" /> Se déconnecter
            </Button>
          </>
        )}
      </div>

      <details open={!s.clientId} className="rounded-md border border-rule bg-paper p-3">
        <summary className="cursor-pointer font-semibold">Identifiant OAuth (à faire une seule fois)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          <li>
            Ouvre <strong>console.cloud.google.com</strong> avec le compte de ton agenda et crée un projet (ex. « Carnet de suivi »).
          </li>
          <li>« API et services » → « Bibliothèque » : active <strong>Google Calendar API</strong>.</li>
          <li>
            « Écran de consentement OAuth » : type <strong>Externe</strong>, nom de l'application, ton e-mail ; ajoute l'accès
            <code className="mx-1">calendar.events.readonly</code>; dans « Utilisateurs test », ajoute ton adresse.
          </li>
          <li>
            « Identifiants » → « Créer des identifiants » → « ID client OAuth », type <strong>Application Web</strong>. Dans « Origines
            JavaScript autorisées », ajoute <code>{window.location.origin}</code> (valable pour l'ordinateur et le téléphone).
          </li>
          <li>Copie l'« ID client » et colle-le ci-dessous.</li>
        </ol>
        <p className="mt-2 text-sm text-ink-soft">
          À la première connexion, Google affiche « Application non validée » : c'est normal pour une application à ton
          seul usage, clique sur « Continuer ».
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="ID client" className="min-w-0 flex-1">
            <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="1234…apps.googleusercontent.com" spellCheck={false} autoComplete="off" />
          </Field>
          <Button disabled={!dirty} onClick={() => void saveId()}>
            Enregistrer
          </Button>
        </div>
      </details>

      <Modal open={leaving} onClose={() => setLeaving(false)} title="Se déconnecter de Google Agenda ?">
        <p className="text-ink-soft">Les rendez-vous ne s'afficheront plus et leur copie sur cet appareil sera effacée. Ton agenda Google ne change pas.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setLeaving(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await disconnectGoogle();
              setLeaving(false);
              toast("Google Agenda déconnecté");
            }}
          >
            Se déconnecter
          </Button>
        </div>
      </Modal>
      {guard.dialog}
    </section>
  );
}
