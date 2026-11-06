import { CalendarClock, ClipboardPaste, Copy, History, MessageCircleQuestion, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { askAssistant, assistantAvailable, copyForClaude, pasteFromClaude } from "@/lib/assistant";
import { useLocalAi } from "@/lib/local-ai";
import { fmtDateTime, fmtDay, localDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { htmlToText, isEmptyHtml, textToHtml } from "@/lib/html";
import { fullName } from "@/lib/labels";
import { useForecasts, useGoals, useNoteVersions } from "@/lib/queries";
import { create, update } from "@/lib/repo";
import type { Forecast, Note, NoteKind, Patient } from "@/lib/types";
import { RichEditor } from "./RichEditor";
import { DebriefDialog, QuickCapture } from "./SessionTools";
import { buildNoteHtml, jotsToRaw, rawToJots } from "@/lib/session-note";
import { Button, Field, Input, Modal, cx, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

/**
 * Saisie d'une note (observation de séance ou note générale).
 * - enregistrée d'abord sur l'appareil (fonctionne hors ligne) ;
 * - brouillon de secours enregistré automatiquement toutes les 3 secondes ;
 * - bouton Enregistrer toujours visible, même avec un long texte sur téléphone ;
 * - les prévisions du patient peuvent être reprises dans la note.
 */
export function NoteEditor({
  patient,
  note,
  kind = "seance",
  onDone,
  compact,
  closeRef,
  defaultDate,
}: {
  patient: Patient;
  note?: Note | null;
  kind?: NoteKind;
  onDone: () => void;
  compact?: boolean;
  /** Date proposée pour une nouvelle note de séance (ex. la journée affichée). Aujourd'hui sinon. */
  defaultDate?: string;
  /** Permet au conteneur (fenêtre, onglet) de demander la fermeture en passant par le garde. */
  closeRef?: MutableRefObject<(() => void) | null>;
}) {
  const draftKey = `note:${note?.id ?? `new:${kind}:${patient.id}`}`;
  const initialHtml = note?.content_html ?? "";
  // Les observations de séance sont datées du jour par défaut ; la date reste modifiable.
  const initialDate = note?.note_date ?? (kind === "seance" ? (defaultDate ?? localDay()) : "");

  const [html, setHtml] = useState(initialHtml);
  const [day, setDay] = useState(initialDate);
  const initialJots = useMemo(() => rawToJots(note?.raw_text), [note?.raw_text]);
  const [jots, setJots] = useState<string[]>(initialJots);
  /** Texte avant la mise au propre (pour revenir en arrière, non conservé). */
  const [beforeCleanup, setBeforeCleanup] = useState<string | null>(null);
  const [debrief, setDebrief] = useState(false);
  const goals = useGoals(kind === "seance" ? patient.id : undefined).filter((g) => g.status === "en_cours" || note?.goal_ids?.includes(g.id));
  const initialGoalIds = useMemo(() => note?.goal_ids ?? [], [note?.goal_ids]);
  const [goalIds, setGoalIds] = useState<string[]>(initialGoalIds);
  const [transfers, setTransfers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ html: string; saved_at: string; note_date: string | null; jots?: string[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const savedRef = useRef(false);
  const releaseRef = useRef<(() => void) | null>(null);

  const dirty =
    html !== initialHtml ||
    day !== initialDate ||
    transfers.length > 0 ||
    jots.join("\n") !== initialJots.join("\n") ||
    goalIds.join() !== initialGoalIds.join();

  // Brouillon de secours : proposé à la réouverture s'il diffère de la note.
  useEffect(() => {
    void db.drafts.get(draftKey).then((d) => {
      if (d && ((d.html !== initialHtml && !isEmptyHtml(d.html)) || (d.jots?.length ?? 0) > initialJots.length)) setDraft(d);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, initialHtml]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      if (savedRef.current) return;
      void db.drafts.put({ key: draftKey, html, note_date: day || null, jots, saved_at: new Date().toISOString() });
    }, 3000);
    return () => clearTimeout(t);
  }, [html, day, jots, dirty, draftKey]);

  const forecasts = useForecasts(patient.id).filter((f) => f.status === "a_faire" && !transfers.includes(f.id));

  const save = useCallback(async (leaving = false): Promise<boolean> => {
    if (!day) {
      toast("Choisis la date de la note avant d'enregistrer.", "error");
      return false;
    }
    if (isEmptyHtml(html) && jots.length === 0) {
      toast("La note est vide.", "error");
      return false;
    }
    const raw = jotsToRaw(jots);
    // Des mots-clés sans note rédigée : ils deviennent le contenu, pour ne rien perdre.
    const content = isEmptyHtml(html) ? buildNoteHtml({ fait: "", observe: jots.join(" ; "), reprendre: "" }) : html;
    try {
      const saved = note
        ? (await update("notes", note.id, { content_html: content, note_date: day, raw_text: raw, goal_ids: goalIds }), note)
        : await create("notes", { patient_id: patient.id, kind, note_date: day, content_html: content, raw_text: raw, goal_ids: goalIds });
      for (const id of transfers) await update("forecasts", id, { status: "transferee", note_id: saved.id });
      savedRef.current = true;
      releaseRef.current?.();
      await db.drafts.delete(draftKey);
      toast("Note enregistrée");
      if (!leaving) onDone();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    }
  }, [day, html, jots, goalIds, note, patient.id, kind, transfers, draftKey, onDone]);

  const label = `${kind === "seance" ? "Note de séance" : "Note"} — ${fullName(patient)}`;
  const guard = useUnsavedGuard({ dirty, label, onSave: save });
  releaseRef.current = guard.release;
  if (closeRef) closeRef.current = () => guard.askBeforeClose(onDone);

  const sourceText = () =>
    [htmlToText(html), jots.length ? `Mots-clés de séance : ${jots.join(" ; ")}` : ""].filter(Boolean).join("\n\n");

  async function cleanUp() {
    const text = sourceText();
    if (!text) return;
    setBusy(true);
    try {
      const out = await askAssistant("note", text, patient);
      if (!out.trim()) throw new Error("L'assistant a renvoyé une réponse vide.");
      setBeforeCleanup(html);
      setHtml(textToHtml(out));
      toast("Note mise au propre. Relis-la avant d'enregistrer.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function takeForecast(f: Forecast) {
    setHtml((h) => `${h}<p><strong>Prévu :</strong> ${escapeHtml(f.content)}</p>`);
    setTransfers((t) => [...t, f.id]);
  }

  useLocalAi(); // se remet à jour quand l'assistant de l'ordinateur devient disponible
  const canAssist = assistantAvailable();
  const empty = isEmptyHtml(html) && jots.length === 0;

  return (
    <div className={cx("flex flex-col", compact ? "h-full" : "")}>
      {draft && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-pen-soft p-3 text-sm">
          <span className="flex-1">
            Un brouillon non enregistré du {fmtDateTime(draft.saved_at)} a été retrouvé.
          </span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setHtml(draft.html);
              if (draft.note_date) setDay(draft.note_date);
              if (draft.jots) setJots(draft.jots);
              setDraft(null);
            }}
          >
            Reprendre le brouillon
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void db.drafts.delete(draftKey);
              setDraft(null);
            }}
          >
            Supprimer
          </Button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Date" className="w-44">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </Field>
        {canAssist && (
          <Button
            onClick={cleanUp}
            disabled={busy || empty}
            title="Corrige et range la note en trois rubriques : Fait, Observé, À reprendre"
          >
            <Sparkles className="size-4" />
            {busy ? "Mise au propre…" : "Mettre au propre"}
          </Button>
        )}
        {!canAssist && (
          <>
            <Button
              variant="ghost"
              disabled={empty}
              title="Copie la note (nom du patient masqué) avec les consignes, à coller dans Claude"
              onClick={async () => {
                await copyForClaude("note", sourceText(), patient);
                toast("Copié. Colle-le dans Claude, puis copie sa réponse et clique sur « Coller la réponse ».");
              }}
            >
              <Copy className="size-4" /> Copier pour Claude
            </Button>
            <Button
              variant="ghost"
              disabled={empty}
              onClick={async () => {
                try {
                  const out = await pasteFromClaude(patient);
                  setBeforeCleanup(html);
                  setHtml(textToHtml(out));
                  toast("Réponse reprise dans la note. Relis-la avant d'enregistrer.");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              <ClipboardPaste className="size-4" /> Coller la réponse
            </Button>
          </>
        )}
        {beforeCleanup !== null && (
          <Button
            variant="ghost"
            onClick={() => {
              setHtml(beforeCleanup);
              setBeforeCleanup(null);
            }}
            title="Revenir au texte avant la mise au propre"
          >
            <Undo2 className="size-4" /> Texte d'origine
          </Button>
        )}
        {note && (
          <Button variant="ghost" onClick={() => setShowHistory(true)}>
            <History className="size-4" /> Versions
          </Button>
        )}
      </div>

      {forecasts.length > 0 && (
        <div className="mb-3 rounded-md border border-rule bg-sheet p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="size-4 text-pen" /> Prévu pour ce patient
          </div>
          <ul className="space-y-1.5">
            {forecasts.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-sm">
                <span className="flex-1">
                  {f.content}
                  <span className="ml-1 text-ink-soft">({fmtDay(f.planned_date)})</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => takeForecast(f)}>
                  Reprendre dans la note
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {kind === "seance" && (
        <div className="mb-3 space-y-3">
          <QuickCapture jots={jots} onChange={setJots} />
          {goals.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-semibold">Objectifs travaillés</p>
              <div className="flex flex-wrap gap-1.5">
                {goals.map((g) => {
                  const on = goalIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGoalIds((ids) => (on ? ids.filter((x) => x !== g.id) : [...ids, g.id]))}
                      className={cx(
                        "rounded-full border px-3 py-1 text-left text-sm",
                        on ? "border-pen bg-pen-soft font-semibold text-pen" : "border-rule text-ink-soft hover:border-pen",
                      )}
                    >
                      {g.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Button variant="primary" onClick={() => setDebrief(true)}>
            <MessageCircleQuestion className="size-4" /> Débrief de la séance
          </Button>
        </div>
      )}

      <div className={cx(compact && "min-h-0 flex-1 overflow-y-auto")}>
        <RichEditor value={html} onChange={setHtml} autoFocus={!note} minHeight={compact ? "16rem" : "14rem"} placeholder={kind === "seance" ? "Fait, Observé, À reprendre… Utilise le débrief ou écris directement." : "Écrire ou dicter…"} />
      </div>

      {/* Barre collée en bas : reste visible même avec un texte très long sur téléphone. */}
      <div className="sticky bottom-0 z-10 -mx-1 mt-3 flex items-center justify-end gap-2 border-t border-rule bg-sheet/95 px-1 py-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {dirty && <span className="mr-auto text-sm text-ink-soft">Modifications non enregistrées</span>}
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Fermer
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>

      <DebriefDialog
        open={debrief}
        jots={jots}
        onClose={() => setDebrief(false)}
        onDone={(d) => {
          setHtml((h) => (isEmptyHtml(h) ? "" : h) + buildNoteHtml(d));
          setDebrief(false);
        }}
      />
      {guard.dialog}
      {note && (
        <VersionsDialog
          noteId={note.id}
          open={showHistory}
          onClose={() => setShowHistory(false)}
          onRestore={(h) => {
            setHtml(h);
            setShowHistory(false);
            toast("Version reprise dans l'éditeur. Enregistre pour la conserver.");
          }}
        />
      )}
    </div>
  );
}

function VersionsDialog({
  noteId,
  open,
  onClose,
  onRestore,
}: {
  noteId: string;
  open: boolean;
  onClose: () => void;
  onRestore: (html: string) => void;
}) {
  const versions = useNoteVersions(open ? noteId : undefined);
  return (
    <Modal open={open} onClose={onClose} title="Versions précédentes" wide>
      {versions.length === 0 ? (
        <p className="text-ink-soft">Aucune version précédente : la note n'a pas encore été modifiée.</p>
      ) : (
        <ul className="space-y-3">
          {versions.map((v) => (
            <li key={v.id} className="rounded-md border border-rule p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm text-ink-soft">Enregistrée le {fmtDateTime(v.saved_at)}</span>
                <Button size="sm" onClick={() => onRestore(v.content_html)}>
                  Reprendre cette version
                </Button>
              </div>
              <div className="prose-note line-clamp-6 text-sm" dangerouslySetInnerHTML={{ __html: sanitize(v.content_html) }} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** N'autorise que les balises produites par l'éditeur (protection si une donnée est altérée). */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "SPAN"]);
  const walk = (el: Element) => {
    [...el.children].forEach((c) => {
      if (!allowed.has(c.tagName)) {
        c.replaceWith(doc.createTextNode(c.textContent ?? ""));
        return;
      }
      const color = (c as HTMLElement).style?.color;
      [...c.attributes].forEach((a) => c.removeAttribute(a.name));
      if (color && c.tagName === "SPAN") (c as HTMLElement).style.color = color;
      walk(c);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Note dans une fenêtre : la croix et Échap passent par « Enregistrer avant de fermer ? ». */
export function NoteModal({
  patient,
  note,
  kind = "seance",
  onDone,
  defaultDate,
}: {
  patient: Patient | null;
  note?: Note | null;
  kind?: NoteKind;
  onDone: () => void;
  defaultDate?: string;
}) {
  const closeRef = useRef<(() => void) | null>(null);
  const title = patient
    ? `${note ? "Modifier la note" : kind === "seance" ? "Note de séance" : "Note générale"} — ${fullName(patient)}`
    : "";
  return (
    <Modal open={patient !== null} onClose={() => closeRef.current?.()} title={title} wide>
      {patient && <NoteEditor patient={patient} note={note} kind={kind} onDone={onDone} closeRef={closeRef} defaultDate={defaultDate} />}
    </Modal>
  );
}
