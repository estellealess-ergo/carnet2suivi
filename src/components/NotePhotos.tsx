import { Camera, ChevronLeft, ChevronRight, ImagePlus, Smartphone, X } from "lucide-react";
import { askPhonePhoto, usePeerState } from "@/lib/peer-sync";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/db";
import { newId, stamp } from "@/lib/repo";
import type { IsoDay, PatientDocument, PendingPhoto } from "@/lib/types";
import { Button, Modal, toast } from "./ui";

/** Taille maximale du plus grand côté : assez pour relire une écriture, léger pour la sauvegarde. */
const MAX_SIDE = 1600;

/** Réduit la photo (les photos de téléphone font souvent 3 à 6 Mo). Garde l'original si le format n'est pas lisible. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

export function usePhotosOfNote(noteId?: string | null) {
  return (
    useLiveQuery(
      async () =>
        noteId
          ? (await db.documents.where("note_id").equals(noteId).toArray())
              .filter((d) => !d.deleted_at)
              .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.title.localeCompare(b.title, "fr", { numeric: true }))
          : [],
      [noteId],
    ) ?? []
  );
}

/** Rattache les photos prises pendant la saisie à la note enregistrée (documents gardés sur l'appareil). */
export async function attachPhotos(photos: PendingPhoto[], patientId: string, noteId: string, day: IsoDay) {
  const at = stamp();
  for (const [i, p] of photos.entries()) {
    await db.documents.put({
      id: p.id,
      owner_id: null,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      patient_id: patientId,
      note_id: noteId,
      title: `Photo de séance du ${day.split("-").reverse().join("/")}${photos.length > 1 ? ` (${i + 1})` : ""}`,
      category: "photo",
      doc_date: day,
      file_name: p.name,
      mime: p.blob.type || "image/jpeg",
      size: p.blob.size,
      blob: p.blob,
    });
  }
}

type Shown = { id: string; blob: Blob; title: string };

/** Vignettes cliquables, agrandies dans une fenêtre. */
function Thumbs({ items, onRemove }: { items: Shown[]; onRemove?: (id: string) => void }) {
  const urls = useMemo(() => items.map((i) => URL.createObjectURL(i.blob)), [items]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return null;
  const cur = open !== null ? items[open] : null;
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <li key={it.id} className="relative">
            <button type="button" onClick={() => setOpen(i)} className="block overflow-hidden rounded-md border border-rule">
              <img src={urls[i]} alt={it.title} className="size-20 object-cover sm:size-24" />
            </button>
            {onRemove && (
              <button
                type="button"
                aria-label="Retirer la photo"
                onClick={() => onRemove(it.id)}
                className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-rule bg-sheet text-ink-soft shadow hover:text-late"
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Modal open={cur !== null} onClose={() => setOpen(null)} title={cur?.title ?? ""} wide>
        {cur && open !== null && (
          <div className="flex flex-col items-center gap-3">
            <img src={urls[open]} alt={cur.title} className="max-h-[70vh] w-auto rounded-md" />
            {items.length > 1 && (
              <div className="flex items-center gap-3">
                <Button size="sm" variant="ghost" aria-label="Photo précédente" onClick={() => setOpen((open + items.length - 1) % items.length)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-sm text-ink-soft">
                  {open + 1} / {items.length}
                </span>
                <Button size="sm" variant="ghost" aria-label="Photo suivante" onClick={() => setOpen((open + 1) % items.length)}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

/** Photos d'une note enregistrée, en lecture (liste des notes, notes côte à côte). */
export function NotePhotoStrip({ noteId }: { noteId: string }) {
  const photos = usePhotosOfNote(noteId);
  const items = useMemo(() => photos.map((d) => ({ id: d.id, blob: d.blob, title: d.title })), [photos]);
  if (!items.length) return null;
  return (
    <div className="pb-3 pl-12 pr-4">
      <Thumbs items={items} />
    </div>
  );
}

/** Dans l'éditeur : prendre une photo, en ajouter depuis la galerie, voir et retirer. */
export function NotePhotoPicker({
  noteId,
  pending,
  onAdd,
  onRemovePending,
  label,
}: {
  noteId?: string | null;
  /** Ce que le téléphone affiche pendant la prise de vue (ex. « Note de séance — Léo D. »). */
  label: string;
  pending: PendingPhoto[];
  onAdd: (p: PendingPhoto[]) => void;
  onRemovePending: (id: string) => void;
}) {
  const saved = usePhotosOfNote(noteId);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const peer = usePeerState();
  const phoneReady = peer.paired?.label === "téléphone" && (peer.status === "connected" || peer.status === "syncing");
  const stopPhone = useRef<(() => void) | null>(null);
  const [waitingPhone, setWaitingPhone] = useState(false);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  useEffect(() => () => stopPhone.current?.(), []);

  async function fromPhone() {
    try {
      stopPhone.current = await askPhonePhoto(
        label,
        (blob, name) => onAddRef.current([{ id: newId(), name, blob }]),
        () => {
          stopPhone.current = null;
          setWaitingPhone(false);
        },
      );
      setWaitingPhone(true);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const items = useMemo<(Shown & { saved?: PatientDocument })[]>(
    () => [
      ...saved.map((d) => ({ id: d.id, blob: d.blob, title: d.title, saved: d })),
      ...pending.map((p) => ({ id: p.id, blob: p.blob, title: "Photo (pas encore enregistrée)" })),
    ],
    [saved, pending],
  );

  async function add(files: FileList | null) {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    if (!list.length) return;
    setBusy(true);
    const out: PendingPhoto[] = [];
    for (const f of list) out.push({ id: newId(), name: f.name.replace(/\.[^.]+$/, "") + ".jpg", blob: await shrinkPhoto(f) });
    setBusy(false);
    onAdd(out);
  }

  const input = (ref: typeof camera, cam: boolean) => (
    <input
      ref={ref}
      type="file"
      hidden
      accept="image/*"
      multiple={!cam}
      {...(cam ? { capture: "environment" as const } : {})}
      onChange={(e) => {
        const f = e.target.files;
        void add(f).finally(() => (e.target.value = ""));
      }}
    />
  );

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => camera.current?.click()} disabled={busy}>
          <Camera className="size-4" /> Prendre une photo
        </Button>
        <Button variant="ghost" onClick={() => gallery.current?.click()} disabled={busy}>
          <ImagePlus className="size-4" /> Ajouter des images
        </Button>
        {phoneReady && !waitingPhone && (
          <Button variant="ghost" onClick={() => void fromPhone()}>
            <Smartphone className="size-4" /> Prendre avec le téléphone
          </Button>
        )}
        {waitingPhone && (
          <span className="flex items-center gap-2 rounded-md bg-pen-soft px-3 py-1.5 text-sm text-pen">
            <Smartphone className="size-4 animate-pulse" /> Prends la photo sur ton téléphone…
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                stopPhone.current?.();
                stopPhone.current = null;
                setWaitingPhone(false);
              }}
            >
              Arrêter
            </button>
          </span>
        )}
        {busy && <span className="self-center text-sm text-ink-soft">Préparation…</span>}
        {input(camera, true)}
        {input(gallery, false)}
      </div>
      <Thumbs
        items={items}
        onRemove={async (id) => {
          const doc = items.find((i) => i.id === id)?.saved;
          if (!doc) return onRemovePending(id);
          if (!window.confirm("Retirer cette photo de la note ?")) return;
          await db.documents.update(doc.id, { deleted_at: stamp(), updated_at: stamp() });
          toast("Photo retirée");
        }}
      />
    </div>
  );
}
