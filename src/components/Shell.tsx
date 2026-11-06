import {
  CalendarDays,
  CheckSquare,
  CloudOff,
  Columns3,
  Home,
  Loader2,
  RefreshCw,
  Settings,
  TriangleAlert,
  Users,
  HardDrive,
  Inbox,
  Send,
  Cloud,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useLiveQuery } from "dexie-react-hooks";
import { daysSinceBackup } from "@/lib/backup";
import { fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { usePeerState } from "@/lib/peer-sync";
import { syncNow, useSyncState } from "@/lib/sync-controller";
import { PeerIndicator, PhonePhotoPrompt } from "./Devices";
import { QuickSearch } from "./QuickSearch";
import { GuardProvider } from "./UnsavedGuard";
import { Button, cx, registerToastHost } from "./ui";

const NAV = [
  { to: "/", label: "Accueil", icon: Home, end: true },
  { to: "/journee", label: "Ma journée", icon: CalendarDays },
  { to: "/patients", label: "Patients", icon: Users },
  { to: "/notes", label: "Notes côte à côte", icon: Columns3 },
  { to: "/taches", label: "Tâches", icon: CheckSquare },
  { to: "/echanges", label: "Échanges", icon: Inbox },
  { to: "/envoi", label: "Envoi aux familles", icon: Send },
  { to: "/parametres", label: "Paramètres", icon: Settings },
];

/**
 * Mise en page commune : la barre d'outils de gauche reste fixe et visible
 * sur toutes les pages (icônes seules sur téléphone, avec libellés sur ordinateur).
 */
export function Shell() {
  // Les notes côte à côte utilisent toute la largeur de l'écran.
  const wide = useLocation().pathname.startsWith("/notes");
  return (
    <GuardProvider>
      <div className="min-h-dvh">
        <aside
          className="fixed inset-y-0 left-0 z-30 flex w-16 flex-col border-r border-rule bg-sheet pt-[env(safe-area-inset-top)] lg:w-60"
          aria-label="Navigation principale"
        >
          <div className="flex h-16 items-center gap-2 px-3 lg:px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-pen text-sm font-bold text-white" aria-hidden>
              c2s
            </span>
            <span className="hidden text-[1.05rem] leading-tight font-bold lg:block">Carnet de suivi</span>
          </div>
          <QuickSearch />
          <nav className="flex flex-1 flex-col gap-1 px-2 lg:px-3">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) =>
                  cx(
                    "flex h-11 items-center justify-center gap-3 rounded-md px-0 font-semibold text-ink-soft lg:justify-start lg:px-3",
                    "hover:bg-pen-soft hover:text-ink",
                    isActive && "bg-pen-soft text-pen",
                  )
                }
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="sr-only lg:not-sr-only">{label}</span>
              </NavLink>
            ))}
          </nav>
          <PeerIndicator />
          <SyncIndicator />
        </aside>
        <main className="ml-16 min-w-0 px-4 py-6 pb-24 sm:px-6 lg:ml-60 lg:px-10">
          <div className={cx("mx-auto", wide ? "max-w-[110rem]" : "max-w-5xl")}>
            <BackupReminder />
            <Outlet />
          </div>
        </main>
        <PhonePhotoPrompt />
        <UpdatePrompt />
        <Toasts />
      </div>
    </GuardProvider>
  );
}

function SyncIndicator() {
  const s = useSyncState();
  const peer = usePeerState();
  // Sans serveur mais appareils reliés : l'indicateur de liaison suffit.
  if (s.status === "local" && peer.paired) return null;
  const map = {
    local: { icon: HardDrive, text: "Sur cet appareil uniquement", tone: "text-ink-soft" },
    idle: { icon: Cloud, text: s.pending ? `${s.pending} en attente` : "Synchronisé", tone: "text-done" },
    syncing: { icon: Loader2, text: "Synchronisation…", tone: "text-pen" },
    offline: {
      icon: CloudOff,
      text: s.pending ? `Hors ligne · ${s.pending} à envoyer` : "Hors ligne",
      tone: "text-ink-soft",
    },
    error: { icon: TriangleAlert, text: "Synchronisation en échec", tone: "text-late" },
  }[s.status];
  const Icon = map.icon;
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={`${map.text}${s.lastSyncAt ? ` — dernière synchronisation le ${fmtDateTime(s.lastSyncAt)}` : ""}${s.error ? `\n${s.error}` : ""}\nCliquer pour synchroniser maintenant`}
      className={cx(
        "m-2 flex items-center justify-center gap-2 rounded-md px-2 py-3 text-left text-sm lg:m-3 lg:justify-start",
        "hover:bg-pen-soft",
        map.tone,
      )}
    >
      <Icon className={cx("size-5 shrink-0", s.status === "syncing" && "animate-spin")} aria-hidden />
      <span className="sr-only lg:not-sr-only">{map.text}</span>
    </button>
  );
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-lg border border-rule bg-sheet p-3 shadow-lg">
      <RefreshCw className="size-4 text-pen" />
      <span className="text-sm">Une nouvelle version est prête.</span>
      <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
        Mettre à jour
      </Button>
    </div>
  );
}

function Toasts() {
  const [items, setItems] = useState<{ id: number; msg: string; tone: "ok" | "error" }[]>([]);
  useEffect(() => {
    registerToastHost((msg, tone = "ok") => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "error" ? 6000 : 3000);
    });
    return () => registerToastHost(null);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "rounded-md px-4 py-2.5 text-sm font-semibold shadow-lg",
            t.tone === "ok" ? "bg-ink text-white" : "bg-late text-white",
          )}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/** Sans serveur, la sauvegarde est la seule copie de secours : rappel après 7 jours. */
function BackupReminder() {
  const state = useLiveQuery(async () => {
    if (supabase) return null;
    const hasData = (await db.patients.count()) > 0;
    return hasData ? await daysSinceBackup() : -1;
  }, []);
  if (state === undefined || state === -1 || (state !== null && state < 7)) return null;
  if (supabase) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-marker bg-[#fdf8dc] p-3">
      <span className="flex-1">
        {state === null ? "Aucune sauvegarde des dossiers n'a encore été faite." : `Dernière sauvegarde il y a ${state} jours.`} Les
        dossiers ne sont que sur cet appareil.
      </span>
      <Link to="/parametres#sauvegarde" className="inline-flex h-9 items-center rounded-md bg-pen px-3 font-semibold text-white">
        Faire une sauvegarde
      </Link>
    </div>
  );
}
