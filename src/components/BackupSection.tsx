import { Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildBackup, daysSinceBackup, isEncrypted, restoreBackup } from "@/lib/backup";
import { localDay } from "@/lib/dates";
import { syncNow } from "@/lib/sync-controller";
import { Button, Field, Input, Modal, toast } from "./ui";

/**
 * Sauvegarde protégée par mot de passe. Sans serveur, c'est la seule copie de secours
 * des dossiers : à faire chaque semaine, sur une clé USB ou un disque personnel.
 */
export function BackupSection() {
  const [mode, setMode] = useState<null | "export" | "import">(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void daysSinceBackup().then(setDays);
  }, [mode]);

  const close = () => {
    setMode(null);
    setPassword("");
    setConfirm("");
    setPending(null);
  };

  async function doExport() {
    if (password.length < 8) return toast("Choisis un mot de passe d'au moins 8 caractères.", "error");
    if (password !== confirm) return toast("Les deux mots de passe ne sont pas identiques.", "error");
    setBusy(true);
    try {
      const blob = await buildBackup(password);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `carnet2suivi-sauvegarde-${localDay()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Sauvegarde téléchargée");
      close();
    } finally {
      setBusy(false);
    }
  }

  async function doImport(text: string, pwd: string | null) {
    setBusy(true);
    try {
      const n = await restoreBackup(text, pwd);
      toast(`${n} élément${n > 1 ? "s" : ""} restauré${n > 1 ? "s" : ""}`);
      void syncNow();
      close();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="sauvegarde" className="rounded-lg border border-rule bg-sheet p-5">
      <h2 className="mb-2">Sauvegarde</h2>
      <p className="mb-1 text-ink-soft">
        Un fichier contenant tous les dossiers de cet appareil, protégé par un mot de passe. Range-le sur une clé USB ou un
        disque personnel, pas dans un service en ligne (Google Drive, iCloud…).
      </p>
      <p className="mb-3 font-semibold">
        {days === null ? "Aucune sauvegarde faite pour l'instant." : days === 0 ? "Dernière sauvegarde : aujourd'hui." : `Dernière sauvegarde : il y a ${days} jour${days > 1 ? "s" : ""}.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setMode("export")}>
          <Download className="size-4" /> Faire une sauvegarde
        </Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> Restaurer une sauvegarde
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const text = await f.text();
            let encrypted = false;
            try {
              encrypted = isEncrypted(JSON.parse(text));
            } catch {
              return toast("Ce fichier n'est pas une sauvegarde du Carnet de suivi.", "error");
            }
            if (encrypted) {
              setPending(text);
              setMode("import");
            } else void doImport(text, null);
          }}
        />
      </div>

      <Modal open={mode === "export"} onClose={close} title="Faire une sauvegarde">
        <p className="mb-3 text-ink-soft">
          Choisis un mot de passe et note-le dans un endroit sûr : <strong>sans lui, la sauvegarde ne pourra pas être
          ouverte</strong>, et personne ne pourra le retrouver.
        </p>
        <div className="space-y-3">
          <Field label="Mot de passe" hint="8 caractères minimum. Une phrase de plusieurs mots est idéale.">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <Field label="Confirmer le mot de passe">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void doExport()}>
            {busy ? "Préparation…" : "Télécharger la sauvegarde"}
          </Button>
        </div>
      </Modal>

      <Modal open={mode === "import"} onClose={close} title="Restaurer une sauvegarde">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) void doImport(pending, password);
          }}
        >
          <Field label="Mot de passe de la sauvegarde">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <p className="mt-2 text-sm text-ink-soft">Les dossiers modifiés depuis la sauvegarde ne seront pas remplacés.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !password}>
              {busy ? "Restauration…" : "Restaurer"}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
