import { Camera, Link2, Link2Off, Monitor, QrCode, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtDateTime } from "@/lib/dates";
import {
  cancelPairing,
  deviceLabel,
  endPhotoRequest,
  joinPairing,
  sendPhoto,
  startPairing,
  syncAgain,
  unpair,
  usePeerState,
  usePhotoRequest,
} from "@/lib/peer-sync";
import { shrinkPhoto } from "./NotePhotos";
import { Button, Field, Input, Modal, toast } from "./ui";

/** Paramètres : relier le téléphone et l'ordinateur. */
export function Devices() {
  const s = usePeerState();
  const [qr, setQr] = useState<{ code: string; img: string } | null>(null);
  const [scan, setScan] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const onPhone = deviceLabel() === "téléphone";

  // Le QR se ferme tout seul quand le téléphone est relié.
  useEffect(() => {
    if (qr && s.paired && s.status !== "pairing") {
      setQr(null);
      toast("Appareils reliés");
    }
  }, [qr, s.paired, s.status]);

  async function showQr() {
    try {
      const code = await startPairing();
      const QR = await import("qrcode");
      setQr({ code, img: await QR.toDataURL(code, { width: 280, margin: 1, errorCorrectionLevel: "M" }) });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const other = s.paired?.label === "téléphone" ? "ton téléphone" : "ton ordinateur";
  const statusText =
    s.status === "connected"
      ? `Relié à ${other} · tout est à jour`
      : s.status === "syncing"
        ? `Relié à ${other} · mise à jour en cours…`
        : `En attente de ${other} : ouvre l'application dessus`;

  return (
    <section id="appareils" className="rounded-lg border border-rule bg-sheet p-5">
      <h2 className="mb-2">Téléphone et ordinateur</h2>
      {!s.paired ? (
        <>
          <p className="mb-3 text-ink-soft">
            Relie ton téléphone et ton ordinateur : dès que l'application est ouverte sur les deux, ils se mettent à jour
            l'un l'autre, et tu peux prendre des photos avec le téléphone pour la note ouverte sur l'ordinateur. Les
            dossiers passent directement d'un appareil à l'autre, chiffrés, sans être gardés sur internet.
          </p>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-ink-soft">
            <li>Sur l'ordinateur : « Afficher le code ».</li>
            <li>Sur le téléphone : Paramètres, puis « Scanner le code », et vise l'écran.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant={onPhone ? "ghost" : "primary"} onClick={() => void showQr()}>
              <QrCode className="size-4" /> Afficher le code
            </Button>
            <Button variant={onPhone ? "primary" : "ghost"} onClick={() => setScan(true)}>
              <Camera className="size-4" /> Scanner le code
            </Button>
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            Si tes dossiers sont déjà sur l'ordinateur, ils arrivent sur le téléphone à la première liaison (la première
            fois peut prendre une minute avec beaucoup de photos).
          </p>
        </>
      ) : (
        <>
          <p className="flex items-center gap-2 font-semibold">
            {s.paired.label === "téléphone" ? <Smartphone className="size-5 text-pen" /> : <Monitor className="size-5 text-pen" />}
            {statusText}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {s.lastSync ? `Dernière mise à jour le ${fmtDateTime(s.lastSync)}. ` : ""}
            Fonctionne le mieux quand les deux appareils sont sur le même Wi-Fi.
          </p>
          <p className={`mt-2 flex items-start gap-2 text-sm ${s.pending ? "text-ink" : "text-ink-soft"}`}>
            <ShieldCheck className={`mt-0.5 size-4 shrink-0 ${s.pending ? "text-pen" : "text-done"}`} aria-hidden />
            {s.pending
              ? `${s.pending} modification${s.pending > 1 ? "s" : ""} pas encore reçue${s.pending > 1 ? "s" : ""} par ${other} : une copie de sécurité est gardée sur cet appareil, même sans internet. Elle s'efface toute seule dès que ${other} les a reçues.`
              : `Tout a été transmis à ${other} : aucune copie en attente.`}
          </p>
          {s.error && <p className="mt-1 text-sm text-late">{s.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void syncAgain()}>
              <RefreshCw className="size-4" /> Mettre à jour maintenant
            </Button>
            <Button variant="ghost" onClick={() => setUnlinking(true)}>
              <Link2Off className="size-4" /> Délier
            </Button>
          </div>
        </>
      )}

      <Modal
        open={qr !== null}
        onClose={() => {
          cancelPairing();
          setQr(null);
        }}
        title="Scanne ce code avec ton téléphone"
      >
        {qr && (
          <div className="flex flex-col items-center gap-3 text-center">
            <img src={qr.img} alt="Code de liaison" className="size-64 rounded-md border border-rule" />
            <p className="text-ink-soft">
              Sur le téléphone : ouvre l'application, Paramètres, « Scanner le code ». Garde cette fenêtre ouverte.
            </p>
            <p className="flex items-center gap-2 text-sm text-pen">
              <Link2 className="size-4 animate-pulse" /> En attente du téléphone…
            </p>
            <details className="text-sm text-ink-soft">
              <summary className="cursor-pointer">L'appareil photo ne lit pas le code ?</summary>
              <p className="mt-2">Copie ce code et colle-le sur le téléphone (par exemple en te l'envoyant) :</p>
              <code className="mt-1 block break-all rounded bg-paper p-2 text-xs">{qr.code}</code>
            </details>
          </div>
        )}
      </Modal>

      <ScanDialog open={scan} onClose={() => setScan(false)} />

      <Modal open={unlinking} onClose={() => setUnlinking(false)} title="Délier les appareils ?">
        <p className="text-ink-soft">
          Les dossiers restent sur chaque appareil, mais ils ne se mettront plus à jour l'un l'autre. Tu pourras les
          relier à nouveau avec le code.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setUnlinking(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await unpair();
              setUnlinking(false);
              toast("Appareils déliés");
            }}
          >
            Délier
          </Button>
        </div>
      </Modal>
    </section>
  );
}

/** Lecture du QR code avec l'appareil photo (ou code collé). */
function ScanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const doneRef = useRef(false);

  async function join(c: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    setBusy(true);
    try {
      await joinPairing(c);
      toast("Appareils reliés : mise à jour en cours");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
      doneRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    doneRef.current = false;
    setCamError(null);
    let stream: MediaStream | null = null;
    let stop = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const { default: jsQR } = await import("jsqr");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = () => {
          if (stop || doneRef.current) return;
          if (v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const r = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (r?.data.startsWith("C2S1.")) return void join(r.data);
          }
          setTimeout(tick, 250);
        };
        tick();
      } catch {
        setCamError("L'appareil photo n'est pas accessible. Autorise-le, ou colle le code ci-dessous.");
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Scanner le code affiché sur l'ordinateur">
      <div className="space-y-3">
        {!camError ? (
          <video ref={video} muted playsInline className="aspect-square w-full rounded-md bg-ink object-cover" />
        ) : (
          <p className="text-late">{camError}</p>
        )}
        {busy && <p className="text-pen">Liaison en cours…</p>}
        <Field label="Ou colle le code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="C2S1.…" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!code.trim() || busy} onClick={() => void join(code)}>
            Relier
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Indicateur dans la barre de gauche (seulement quand les appareils sont reliés). */
export function PeerIndicator() {
  const s = usePeerState();
  if (!s.paired) return null;
  const on = s.status === "connected" || s.status === "syncing";
  const Icon = s.paired.label === "téléphone" ? Smartphone : Monitor;
  const text = on
    ? s.paired.label === "téléphone" ? "Téléphone relié" : "Ordinateur relié"
    : s.pending
      ? `${s.pending} modif. en attente (copie gardée)`
      : "En attente de l'autre appareil";
  return (
    <a
      href={`${import.meta.env.BASE_URL}parametres#appareils`}
      title={`${text}${s.lastSync ? ` — mis à jour le ${fmtDateTime(s.lastSync)}` : ""}`}
      className={`mx-2 flex items-center justify-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-pen-soft lg:mx-3 lg:justify-start ${on ? "text-done" : "text-ink-soft"}`}
    >
      <span className="relative">
        <Icon className="size-5" aria-hidden />
        <span className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ${on ? "bg-done" : "bg-rule"}`} />
      </span>
      <span className="sr-only lg:not-sr-only">{text}</span>
    </a>
  );
}

/** Côté téléphone : l'ordinateur demande des photos pour la note ouverte. */
export function PhonePhotoPrompt() {
  const req = usePhotoRequest();
  const input = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSent(0), [req?.req]);
  if (!req) return null;
  return (
    <Modal open onClose={endPhotoRequest} title="Photo pour l'ordinateur">
      <p className="mb-4 text-ink-soft">
        Les photos iront directement dans la note ouverte sur l'ordinateur : <strong>{req.label}</strong>.
      </p>
      <Button variant="primary" className="w-full justify-center py-4 text-lg" disabled={busy} onClick={() => input.current?.click()}>
        <Camera className="size-6" /> {busy ? "Envoi…" : sent ? "Prendre une autre photo" : "Prendre la photo"}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            await sendPhoto(req.req, await shrinkPhoto(f), f.name.replace(/\.[^.]+$/, "") + ".jpg");
            setSent((n) => n + 1);
          } catch (err) {
            toast((err as Error).message, "error");
          } finally {
            setBusy(false);
          }
        }}
      />
      {sent > 0 && <p className="mt-3 text-center text-done">{sent} photo{sent > 1 ? "s" : ""} envoyée{sent > 1 ? "s" : ""} ✓</p>}
      <div className="mt-4 flex justify-end">
        <Button onClick={endPhotoRequest}>Terminé</Button>
      </div>
    </Modal>
  );
}
