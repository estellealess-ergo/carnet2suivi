import { useRef, useState, type MutableRefObject } from "react";
import { WEEKDAYS, localDay } from "@/lib/dates";
import { weekParity } from "@/lib/schedule";
import { FREQUENCY_LABEL, PLACE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { create, update } from "@/lib/repo";
import type { Patient } from "@/lib/types";
import { Button, Field, Input, Select, Textarea, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

type Values = Omit<Patient, "id" | "owner_id" | "created_at" | "updated_at" | "deleted_at">;

const EMPTY: Values = {
  first_name: "",
  last_name: "",
  birth_date: null,
  status: "actif",
  usual_day: null,
  usual_time: null,
  usual_place: null,
  frequency: null,
  week_parity: null,
  day_order: 99,
  sort_order: 0,
  school_name: null,
  school_class: null,
  phone: null,
  email: null,
  consultation_reason: null,
  diagnosis: null,
  care_start_date: null,
  pinned_info: null,
  notes: null,
};

function pick(p: Patient): Values {
  const { id: _i, owner_id: _o, created_at: _c, updated_at: _u, deleted_at: _d, ...rest } = p;
  return rest;
}

export function PatientForm({
  patient,
  onDone,
  nextSortOrder = 0,
  closeRef,
}: {
  patient?: Patient;
  onDone: (p?: Patient) => void;
  nextSortOrder?: number;
  closeRef?: MutableRefObject<(() => void) | null>;
}) {
  const initial = patient ? pick(patient) : { ...EMPTY, sort_order: nextSortOrder };
  const [v, setV] = useState<Values>(initial);
  const releaseRef = useRef<(() => void) | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((x) => ({ ...x, [k]: val }));
  const text = (k: keyof Values) => ({
    value: (v[k] as string | null) ?? "",
    onChange: (e: { target: { value: string } }) => set(k, (e.target.value || null) as never),
  });

  async function save(): Promise<boolean> {
    if (!v.first_name.trim() && !v.last_name.trim()) {
      toast("Indique au moins le prénom ou le nom.", "error");
      return false;
    }
    const values = { ...v, first_name: v.first_name.trim(), last_name: v.last_name.trim() };
    releaseRef.current?.();
    if (patient) {
      await update("patients", patient.id, values);
      toast("Fiche enregistrée");
      onDone(patient);
    } else {
      const p = await create("patients", values);
      toast("Patient créé");
      onDone(p);
    }
    return true;
  }

  const guard = useUnsavedGuard({ dirty, label: "Fiche patient", onSave: save });
  releaseRef.current = guard.release;
  if (closeRef) closeRef.current = () => guard.askBeforeClose(() => onDone());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-5"
    >
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-bold">Identité</legend>
        <Field label="Prénom">
          <Input value={v.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus={!patient} />
        </Field>
        <Field label="Nom">
          <Input value={v.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
        <Field label="Date de naissance">
          <Input type="date" {...text("birth_date")} />
        </Field>
        <Field label="Statut">
          <Select value={v.status} onChange={(e) => set("status", e.target.value as Values["status"])}>
            {Object.entries(STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Téléphone">
          <Input type="tel" {...text("phone")} />
        </Field>
        <Field label="E-mail">
          <Input type="email" {...text("email")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-bold">Suivi</legend>
        <Field label="Jour de suivi" hint="Le patient apparaît ce jour-là dans « Ma journée ».">
          <Select value={v.usual_day ?? ""} onChange={(e) => set("usual_day", (e.target.value || null) as Values["usual_day"])}>
            <option value="">Non défini</option>
            {[...WEEKDAYS, "Ponctuel" as const].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Heure habituelle">
          <Input type="time" {...text("usual_time")} />
        </Field>
        <Field label="Lieu">
          <Select value={v.usual_place ?? ""} onChange={(e) => set("usual_place", (e.target.value || null) as Values["usual_place"])}>
            <option value="">Non défini</option>
            {Object.entries(PLACE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fréquence">
          <Select value={v.frequency ?? ""} onChange={(e) => set("frequency", (e.target.value || null) as Values["frequency"])}>
            <option value="">Non définie</option>
            {Object.entries(FREQUENCY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {v.frequency === "bimensuel" && (
          <Field label="Semaines de séance" hint={`Cette semaine est une semaine ${weekParity(localDay())}.`}>
            <Select value={v.week_parity ?? ""} onChange={(e) => set("week_parity", (e.target.value || null) as Values["week_parity"])}>
              <option value="">Toutes les semaines (à préciser)</option>
              <option value="paire">Semaines paires</option>
              <option value="impaire">Semaines impaires</option>
            </Select>
          </Field>
        )}
        <Field label="Début du suivi">
          <Input type="date" {...text("care_start_date")} />
        </Field>
        <Field label="École / établissement">
          <Input {...text("school_name")} />
        </Field>
        <Field label="Classe">
          <Input {...text("school_class")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-bold">Dossier</legend>
        <Field label="Motif de consultation">
          <Textarea {...text("consultation_reason")} className="min-h-16" />
        </Field>
        <Field label="Diagnostic connu">
          <Textarea {...text("diagnosis")} className="min-h-16" />
        </Field>
        <Field label="Notes administratives">
          <Textarea {...text("notes")} className="min-h-16" />
        </Field>
      </fieldset>

      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-rule bg-sheet px-5 py-3">
        <Button variant="ghost" onClick={() => guard.askBeforeClose(() => onDone())}>
          Annuler
        </Button>
        <Button type="submit" variant="primary">
          {patient ? "Enregistrer la fiche" : "Créer le patient"}
        </Button>
      </div>
      {guard.dialog}
    </form>
  );
}
