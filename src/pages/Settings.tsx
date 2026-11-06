import { Download, LogOut, RefreshCw, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { AssistantSettings } from "@/components/AssistantSettings";
import { BackupSection } from "@/components/BackupSection";
import { Devices } from "@/components/Devices";
import { ImportNotes } from "@/components/ImportNotes";
import { GmailSettings, TeamSettings } from "@/components/TeamSettings";
import { Button, Modal, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { getMeta, setMeta } from "@/lib/db";
import type { Rejected } from "@/lib/sync";
import { syncNow, useSyncState } from "@/lib/sync-controller";

type InstallEvent = Event & { prompt: () => Promise<void> };

export function Settings() {
  const { session, localOnly, signOut } = useAuth();
  const sync = useSyncState();
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [leaving, setLeaving] = useState(false);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

  // Lien direct vers une section (ex. #sauvegarde depuis le rappel).
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  const section = "rounded-lg border border-rule bg-sheet p-5";
  return (
    <>
      <PageHeader title="Paramètres" />
      <div className="space-y-5">
        <section className={section}>
          <h2 className="mb-2">Compte et synchronisation</h2>
          {localOnly ? (
            <div className="space-y-2">
              <p>
                <strong>Les dossiers sont enregistrés uniquement sur cet appareil.</strong> Rien n'est envoyé sur internet :
                aucun hébergeur n'est nécessaire.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                <li>Utilise toujours le même appareil et le même navigateur (Chrome ou Edge sur ordinateur).</li>
                <li>Installe l'application (ci-dessous) : les données sont mieux protégées contre l'effacement automatique.</li>
                <li>
                  N'efface jamais les « données de navigation » ou « cookies et données de sites » de ce navigateur : cela
                  supprimerait les dossiers.
                </li>
                <li>Fais une sauvegarde chaque semaine.</li>
                <li>Protège l'ordinateur par un mot de passe de session.</li>
              </ul>
            </div>
          ) : (
            <>
              <p>
                Connectée en tant que <strong>{session?.user.email}</strong>.
              </p>
              <p className="mt-1 text-ink-soft">
                {sync.pending > 0 ? `${sync.pending} modification(s) en attente d'envoi. ` : "Tout est envoyé. "}
                {sync.lastSyncAt ? `Dernière synchronisation le ${fmtDateTime(sync.lastSyncAt)}.` : ""}
              </p>
              {sync.error && <p className="mt-1 text-sm text-late">{sync.error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void syncNow()}>
                  <RefreshCw className="size-4" /> Synchroniser maintenant
                </Button>
                <Button variant="ghost" onClick={() => setLeaving(true)}>
                  <LogOut className="size-4" /> Se déconnecter
                </Button>
              </div>
            </>
          )}
        </section>

        {localOnly && <Devices />}

        {!localOnly && <RejectedChanges />}
        {!localOnly && <GmailSettings />}
        {!localOnly && <TeamSettings />}

        <section className={section}>
          <h2 className="mb-2">Installer l'application</h2>
          {standalone ? (
            <p className="text-ink-soft">L'application est installée sur cet appareil.</p>
          ) : installEvt ? (
            <Button variant="primary" onClick={() => void installEvt.prompt()}>
              <Smartphone className="size-4" /> Installer sur cet appareil
            </Button>
          ) : ios ? (
            <p className="text-ink-soft">
              Sur iPhone ou iPad : ouvre cette page dans Safari, touche le bouton Partager, puis « Sur l'écran d'accueil ».
            </p>
          ) : (
            <p className="text-ink-soft">
              Sur ordinateur : utilise l'icône d'installation dans la barre d'adresse de Chrome ou Edge. Sur Android :
              menu ⋮ puis « Installer l'application ».
            </p>
          )}
        </section>

        <ImportNotes />

        <AssistantSettings />
        <BackupSection />
      </div>

      <Modal open={leaving} onClose={() => setLeaving(false)} title="Se déconnecter">
        <p className="text-ink-soft">
          Sur un appareil partagé, efface les dossiers de cet appareil. Ils restent sur le serveur du cabinet.
        </p>
        {sync.pending > 0 && (
          <p className="mt-2 text-late">
            {sync.pending} modification(s) ne sont pas encore envoyées. Synchronise avant d'effacer cet appareil.
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setLeaving(false)}>
            Rester connectée
          </Button>
          <Button onClick={() => void signOut(false)}>Se déconnecter</Button>
          <Button variant="danger" disabled={sync.pending > 0} onClick={() => void signOut(true)}>
            Se déconnecter et effacer cet appareil
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Modifications que le serveur a refusées (ex. dossier dont le partage a été retiré). */
function RejectedChanges() {
  const [list, setList] = useState<Rejected[]>([]);
  useEffect(() => {
    void getMeta<Rejected[]>("rejected").then((l) => setList(l ?? []));
  }, []);
  if (list.length === 0) return null;
  return (
    <section className="rounded-lg border border-late/40 bg-late-soft/50 p-5">
      <h2 className="mb-2 text-late">{list.length} modification(s) refusée(s) par le serveur</h2>
      <p className="mb-3">
        Elles sont conservées sur cet appareil. Cela arrive quand un dossier n'est plus partagé avec toi. Télécharge-les
        pour les transmettre à la titulaire du dossier.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "modifications-refusees.json";
            a.click();
          }}
        >
          <Download className="size-4" /> Télécharger
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            if (!window.confirm("Effacer définitivement ces modifications de l'appareil ?")) return;
            await setMeta("rejected", []);
            setList([]);
          }}
        >
          Effacer
        </Button>
      </div>
    </section>
  );
}
