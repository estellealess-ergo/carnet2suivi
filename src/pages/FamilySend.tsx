import { ClipboardPaste, Copy, Mail, MessageCircle, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { sanitize } from "@/components/NoteEditor";
import { DictationTextarea } from "@/components/DictationTextarea";
import { Button, Empty, Field, Input, PageHeader, Pill, cx, toast } from "@/components/ui";
import { useUnsavedGuard } from "@/components/UnsavedGuard";
import { askAssistant, assistantAvailable, copyForClaude, pasteFromClaude } from "@/lib/assistant";
import { getMailAccount, sendEmail, type MailAccount } from "@/lib/comms";
import { fmtDay, fmtLongDay, localDay } from "@/lib/dates";
import { htmlToText } from "@/lib/html";
import { fullName } from "@/lib/labels";
import { supabase } from "@/lib/supabase";
import { composeFamilyMessage, splitFamilyMessage, whatsappLink } from "@/lib/session-note";
import { useFamilyReports, useGuardians, useNotesOn, usePatients } from "@/lib/queries";
import { create, update } from "@/lib/repo";
import type { FamilyReport, Note, Patient } from "@/lib/types";

/** Envoi du jour : un court message par séance, relu avant d'être transmis à la famille. */
export function FamilySend() {
  const [day, setDay] = useState(localDay());
  const notes = useNotesOn(day);
  const patients = usePatients();
  const reports = useFamilyReports();
  const [account, setAccount] = useState<MailAccount>(null);
  useEffect(() => {
    void getMailAccount().then(setAccount);
  }, []);
  const byId = new Map(patients.map((p) => [p.id, p]));
  const rows = notes
    .filter((n) => byId.has(n.patient_id))
    .sort((a, b) => byId.get(a.patient_id)!.day_order - byId.get(b.patient_id)!.day_order);

  return (
    <>
      <PageHeader
        title="Envoi aux familles"
        subtitle={`Séances du ${fmtLongDay(day)}`}
        actions={
          <Field label="Séances du" className="w-44">
            <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </Field>
        }
      />
      {rows.length === 0 ? (
        <Empty>Aucune note de séance à cette date.</Empty>
      ) : (
        <ol className="space-y-5">
          {rows.map((n) => (
            <ReportCard
              key={n.id}
              note={n}
              patient={byId.get(n.patient_id)!}
              report={reports.find((r) => r.note_id === n.id) ?? null}
              account={account}
            />
          ))}
        </ol>
      )}
    </>
  );
}

function ReportCard({
  note,
  patient,
  report,
  account,
}: {
  note: Note;
  patient: Patient;
  report: FamilyReport | null;
  account: MailAccount;
}) {
  const guardians = useGuardians(patient.id).filter((g) => g.receives_reports);
  const initial = splitFamilyMessage(report?.content ?? "");
  const [recap, setRecap] = useState(initial.recap);
  const [home, setHome] = useState(initial.home);
  const text = composeFamilyMessage(recap, home);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(() => guardians.map((g) => g.id));
  useEffect(() => {
    setSelected((s) => (s.length ? s : guardians.map((g) => g.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardians.length]);
  useEffect(() => {
    if (report && !recap && !home) {
      const parts = splitFamilyMessage(report.content);
      setRecap(parts.recap);
      setHome(parts.home);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  const dirty = text.trim() !== (report?.content ?? "").trim();
  const chosen = guardians.filter((g) => selected.includes(g.id));
  const emails = chosen.map((g) => g.email).filter(Boolean) as string[];
  const phones = chosen.map((g) => g.phone).filter(Boolean) as string[];

  async function saveReport(patch: Partial<FamilyReport> = {}): Promise<FamilyReport> {
    const values = { content: text.trim(), ...patch };
    if (report) {
      await update("family_reports", report.id, values);
      return { ...report, ...values };
    }
    return create("family_reports", {
      patient_id: patient.id,
      note_id: note.id,
      report_date: note.note_date,
      content: text.trim(),
      status: "brouillon",
      sent_at: null,
      sent_via: null,
      recipients: null,
      published: false,
      patient_first_name: patient.first_name,
      ...patch,
    });
  }

  const guard = useUnsavedGuard({
    dirty,
    label: `Message pour la famille de ${fullName(patient)}`,
    onSave: async () => {
      await saveReport();
      return true;
    },
  });

  const markSent = (via: string, recipients: string) =>
    saveReport({ status: "envoye", sent_at: new Date().toISOString(), sent_via: via, recipients });

  const subject = `Séance d'ergothérapie du ${fmtDay(note.note_date)} — ${patient.first_name}`;

  return (
    <li className="rounded-lg border border-rule bg-sheet p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex-1">{fullName(patient)}</h2>
        {report?.status === "envoye" && <Pill tone="done">Envoyé{report.sent_via ? ` par ${report.sent_via}` : ""}</Pill>}
        {report?.published && <Pill tone="pen">Dans l'espace famille</Pill>}
      </div>
      <details className="mb-3">
        <summary className="cursor-pointer text-sm text-ink-soft">Voir la note de séance</summary>
        <div className="prose-note mt-2 border-l-2 border-rule pl-3 text-sm" dangerouslySetInnerHTML={{ __html: sanitize(note.content_html) }} />
      </details>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Récap de la séance">
          <DictationTextarea value={recap} onValueChange={setRecap} className="min-h-32" placeholder="Ce que nous avons travaillé aujourd'hui…" />
        </Field>
        <Field label="À faire à la maison" hint="Facultatif">
          <DictationTextarea value={home} onValueChange={setHome} className="min-h-32" placeholder="Ex. 5 minutes de pâte à modeler chaque jour" />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {assistantAvailable() && (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("ia");
              try {
                setRecap(await askAssistant("famille", htmlToText(note.content_html), patient));
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(null);
              }
            }}
          >
            <Sparkles className="size-4" /> {busy === "ia" ? "Rédaction…" : "Proposer un message"}
          </Button>
        )}
        {!assistantAvailable() && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await copyForClaude("famille", htmlToText(note.content_html), patient);
                toast("Copié. Colle-le dans Claude, puis copie sa réponse et clique sur « Coller la réponse ».");
              }}
            >
              <Copy className="size-4" /> Copier pour Claude
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  setRecap(await pasteFromClaude(patient));
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              <ClipboardPaste className="size-4" /> Coller la réponse
            </Button>
          </>
        )}
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => void saveReport().then(() => toast("Brouillon enregistré"))}>
            Enregistrer le brouillon
          </Button>
        )}
      </div>

      <fieldset className="mt-4">
        <legend className="mb-1 text-sm font-semibold">Destinataires</legend>
        {guardians.length === 0 ? (
          <p className="text-sm text-ink-soft">Aucun contact ne reçoit les comptes rendus. Ajoute-les dans l'onglet Famille de la fiche.</p>
        ) : (
          guardians.map((g) => (
            <label key={g.id} className="flex flex-wrap items-center gap-2 py-1">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-pen)]"
                checked={selected.includes(g.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, g.id] : s.filter((x) => x !== g.id)))}
              />
              {fullName(g)}
              <span className="text-sm text-ink-soft">{[g.email, g.phone].filter(Boolean).join(", ")}</span>
              {g.phone && whatsappLink(g.phone, text) && (
                <a
                  href={text.trim() ? whatsappLink(g.phone, text)! : undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!text.trim()}
                  onClick={(e) => {
                    if (!text.trim()) return e.preventDefault();
                    void markSent("WhatsApp", g.phone!);
                  }}
                  className={cx(
                    "ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1f7a4d] px-2.5 text-sm font-semibold text-white hover:bg-[#186440]",
                    !text.trim() && "pointer-events-none opacity-50",
                  )}
                >
                  <MessageCircle className="size-4" /> Envoyer sur WhatsApp
                </a>
              )}
            </label>
          ))
        )}
      </fieldset>

      <div className={cx("mt-4 flex flex-wrap gap-2 border-t border-rule pt-4", !text.trim() && "opacity-60")}>
        {account && (
          <Button
            variant="primary"
            disabled={!text.trim() || emails.length === 0 || busy !== null}
            title={emails.length === 0 ? "Aucune adresse e-mail parmi les destinataires" : undefined}
            onClick={async () => {
              setBusy("mail");
              try {
                await sendEmail({ to: emails, subject, text: text.trim(), patientId: patient.id });
                await markSent("e-mail", emails.join(", "));
                toast("Message envoyé par e-mail");
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(null);
              }
            }}
          >
            <Mail className="size-4" /> {busy === "mail" ? "Envoi…" : "Envoyer par e-mail"}
          </Button>
        )}
        <Button
          disabled={!text.trim() || phones.length === 0}
          title={phones.length === 0 ? "Aucun numéro de téléphone parmi les destinataires" : undefined}
          onClick={async () => {
            // Ouvre l'application Messages de l'appareil, message prêt à envoyer.
            const sep = /iPhone|iPad|Mac/.test(navigator.userAgent) ? "&" : "?";
            window.location.href = `sms:${phones.join(",")}${sep}body=${encodeURIComponent(text.trim())}`;
            await markSent("SMS", phones.join(", "));
          }}
        >
          <MessageSquare className="size-4" /> Ouvrir dans Messages
        </Button>
        <Button
          variant="ghost"
          disabled={!text.trim()}
          onClick={async () => {
            await navigator.clipboard.writeText(text.trim());
            toast("Message copié");
          }}
        >
          <Copy className="size-4" /> Copier
        </Button>
        {supabase && (
        <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-pen)]"
            checked={report?.published ?? false}
            disabled={!text.trim()}
            onChange={async (e) => {
              await saveReport({ published: e.target.checked });
              toast(e.target.checked ? "Publié dans l'espace famille" : "Retiré de l'espace famille");
            }}
          />
          Visible dans l'espace famille
        </label>
        )}
      </div>
      {guard.dialog}
    </li>
  );
}
