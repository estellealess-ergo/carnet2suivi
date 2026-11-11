import { useLiveQuery } from "dexie-react-hooks";
import { ListPlus, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useRef, useState, type MutableRefObject } from "react";
import { db, getMeta, setMeta } from "@/lib/db";
import { create, remove, update } from "@/lib/repo";
import { RUBRICS, fillTemplate, templateFields, type RubricKey } from "@/lib/session-note";
import type { Activity } from "@/lib/types";
import { Button, Field, Input, Modal, Select, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

export const EXAMPLE_TEMPLATE =
  "Entraînement TypingClub, leçon [leçon] (lettres : [lettres]) : [vitesse] mpm, [précision] % de précision réelle";

export function useActivities(): Activity[] {
  return (
    useLiveQuery(async () =>
      (await db.activities.toArray())
        .filter((a) => !a.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "fr")),
    ) ?? []
  );
}

const lastKey = (a: Activity, patientId: string) => `activite:${a.id}:${patientId}`;

/**
 * Dans la note de séance : les activités enregistrées, en un clic.
 * Les cases à remplir sont pré-remplies avec les valeurs de la dernière fois pour ce patient.
 */
export function ActivityPicker({ patientId, onInsert }: { patientId: string; onInsert: (rubric: RubricKey, text: string) => void }) {
  const list = useActivities();
  const [filling, setFilling] = useState<{ a: Activity; values: Record<string, string>; rubric: RubricKey } | null>(null);
  const [managing, setManaging] = useState(false);
  const closeLib = useRef<(() => void) | null>(null);

  async function pick(a: Activity) {
    const fields = templateFields(a.template);
    if (!fields.length) {
      onInsert(a.rubric, a.template.trim());
      return toast("Activité ajoutée à la note");
    }
    const last = (await getMeta<Record<string, string>>(lastKey(a, patientId))) ?? {};
    setFilling({ a, values: Object.fromEntries(fields.map((f) => [f, last[f] ?? ""])), rubric: a.rubric });
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-semibold text-ink-soft">Activités :</span>
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => void pick(a)}
            title={a.template}
            className="rounded-full border border-rule bg-sheet px-3 py-1 text-sm font-semibold hover:border-pen hover:text-pen"
          >
            {a.title}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setManaging(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-rule px-3 py-1 text-sm text-ink-soft hover:border-pen hover:text-pen"
        >
          {list.length ? <Settings2 className="size-3.5" /> : <Plus className="size-3.5" />}
          {list.length ? "Gérer" : "Enregistrer une activité"}
        </button>
      </div>

      <Modal open={filling !== null} onClose={() => setFilling(null)} title={filling?.a.title ?? ""}>
        {filling && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              onInsert(filling.rubric, fillTemplate(filling.a.template, filling.values));
              await setMeta(lastKey(filling.a, patientId), filling.values);
              setFilling(null);
              toast("Activité ajoutée à la note");
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.keys(filling.values).map((f) => (
                <Field key={f} label={f.charAt(0).toUpperCase() + f.slice(1)}>
                  <Input
                    value={filling.values[f]}
                    inputMode={/vitesse|mpm|précision|%|score|nombre|temps|niveau|leçon/i.test(f) ? "decimal" : undefined}
                    onChange={(e) => setFilling({ ...filling, values: { ...filling.values, [f]: e.target.value } })}
                  />
                </Field>
              ))}
            </div>
            <Field label="Dans la rubrique" className="w-48">
              <Select value={filling.rubric} onChange={(e) => setFilling({ ...filling, rubric: e.target.value as RubricKey })}>
                {RUBRICS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.title}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="rounded-md bg-paper p-3 text-sm">
              <span className="text-ink-soft">Ajouté à la note : </span>
              {fillTemplate(filling.a.template, filling.values)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFilling(null)}>
                Annuler
              </Button>
              <Button variant="primary" type="submit">
                <ListPlus className="size-4" /> Ajouter à la note
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={managing} onClose={() => (closeLib.current ? closeLib.current() : setManaging(false))} title="Mes activités" wide>
        {managing && <ActivityLibrary closeRef={closeLib} onClose={() => setManaging(false)} />}
      </Modal>
    </div>
  );
}

/** Bibliothèque : créer, modifier, supprimer des activités. */
export function ActivityLibrary({ closeRef, onClose }: { closeRef?: MutableRefObject<(() => void) | null>; onClose?: () => void } = {}) {
  const list = useActivities();
  const [edit, setEdit] = useState<Partial<Activity> | null>(null);
  const [orig, setOrig] = useState("");
  const fields = edit?.template ? templateFields(edit.template) : [];
  const open = (a: Partial<Activity>) => (setEdit(a), setOrig(JSON.stringify(a)));
  const dirty = edit !== null && JSON.stringify(edit) !== orig;

  const save = async () => {
    if (!edit?.title?.trim() || !edit.template?.trim()) {
      toast("Donne un nom et le texte de l'activité.", "error");
      return false;
    }
    const values = { title: edit.title.trim(), template: edit.template.trim(), rubric: edit.rubric ?? "fait" };
    if (edit.id) await update("activities", edit.id, values);
    else await create("activities", { ...values, sort_order: list.length });
    guard.release();
    setEdit(null);
    toast("Activité enregistrée");
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "Activité", onSave: save });
  if (closeRef) closeRef.current = onClose ? () => guard.askBeforeClose(onClose) : null;

  return (
    <div className="space-y-4">
      <p className="text-ink-soft">
        Écris l'activité telle qu'elle doit apparaître dans la note, et mets entre crochets ce qui change à chaque
        séance. Exemple : <em>{EXAMPLE_TEMPLATE}</em>
      </p>
      {list.length > 0 && (
        <ul className="divide-y divide-rule rounded-md border border-rule">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{a.title}</p>
                <p className="truncate text-sm text-ink-soft">{a.template}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => open(a)}>
                <Pencil className="size-4" /> Modifier
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Supprimer ${a.title}`}
                onClick={async () => {
                  if (!window.confirm(`Supprimer l'activité « ${a.title} » ? Les notes déjà écrites ne changent pas.`)) return;
                  await remove("activities", a.id);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <form
          className="space-y-3 rounded-md border border-pen/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <Field label="Nom court (bouton)">
              <Input value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="TypingClub" required autoFocus />
            </Field>
            <Field label="Texte ajouté à la note" hint={fields.length ? `Cases à remplir : ${fields.join(", ")}` : "Mets entre crochets ce qui change : [leçon], [vitesse]…"}>
              <Input value={edit.template ?? ""} onChange={(e) => setEdit({ ...edit, template: e.target.value })} required />
            </Field>
          </div>
          <Field label="Rubrique par défaut" className="w-48">
            <Select value={edit.rubric ?? "fait"} onChange={(e) => setEdit({ ...edit, rubric: e.target.value as RubricKey })}>
              {RUBRICS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => guard.askBeforeClose(() => setEdit(null))}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" disabled={!edit.title?.trim() || !edit.template?.trim()}>
              Enregistrer l'activité
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => open({ title: "", template: "", rubric: "fait" })}>
            <Plus className="size-4" /> Nouvelle activité
          </Button>
          {!list.some((a) => a.template === EXAMPLE_TEMPLATE) && (
            <Button onClick={() => open({ title: "TypingClub", template: EXAMPLE_TEMPLATE, rubric: "fait" })}>Partir de l'exemple TypingClub</Button>
          )}
        </div>
      )}
      {guard.dialog}
    </div>
  );
}
