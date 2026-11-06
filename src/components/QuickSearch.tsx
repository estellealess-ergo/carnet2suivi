import { NotebookPen, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ageFrom } from "@/lib/dates";
import { STATUS_LABEL, fullName, initials } from "@/lib/labels";
import { usePatients } from "@/lib/queries";
import { matches } from "@/lib/search";
import { Input, Modal, cx } from "./ui";

/**
 * Recherche rapide d'un patient depuis n'importe quelle page :
 * bouton dans la barre de gauche, ou Ctrl+K (Cmd+K sur Mac).
 * Entrée ouvre la fiche ; le bouton « Note » ouvre directement une note de séance.
 */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function QuickSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Rechercher un patient (${MAC ? "Cmd" : "Ctrl"}+K)`}
        className="mx-2 mb-2 flex h-11 items-center justify-center gap-3 rounded-md border border-rule px-0 text-ink-soft hover:border-pen hover:text-ink lg:mx-3 lg:justify-start lg:px-3"
      >
        <Search className="size-5 shrink-0" aria-hidden />
        <span className="sr-only lg:not-sr-only">Rechercher</span>
        <kbd className="ml-auto hidden rounded border border-rule px-1.5 text-xs lg:inline">{MAC ? "⌘ K" : "Ctrl K"}</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Rechercher un patient">
        {open && <Results onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function Results({ onClose }: { onClose: () => void }) {
  const patients = usePatients();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const list = useMemo(() => {
    const found = patients.filter((p) =>
      matches([p.first_name, p.last_name, p.school_name, p.school_class, p.pinned_info].filter(Boolean).join(" "), q),
    );
    // Les patients suivis d'abord, les archivés à la fin.
    return found.sort((a, b) => Number(a.status === "archive") - Number(b.status === "archive")).slice(0, 12);
  }, [patients, q]);

  const go = (id: string, note = false) => {
    onClose();
    navigate(note ? `/patients/${id}?onglet=notes&nouvelle=1` : `/patients/${id}`);
  };

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-ink-soft" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && list[active]) {
              e.preventDefault();
              go(list[active]!.id, e.ctrlKey || e.metaKey);
            }
          }}
          placeholder="Prénom, nom, école…"
          className="pl-9"
          aria-label="Rechercher un patient"
        />
      </div>
      <p className="mt-2 text-xs text-ink-soft">Entrée : ouvrir la fiche · Ctrl+Entrée : nouvelle note de séance</p>
      {list.length === 0 ? (
        <p className="py-6 text-center text-ink-soft">Aucun patient trouvé.</p>
      ) : (
        <ul className="mt-3 space-y-1" role="listbox">
          {list.map((p, i) => {
            const age = ageFrom(p.birth_date);
            return (
              <li key={p.id} role="option" aria-selected={i === active} className={cx("flex items-center gap-2 rounded-md", i === active && "bg-pen-soft")}>
                <button type="button" onClick={() => go(p.id)} onMouseEnter={() => setActive(i)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper text-sm font-bold text-pen">{initials(p)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{fullName(p)}</span>
                    <span className="block truncate text-sm text-ink-soft">
                      {[age !== null ? `${age} ans` : null, p.usual_day, p.status !== "actif" ? STATUS_LABEL[p.status] : null].filter(Boolean).join(", ")}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => go(p.id, true)}
                  className="mr-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold text-pen hover:bg-sheet"
                  title="Nouvelle note de séance"
                >
                  <NotebookPen className="size-4" /> Note
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
