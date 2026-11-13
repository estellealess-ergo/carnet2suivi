import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtDay } from "@/lib/dates";
import { useNotes } from "@/lib/queries";
import { noteParts } from "@/lib/session-note";
import { cx } from "./ui";
import { NotePhotoStrip } from "./NotePhotos";

/**
 * En ouvrant une note : rappel de la dernière séance (Fait / Observé / À reprendre),
 * avec des flèches pour remonter aux séances précédentes.
 */
export function LastSessionRecap({ patientId, day, currentId, compact }: { patientId: string; day: string; currentId?: string; compact?: boolean }) {
  const notes = useNotes(patientId);
  const previous = useMemo(
    () => notes.filter((n) => n.kind === "seance" && n.id !== currentId && (!day || n.note_date <= day)),
    [notes, currentId, day],
  );
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(true);
  if (!previous.length) return null;
  const n = previous[Math.min(i, previous.length - 1)]!;
  const p = noteParts(n.content_html);
  const rows: [string, string, boolean][] = [
    ["Fait", p.fait, false],
    ["Observé", p.observe, false],
    ["À reprendre", p.reprendre, true],
  ];
  const structured = rows.some(([, v]) => v);
  return (
    <section className="mb-3 rounded-md border border-rule bg-sheet">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold" aria-expanded={open}>
          <History className="size-4 shrink-0 text-pen" aria-hidden />
          <span className="truncate">
            {i === 0 ? "Dernière séance" : "Séance"} du {fmtDay(n.note_date)}
          </span>
          <span className="shrink-0 font-normal text-ink-soft">{open ? "· masquer" : "· afficher"}</span>
        </button>
        <button
          type="button"
          aria-label="Séance précédente"
          disabled={i >= previous.length - 1}
          onClick={() => setI(i + 1)}
          className="rounded p-1 text-ink-soft hover:text-pen disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-xs tabular-nums text-ink-soft">
          {i + 1}/{previous.length}
        </span>
        <button type="button" aria-label="Séance suivante" disabled={i === 0} onClick={() => setI(i - 1)} className="rounded p-1 text-ink-soft hover:text-pen disabled:opacity-30">
          <ChevronRight className="size-4" />
        </button>
      </div>
      {open && (
        <div className={cx("border-t border-rule px-3 py-2 text-sm", compact ? "max-h-44 overflow-y-auto" : "max-h-72 overflow-y-auto")}>
          {structured ? (
            <dl className="space-y-1.5">
              {rows
                .filter(([, v]) => v)
                .map(([k, v, strong]) => (
                  <div key={k} className={cx(strong && "rounded bg-pen-soft px-2 py-1")}>
                    <dt className="inline font-semibold">{k} : </dt>
                    <dd className="inline">{v}</dd>
                  </div>
                ))}
              {p.autre && <p className="text-ink-soft">{p.autre}</p>}
            </dl>
          ) : (
            <p className="whitespace-pre-wrap">{p.autre}</p>
          )}
          <div className="-ml-12 -mr-4">
            <NotePhotoStrip noteId={n.id} />
          </div>
        </div>
      )}
    </section>
  );
}
