import { CheckCircle2, Circle, Mail, MessageSquare, Phone, PhoneCall, Sparkles, Trash2, Voicemail } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { askAssistant, assistantAvailable } from "@/lib/assistant";
import { getMailAccount, sendEmail, type MailAccount } from "@/lib/comms";
import { fmtDateTime } from "@/lib/dates";
import { fullName } from "@/lib/labels";
import { useCommunications, useGuardians, usePatients } from "@/lib/queries";
import { create, remove, update } from "@/lib/repo";
import type { Channel, Communication, Patient } from "@/lib/types";
import { DictationTextarea } from "./DictationTextarea";
import { Button, Empty, Field, Input, Modal, Select, cx, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "E-mail",
  appel: "Appel",
  vocal: "Message vocal",
  sms: "SMS",
  whatsapp: "WhatsApp",
  autre: "Autre",
};

const ICON: Record<Channel, typeof Mail> = {
  email: Mail,
  appel: Phone,
  vocal: Voicemail,
  sms: MessageSquare,
  whatsapp: MessageSquare,
  autre: MessageSquare,
};

/** Un échange dans le journal. */
export function CommCard({
  c,
  patientName,
  assign,
}: {
  c: Communication;
  patientName?: string | null;
  assign?: ReactNode;
}) {
  const Icon = ICON[c.channel];
  const done = c.status === "traite";
  return (
    <li className="rounded-lg border border-rule bg-sheet p-4">
      <div className="flex flex-wrap items-start gap-2">
        <Icon className="mt-0.5 size-5 shrink-0 text-pen" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {CHANNEL_LABEL[c.channel]} {c.direction === "entrant" ? "reçu" : "envoyé"}
            {c.counterpart && <span className="font-normal"> {c.direction === "entrant" ? "de" : "à"} {c.counterpart}</span>}
          </p>
          <p className="text-sm text-ink-soft">
            {fmtDateTime(c.occurred_at)}
            {patientName && <> · {patientName}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void update("communications", c.id, { status: done ? "a_traiter" : "traite" })}
          className={cx("inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold", done ? "text-done" : "text-late hover:bg-late-soft")}
          title={done ? "Remettre à traiter" : "Marquer comme traité"}
        >
          {done ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
          {done ? "Traité" : "À traiter"}
        </button>
      </div>
      {c.subject && <p className="mt-2 font-semibold">{c.subject}</p>}
      {c.summary && (
        <div className="mt-2 rounded-md bg-pen-soft p-2 text-sm">
          <strong>Informations clés</strong>
          <p className="whitespace-pre-wrap">{c.summary}</p>
        </div>
      )}
      {c.body && <p className="mt-2 line-clamp-6 whitespace-pre-wrap">{c.body}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {assign}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-label="Supprimer l'échange"
          onClick={async () => {
            if (!window.confirm("Supprimer cet échange du journal ?")) return;
            await remove("communications", c.id);
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

/** Sélecteur pour rattacher un échange à un patient. */
export function AssignPatient({ c }: { c: Communication }) {
  const patients = usePatients();
  return (
    <Select
      value={c.patient_id ?? ""}
      onChange={(e) => void update("communications", c.id, { patient_id: e.target.value || null })}
      className="h-8 w-56 text-sm"
      aria-label="Rattacher à un patient"
    >
      <option value="">Rattacher à un patient…</option>
      {patients.map((p) => (
        <option key={p.id} value={p.id}>
          {fullName(p)}
        </option>
      ))}
    </Select>
  );
}

/** Onglet « Échanges » de la fiche patient. */
export function CommsTab({ patient }: { patient: Patient }) {
  const comms = useCommunications(patient.id);
  const [mode, setMode] = useState<null | "note" | "email">(null);
  const [account, setAccount] = useState<MailAccount>(null);

  useEffect(() => {
    void getMailAccount().then(setAccount);
  }, []);


  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setMode("note")}>
          <PhoneCall className="size-4" /> Noter un échange
        </Button>
        {account && (
          <Button onClick={() => setMode("email")}>
            <Mail className="size-4" /> Écrire un e-mail
          </Button>
        )}
      </div>

      {comms.length === 0 ? (
        <Empty>Aucun échange avec ce patient ou sa famille pour l'instant.</Empty>
      ) : (
        <ol className="space-y-3">
          {comms.map((c) => (
            <CommCard key={c.id} c={c} />
          ))}
        </ol>
      )}

      <Modal open={mode === "note"} onClose={() => setMode(null)} title="Noter un échange">
        {mode === "note" && <ManualComm patient={patient} onDone={() => setMode(null)} />}
      </Modal>
      <Modal open={mode === "email"} onClose={() => setMode(null)} title="Écrire un e-mail" wide>
        {mode === "email" && <EmailComposer patient={patient} onDone={() => setMode(null)} />}
      </Modal>
    </>
  );
}

function ManualComm({ patient, onDone }: { patient: Patient; onDone: () => void }) {
  const [channel, setChannel] = useState<Channel>("appel");
  const [direction, setDirection] = useState<"entrant" | "sortant">("entrant");
  const [when, setWhen] = useState("");
  const [counterpart, setCounterpart] = useState("");
  const [body, setBody] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const save = async () => {
    if (!when) {
      toast("Indique la date et l'heure de l'échange.", "error");
      return false;
    }
    if (!body.trim()) {
      toast("Écris ce qui a été dit.", "error");
      return false;
    }
    await create("communications", {
      patient_id: patient.id,
      channel,
      direction,
      occurred_at: new Date(when).toISOString(),
      counterpart: counterpart.trim() || null,
      subject: null,
      body: body.trim(),
      summary: null,
      status: "traite",
      external_id: null,
      thread_id: null,
    });
    toast("Échange noté");
    onDone();
    return true;
  };
  const guard = useUnsavedGuard({ dirty: body.trim() !== "", label: "Échange", onSave: save });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {Object.entries(CHANNEL_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sens">
          <Select value={direction} onChange={(e) => setDirection(e.target.value as "entrant" | "sortant")}>
            <option value="entrant">Reçu</option>
            <option value="sortant">Émis</option>
          </Select>
        </Field>
        <Field label="Date et heure">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Avec qui">
          <Input value={counterpart} onChange={(e) => setCounterpart(e.target.value)} placeholder="Ex. la maman, l'enseignante" />
        </Field>
      </div>
      <Field label="Ce qui a été dit" hint="Tu peux dicter. Rien n'est enregistré : seul le texte est gardé.">
        <DictationTextarea value={body} onValueChange={setBody} className="min-h-28" />
      </Field>
      {assistantAvailable() && (
        <Button
          size="sm"
          disabled={cleaning || !body.trim()}
          onClick={async () => {
            setCleaning(true);
            try {
              setBody(await askAssistant("echange", body, patient));
            } catch (e) {
              toast((e as Error).message, "error");
            } finally {
              setCleaning(false);
            }
          }}
        >
          <Sparkles className="size-4" /> {cleaning ? "Mise au propre…" : "Garder les informations clés"}
        </Button>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Annuler
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Enregistrer l'échange
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}


export function EmailComposer({
  patient,
  onDone,
  initialTo,
  initialSubject = "",
  initialText = "",
}: {
  patient: Patient;
  onDone: () => void;
  initialTo?: string[];
  initialSubject?: string;
  initialText?: string;
}) {
  const guardians = useGuardians(patient.id).filter((g) => g.email);
  const options = [
    ...guardians.map((g) => ({ email: g.email!, label: `${fullName(g)}${g.relation ? ` (${g.relation})` : ""}` })),
    ...(patient.email ? [{ email: patient.email, label: fullName(patient) }] : []),
  ];
  const [to, setTo] = useState<string[]>(initialTo ?? []);
  const [subject, setSubject] = useState(initialSubject);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (to.length === 0 || !text.trim()) {
      toast("Choisis au moins un destinataire et écris le message.", "error");
      return false;
    }
    setBusy(true);
    try {
      await sendEmail({ to, subject, text, patientId: patient.id });
      toast("E-mail envoyé");
      onDone();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const guard = useUnsavedGuard({ dirty: text.trim() !== initialText.trim(), label: "E-mail", onSave: send });

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Destinataires</legend>
        {options.length === 0 ? (
          <p className="text-ink-soft">Aucune adresse e-mail dans la fiche ni dans l'onglet Famille.</p>
        ) : (
          options.map((o) => (
            <label key={o.email} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-pen)]"
                checked={to.includes(o.email)}
                onChange={(e) => setTo((t) => (e.target.checked ? [...t, o.email] : t.filter((x) => x !== o.email)))}
              />
              {o.label} <span className="text-ink-soft">{o.email}</span>
            </label>
          ))
        )}
      </fieldset>
      <Field label="Objet">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message">
        <DictationTextarea value={text} onValueChange={setText} className="min-h-40" />
      </Field>
      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-rule bg-sheet px-5 py-3">
        <Button variant="ghost" onClick={() => guard.askBeforeClose(onDone)}>
          Annuler
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void send()}>
          <Mail className="size-4" /> {busy ? "Envoi…" : "Envoyer"}
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}
