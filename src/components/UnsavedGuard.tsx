import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { Button, Modal } from "./ui";

/**
 * Règle du cabinet : toujours demander si on veut enregistrer avant de quitter
 * une page ou de fermer une saisie en cours.
 *
 * Plusieurs saisies peuvent être ouvertes en même temps (notes côte à côte) :
 * un seul garde, au niveau de la mise en page, les surveille toutes.
 */

/** leaving = vrai quand on enregistre parce qu'on quitte la page : la saisie ne doit pas naviguer elle-même. */
type Entry = { label: string; save: (leaving: boolean) => Promise<boolean> };
type Ctx = { set: (id: string, e: Entry | null) => void };
const GuardCtx = createContext<Ctx | null>(null);

export function GuardProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState(false);

  const set = useCallback((id: string, e: Entry | null) => {
    if (e) entries.current.set(id, e);
    else entries.current.delete(id);
    setCount(entries.current.size);
  }, []);

  // On lit la liste au moment même du changement de page (et non l'état affiché),
  // pour qu'une saisie tout juste enregistrée ne bloque pas la navigation qui suit.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      entries.current.size > 0 &&
      currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search,
  );

  useEffect(() => {
    if (count === 0) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [count]);

  const labels = [...entries.current.values()].map((e) => e.label);

  return (
    <GuardCtx.Provider value={{ set }}>
      {children}
      <Modal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title="Enregistrer avant de quitter ?"
      >
        <p className="text-ink-soft">
          {labels.length > 1 ? "Ces saisies contiennent" : "Cette saisie contient"} des modifications non
          enregistrées :
        </p>
        <ul className="mt-2 list-disc pl-5">
          {labels.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <SaveChoices
          saving={saving}
          onStay={() => blocker.reset?.()}
          onDiscard={() => blocker.proceed?.()}
          onSave={async () => {
            setSaving(true);
            let ok = true;
            for (const e of [...entries.current.values()]) ok = (await e.save(true)) && ok;
            setSaving(false);
            if (ok) blocker.proceed?.();
            else blocker.reset?.();
          }}
        />
      </Modal>
    </GuardCtx.Provider>
  );
}

function SaveChoices({
  saving,
  onStay,
  onDiscard,
  onSave,
}: {
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Button variant="ghost" onClick={onStay}>
        Continuer la saisie
      </Button>
      <Button variant="danger" onClick={onDiscard}>
        Quitter sans enregistrer
      </Button>
      <Button variant="primary" disabled={saving} onClick={onSave}>
        Enregistrer et quitter
      </Button>
    </div>
  );
}

/**
 * À utiliser dans chaque saisie. Renvoie askBeforeClose(close) pour la fermeture
 * de la saisie elle-même, et la fenêtre de confirmation à afficher.
 */
export function useUnsavedGuard({
  dirty,
  label,
  onSave,
}: {
  dirty: boolean;
  label: string;
  onSave: (leaving?: boolean) => Promise<boolean>;
}) {
  const ctx = useContext(GuardCtx);
  const id = useId();
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const [pending, setPending] = useState<null | (() => void)>(null);
  const [saving, setSaving] = useState(false);
  const released = useRef(false);

  useEffect(() => {
    if (!dirty) released.current = false;
    ctx?.set(id, dirty && !released.current ? { label, save: (leaving: boolean) => saveRef.current(leaving) } : null);
    return () => ctx?.set(id, null);
  }, [ctx, id, dirty, label]);

  /** À appeler juste après un enregistrement réussi, avant de fermer ou de changer de page. */
  const release = () => {
    released.current = true;
    ctx?.set(id, null);
  };

  const askBeforeClose = (close: () => void) => {
    if (!dirty) close();
    else setPending(() => close);
  };

  const dialog = (
    <Modal open={pending !== null} onClose={() => setPending(null)} title="Enregistrer avant de fermer ?">
      <p className="text-ink-soft">« {label} » contient des modifications non enregistrées.</p>
      <SaveChoices
        saving={saving}
        onStay={() => setPending(null)}
        onDiscard={() => {
          pending?.();
          setPending(null);
        }}
        onSave={async () => {
          setSaving(true);
          const ok = await saveRef.current();
          setSaving(false);
          if (ok) pending?.();
          setPending(null);
        }}
      />
    </Modal>
  );

  return { dialog, askBeforeClose, release };
}
