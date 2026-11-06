import { ArrowLeft, ArrowRight, Check, Plus, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "@/lib/db";
import { RUBRICS, keywordSuggestions, type Debrief } from "@/lib/session-note";
import { DictationTextarea } from "./DictationTextarea";
import { Button, Input, Modal, cx } from "./ui";

/**
 * Pendant la séance : quelques mots-clés en deux secondes (« puzzle 12/15 aide verbale »).
 * Les débuts de mots-clés déjà utilisés sont proposés en boutons.
 */
export function QuickCapture({ jots, onChange }: { jots: string[]; onChange: (j: string[]) => void }) {
  const [text, setText] = useState("");
  const suggestions =
    useLiveQuery(async () => keywordSuggestions((await db.notes.toArray()).map((n) => n.raw_text)), []) ?? [];
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...jots, t]);
    setText("");
  };

  return (
    <div className="rounded-md border border-rule bg-sheet p-3">
      <p className="mb-2 text-sm font-semibold">Pendant la séance : quelques mots-clés</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. puzzle 12/15 aide verbale" aria-label="Mot-clé" enterKeyHint="done" />
        <Button type="submit" disabled={!text.trim()} aria-label="Ajouter le mot-clé">
          <Plus className="size-4" />
        </Button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full border border-rule px-2.5 py-1 text-sm hover:border-pen hover:text-pen"
              onClick={() => setText(`${s} `)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {jots.length > 0 && (
        <ul className="mt-3 space-y-1">
          {jots.map((j, i) => (
            <li key={`${i}-${j}`} className="flex items-center gap-2 rounded bg-paper px-2 py-1">
              <span className="flex-1">{j}</span>
              <button
                type="button"
                className="text-ink-soft hover:text-late"
                aria-label={`Retirer « ${j} »`}
                onClick={() => onChange(jots.filter((_, k) => k !== i))}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Après la séance : trois questions courtes, une à une, à dicter.
 * Les mots-clés de la séance pré-remplissent « Observé ».
 */
export function DebriefDialog({
  open,
  jots,
  onClose,
  onDone,
}: {
  open: boolean;
  jots: string[];
  onClose: () => void;
  onDone: (d: Debrief) => void;
}) {
  const empty: Debrief = { fait: "", observe: "", reprendre: "" };
  const [answers, setAnswers] = useState<Debrief>(empty);
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);

  if (open && !started) {
    setStarted(true);
    setStep(0);
    setAnswers({ ...empty, observe: jots.join(" ; ") });
  }
  if (!open && started) setStarted(false);

  const r = RUBRICS[step]!;
  const last = step === RUBRICS.length - 1;

  return (
    <Modal open={open} onClose={onClose} title="Débrief de la séance">
      <ol className="mb-4 flex gap-2" aria-label="Étapes">
        {RUBRICS.map((x, i) => (
          <li
            key={x.key}
            className={cx("flex-1 rounded-full py-1 text-center text-xs font-semibold", i === step ? "bg-pen text-white" : i < step ? "bg-pen-soft text-pen" : "bg-paper text-ink-soft")}
          >
            {x.title}
          </li>
        ))}
      </ol>
      <p className="text-lg font-bold">{r.question}</p>
      <p className="mb-3 text-sm text-ink-soft">{r.hint} Quelques mots suffisent.</p>
      <DictationTextarea
        key={r.key}
        value={answers[r.key]}
        onValueChange={(v) => setAnswers((a) => ({ ...a, [r.key]: v }))}
        className="min-h-28"
        autoFocus
      />
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <ArrowLeft className="size-4" /> Précédent
        </Button>
        {last ? (
          <Button
            variant="primary"
            onClick={() => {
              onDone(answers);
            }}
          >
            <Check className="size-4" /> Ajouter à la note
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
            {answers[r.key].trim() ? "Suivant" : "Passer"} <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </Modal>
  );
}
