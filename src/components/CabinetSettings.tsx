import { useEffect, useState } from "react";
import { setMeta } from "@/lib/db";
import { EMPTY_CABINET, getCabinet, type Cabinet } from "@/lib/reports";
import { Button, Field, Input, Textarea, toast } from "./ui";
import { useUnsavedGuard } from "./UnsavedGuard";

/** En-tête des comptes rendus Word : gardé uniquement sur cet appareil. */
export function CabinetSettings() {
  const [saved, setSaved] = useState<Cabinet | null>(null);
  const [v, setV] = useState<Cabinet>(EMPTY_CABINET);
  useEffect(() => {
    void getCabinet().then((c) => (setSaved(c), setV(c)));
  }, []);
  const dirty = saved !== null && JSON.stringify(v) !== JSON.stringify(saved);
  const save = async () => {
    await setMeta("cabinet", v);
    setSaved(v);
    toast("En-tête enregistré");
    return true;
  };
  const guard = useUnsavedGuard({ dirty, label: "En-tête des comptes rendus", onSave: save });
  const f = (k: keyof Cabinet, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );
  return (
    <section id="en-tete" className="rounded-lg border border-rule bg-sheet p-5">
      <h2 className="mb-2">En-tête des comptes rendus</h2>
      <p className="mb-3 text-ink-soft">Apparaît en haut des comptes rendus Word, avec ta signature en bas. Gardé sur cet appareil.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {f("name", "Nom et prénom")}
        {f("profession", "Profession")}
        <Field label="Adresse du cabinet" className="sm:col-span-2">
          <Textarea value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} className="min-h-16" />
        </Field>
        {f("city", "Ville", "Pour « Ville, le … »")}
        {f("phone", "Téléphone")}
        {f("email", "E-mail")}
        {f("rpps", "N° RPPS ou ADELI", "Facultatif")}
      </div>
      <Button variant="primary" className="mt-3" disabled={!dirty} onClick={() => void save()}>
        Enregistrer l'en-tête
      </Button>
      {guard.dialog}
    </section>
  );
}
