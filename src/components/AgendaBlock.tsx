import { useLiveQuery } from "dexie-react-hooks";
import { CalendarClock, Columns3, Link2, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { normName, slotsOfDay, type AgendaSlot } from "@/lib/agenda-match";
import { db } from "@/lib/db";
import { clearUpdatedFiches, getIgnored, ignoreName, refreshOrReconnect, useAgendaState } from "@/lib/google-agenda";
import { fullName } from "@/lib/labels";
import { usePatients } from "@/lib/queries";
import { update } from "@/lib/repo";
import type { Patient } from "@/lib/types";
import { MAX_SIDE_BY_SIDE } from "./PatientMultiPicker";
import { NoteModal } from "./NoteEditor";
import { Button, Field, Modal, Select, cx, toast } from "./ui";

/** Les rendez-vous de l'agenda sont-ils utilisés (agenda relié ou copie locale présente) ? */
export function useAgendaOn(): boolean {
  const s = useAgendaState();
  const count = useLiveQuery(() => db.agenda_events.count(), []) ?? 0;
  return s.linked || count > 0;
}

function useIgnored() {
  const [list, setList] = useState<Set<string>>(new Set());
  const reload = () => void getIgnored().then((l) => setList(new Set(l)));
  useEffect(reload, []);
  return { ignored: list, reload };
}

/** Barre d'état et « Actualiser » au-dessus des colonnes de l'accueil. */
export function AgendaStatus({ day }: { day?: string }) {
  const s = useAgendaState();
  if (!s.linked) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
      <CalendarClock className="size-4 text-pen" aria-hidden />
      <span>
        Google Agenda{s.lastFetch ? ` · mis à jour à ${new Date(s.lastFetch).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
        {!s.active && " · accès à renouveler"}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={s.loading}
        onClick={() =>
          void refreshOrReconnect(day)
            .then(() => toast("Rendez-vous à jour"))
            .catch((e) => toast((e as Error).message, "error"))
        }
      >
        <RefreshCw className={cx("size-4", s.loading && "animate-spin")} /> {s.active ? "Actualiser" : "Reconnecter"}
      </Button>
      {s.error && <span className="text-late">{s.error}</span>}
      {s.updatedFiches.length > 0 && (
        <span className="w-full rounded-md bg-pen-soft px-2 py-1 text-ink">
          Horaires mis à jour d'après l'agenda : {s.updatedFiches.join(", ")}.{" "}
          <button type="button" className="font-semibold text-pen underline" onClick={clearUpdatedFiches}>
            OK
          </button>
        </span>
      )}
    </div>
  );
}

/** Rendez-vous d'un jour, dans la colonne de ce jour sur l'accueil. */
export function AgendaDay({ day }: { day: string }) {
  const patients = usePatients();
  const events = useLiveQuery(() => db.agenda_events.where("day").equals(day).toArray(), [day]) ?? [];
  const { ignored, reload } = useIgnored();
  const slots = useMemo(() => slotsOfDay(events, patients, ignored), [events, patients, ignored]);
  const navigate = useNavigate();
  const [noteFor, setNoteFor] = useState<Patient | null>(null);
  const [associate, setAssociate] = useState<string | null>(null);

  if (!slots.length) return <p className="py-2 text-sm text-ink-soft">Aucun rendez-vous dans l'agenda.</p>;

  const open = (slot: AgendaSlot) => {
    const ps = [...new Map(slot.matches.filter((m) => m.patient).map((m) => [m.patient!.id, m.patient!])).values()];
    if (!ps.length) return;
    if (ps.length === 1 && !slot.group) return setNoteFor(ps[0]!);
    if (ps.length > MAX_SIDE_BY_SIDE) toast(`Les ${MAX_SIDE_BY_SIDE} premiers patients sont ouverts.`);
    navigate(`/notes?p=${ps.slice(0, MAX_SIDE_BY_SIDE).map((p) => p.id).join(",")}&date=${day}`);
  };

  return (
    <>
      <ul className="mb-2 space-y-1.5">
        {slots.map((slot) => {
          const known = slot.matches.filter((m) => m.patient);
          const allIgnored = slot.matches.length > 0 && slot.matches.every((m) => m.ignored);
          return (
            <li key={slot.time} className={cx("rounded-md border px-3 py-2", allIgnored ? "border-transparent bg-paper text-ink-soft" : "border-rule bg-sheet")}>
              <div className="flex items-start gap-2">
                <span className="w-12 shrink-0 font-semibold tabular-nums text-pen">{slot.time}</span>
                <div className="min-w-0 flex-1">
                  {allIgnored ? (
                    <span>{slot.events.map((e) => e.title).join(" · ")}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={!known.length}
                      onClick={() => open(slot)}
                      className="text-left disabled:cursor-default"
                      title={known.length ? (slot.group ? "Ouvrir les notes côte à côte" : "Ouvrir la note de séance") : undefined}
                    >
                      {slot.group && (
                        <span className="mr-1.5 inline-flex items-center gap-1 rounded bg-pen-soft px-1.5 py-0.5 text-xs font-semibold text-pen">
                          <Users className="size-3" aria-hidden /> Groupe
                        </span>
                      )}
                      {slot.matches
                        .filter((m) => !m.ignored)
                        .map((m, i) => (
                          <span key={i}>
                            {i > 0 && ", "}
                            <span className={cx(m.patient ? "font-semibold hover:underline" : "italic text-ink-soft")}>{m.patient ? fullName(m.patient) : m.name}</span>
                          </span>
                        ))}
                      {slot.group && known.length > 1 && <Columns3 className="ml-1.5 inline size-4 text-pen" aria-label="notes côte à côte" />}
                    </button>
                  )}
                  {slot.matches
                    .filter((m) => !m.patient && !m.ignored)
                    .map((m) => (
                      <div key={m.name} className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-ink-soft">« {m.name} » : aucun patient trouvé.</span>
                        <button type="button" className="inline-flex items-center gap-1 font-semibold text-pen underline" onClick={() => setAssociate(m.name)}>
                          <Link2 className="size-3" aria-hidden /> Associer à un patient
                        </button>
                        <button
                          type="button"
                          className="text-ink-soft underline"
                          onClick={async () => {
                            await ignoreName(normName(m.name));
                            reload();
                            toast(`« ${m.name} » ne sera plus proposé.`);
                          }}
                        >
                          Ignorer ce nom
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <NoteModal patient={noteFor} defaultDate={day} onDone={() => setNoteFor(null)} />
      <AssociateDialog name={associate} patients={patients} onClose={() => setAssociate(null)} />
    </>
  );
}

/** Associer un nom de l'agenda à un patient existant (mémorisé dans sa fiche). Rien n'est créé. */
export function AssociateDialog({ name, patients, onClose }: { name: string | null; patients: Patient[]; onClose: () => void }) {
  const [pid, setPid] = useState("");
  useEffect(() => setPid(""), [name]);
  const sorted = useMemo(
    () => patients.filter((p) => !p.deleted_at).sort((a, b) => (a.status === "actif" ? 0 : 1) - (b.status === "actif" ? 0 : 1) || fullName(a).localeCompare(fullName(b), "fr")),
    [patients],
  );
  // Les patients dont le prénom ressemble viennent en premier.
  const guess = name ? (normName(name).split(" ")[0] ?? "") : "";
  const first = sorted.filter((p) => normName(p.first_name).startsWith(guess));
  const rest = sorted.filter((p) => !first.includes(p));
  return (
    <Modal open={name !== null} onClose={onClose} title={`Associer « ${name ?? ""} »`}>
      <p className="mb-3 text-ink-soft">Choisis le patient qui correspond à ce nom de l'agenda. L'association sera retenue pour les prochains rendez-vous.</p>
      <Field label="Patient">
        <Select value={pid} onChange={(e) => setPid(e.target.value)} autoFocus>
          <option value="">Choisir…</option>
          {first.length > 0 && (
            <optgroup label="Prénom proche">
              {first.map((p) => (
                <option key={p.id} value={p.id}>
                  {fullName(p)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Tous les patients">
            {rest.map((p) => (
              <option key={p.id} value={p.id}>
                {fullName(p)}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Annuler
        </Button>
        <Button
          variant="primary"
          disabled={!pid || !name}
          onClick={async () => {
            const p = patients.find((x) => x.id === pid)!;
            const names = [...new Set([...(p.calendar_names ?? []), name!])];
            await update("patients", p.id, { calendar_names: names });
            toast(`« ${name} » associé à ${fullName(p)}`);
            onClose();
          }}
        >
          Associer
        </Button>
      </div>
    </Modal>
  );
}
