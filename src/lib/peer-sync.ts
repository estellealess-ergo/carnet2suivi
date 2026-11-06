/**
 * Liaison directe entre deux appareils (ordinateur ↔ téléphone), sans serveur de données.
 *
 * - Association une seule fois par QR code : il contient l'identifiant de l'ordinateur et une clé secrète.
 * - Les données passent directement d'un appareil à l'autre (WebRTC). Un service public gratuit (PeerJS)
 *   sert seulement à se trouver ; il ne voit que des identifiants techniques, jamais les dossiers.
 * - Tout message est en plus chiffré avec la clé de l'association (AES-GCM) : un relais éventuel ne voit
 *   que du contenu illisible, et un appareil qui n'a pas la clé est refusé.
 * - Fusion ligne par ligne : la version la plus récente (updated_at) gagne. Jamais de suppression physique.
 */
import type { DataConnection, Peer as PeerT } from "peerjs";
import { useSyncExternalStore } from "react";
import { db, getMeta, setMeta } from "./db";
import { TABLES, type PatientDocument } from "./types";

export const SYNCED = [...TABLES, "documents"] as const;
type SyncedTable = (typeof SYNCED)[number];
type Row = { id: string; updated_at: string; [k: string]: unknown };

export interface Pairing {
  me: string;
  other: string;
  key: string;
  label: string;
  paired_at: string;
}

export interface PeerState {
  paired: Pairing | null;
  /** waiting : on attend l'autre appareil ; pairing : QR affiché, en attente du téléphone. */
  status: "off" | "waiting" | "pairing" | "connected" | "syncing";
  lastSync: string | null;
  error: string | null;
  received: number;
}

/* ------------------------------------------------------------------ état observable */

let state: PeerState = { paired: null, status: "off", lastSync: null, error: null, received: 0 };
const listeners = new Set<() => void>();
function set(p: Partial<PeerState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function usePeerState(): PeerState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

/* ------------------------------------------------------------------ chiffrement */

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function bytesToB64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function importKey(k: string) {
  return crypto.subtle.importKey("raw", unb64(k) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(key: CryptoKey, msg: unknown): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(msg));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out.buffer;
}
export async function open<T = Msg>(key: CryptoKey, buf: ArrayBuffer | Uint8Array): Promise<T> {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/* ------------------------------------------------------------------ fusion (testée à part) */

/** Lignes locales à envoyer : absentes de l'autre appareil ou plus récentes ici. */
export function rowsToSend(local: [string, string][], remote: [string, string][]): string[] {
  const theirs = new Map(remote);
  return local.filter(([id, at]) => !theirs.has(id) || at > theirs.get(id)!).map(([id]) => id);
}

let applying = 0;

/** Applique des lignes reçues : seule une version plus récente remplace la version locale. */
export async function applyRows(table: SyncedTable, rows: Row[]): Promise<number> {
  const t = db.table(table);
  let n = 0;
  applying++;
  try {
    await db.transaction("rw", t, async () => {
      for (const r of rows) {
        const local = (await t.get(r.id)) as Row | undefined;
        if (local && local.updated_at >= r.updated_at) continue;
        await t.put(r);
        n++;
      }
    });
  } finally {
    applying--;
  }
  return n;
}

async function manifest(): Promise<Record<string, [string, string][]>> {
  const out: Record<string, [string, string][]> = {};
  for (const t of SYNCED) {
    const pairs: [string, string][] = [];
    await db.table(t).each((r: Row) => pairs.push([r.id, r.updated_at]));
    out[t] = pairs;
  }
  return out;
}

async function packRow(table: SyncedTable, r: Row): Promise<Row> {
  if (table !== "documents") return r;
  const { blob, ...rest } = r as unknown as PatientDocument;
  return { ...(rest as unknown as Row), blob_b64: bytesToB64(await blob.arrayBuffer()) };
}
function unpackRow(table: SyncedTable, r: Row): Row {
  if (table !== "documents") return r;
  const { blob_b64, ...rest } = r as Row & { blob_b64: string; mime: string };
  return { ...rest, blob: new Blob([b64ToBytes(blob_b64) as BlobPart], { type: rest.mime }) } as unknown as Row;
}

/* ------------------------------------------------------------------ messages */

type Msg =
  | { t: "hello"; id: string; label: string }
  | { t: "manifest"; m: Record<string, [string, string][]> }
  | { t: "rows"; table: SyncedTable; rows: Row[] }
  | { t: "synced" }
  | { t: "photo-request"; req: string; label: string }
  | { t: "photo"; req: string; name: string; mime: string; b64: string }
  | { t: "photo-end"; req: string };

/* ------------------------------------------------------------------ connexion */

const PEER_PREFIX = "carnet2suivi-";
let peer: PeerT | null = null;
let conn: DataConnection | null = null;
let key: CryptoKey | null = null;
let pairingKey: { raw: string; key: CryptoKey } | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

export const deviceLabel = () => (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "téléphone" : "ordinateur");

async function myId(): Promise<string> {
  let id = await getMeta<string>("peer_id");
  if (!id) {
    id = PEER_PREFIX + b64(crypto.getRandomValues(new Uint8Array(12))).toLowerCase().replace(/[^a-z0-9]/g, "x");
    await setMeta("peer_id", id);
  }
  return id;
}

async function startPeer(): Promise<PeerT> {
  if (peer && !peer.destroyed) {
    if (peer.disconnected) peer.reconnect();
    return peer;
  }
  const { Peer } = await import("peerjs");
  const host = import.meta.env.VITE_PEER_HOST as string | undefined;
  const opts = host
    ? { host: host.split(":")[0], port: Number(host.split(":")[1] ?? 443), path: "/", secure: !/^(localhost|127\.)/.test(host) }
    : {};
  const p = new Peer(await myId(), { ...opts, debug: 0 });
  peer = p;
  await new Promise<void>((resolve, reject) => {
    p.once("open", () => resolve());
    p.once("error", (e) => reject(e));
  }).catch((e: { type?: string }) => {
    peer = null;
    p.destroy();
    throw new Error(
      e.type === "unavailable-id"
        ? "L'application est déjà ouverte dans un autre onglet de cet appareil."
        : "Pas de connexion internet : la liaison reprendra toute seule.",
    );
  });
  p.on("connection", (c) => void accept(c));
  p.on("error", (e: { type?: string }) => {
    if (e.type === "peer-unavailable") set({ status: state.paired ? "waiting" : state.status });
  });
  p.on("disconnected", () => {
    if (!p.destroyed) setTimeout(() => !p.destroyed && p.disconnected && p.reconnect(), 3000);
  });
  return p;
}

/** Connexion entrante : elle doit prouver qu'elle a la clé (premier message déchiffrable). */
async function accept(c: DataConnection) {
  const k = state.paired && c.peer === state.paired.other ? key : pairingKey?.key;
  if (!k) return c.close();
  c.once("data", async (d) => {
    try {
      const hello = await open(k, d as ArrayBuffer);
      if (hello.t !== "hello") throw new Error();
      if (!state.paired || state.paired.other !== hello.id) {
        // Première association, côté ordinateur.
        const p: Pairing = { me: await myId(), other: hello.id, key: pairingKey!.raw, label: hello.label, paired_at: new Date().toISOString() };
        await setMeta("peer_pairing", p);
        key = pairingKey!.key;
        pairingKey = null;
        set({ paired: p });
      }
      if (conn?.open) conn.close();
      void attach(c, false);
    } catch {
      c.close();
    }
  });
}

async function attach(c: DataConnection, initiator: boolean) {
  conn = c;
  const k = key!;
  const send = async (m: Msg) => c.open && c.send(await seal(k, m));
  if (initiator) await send({ t: "hello", id: await myId(), label: deviceLabel() });
  set({ status: "syncing", error: null });
  c.on("data", async (d) => {
    let m: Msg;
    try {
      m = await open(k, d as ArrayBuffer);
    } catch {
      return;
    }
    await handle(m, send);
  });
  c.on("close", () => {
    if (conn === c) conn = null;
    set({ status: state.paired ? "waiting" : "off" });
    scheduleConnect();
  });
  await send({ t: "manifest", m: await manifest() });
}

async function handle(m: Msg, send: (m: Msg) => Promise<unknown>) {
  switch (m.t) {
    case "manifest": {
      const mine = await manifest();
      for (const t of SYNCED) {
        const ids = rowsToSend(mine[t] ?? [], m.m[t] ?? []);
        if (!ids.length) continue;
        const rows = (await db.table(t).bulkGet(ids)).filter(Boolean) as Row[];
        // Documents un par un (photos, PDF), le reste par paquets.
        const size = t === "documents" ? 1 : 200;
        for (let i = 0; i < rows.length; i += size)
          await send({ t: "rows", table: t, rows: await Promise.all(rows.slice(i, i + size).map((r) => packRow(t, r))) });
      }
      await send({ t: "synced" });
      return;
    }
    case "rows": {
      const n = await applyRows(m.table, m.rows.map((r) => unpackRow(m.table, r)));
      if (n) set({ received: state.received + n });
      return;
    }
    case "synced": {
      const at = new Date().toISOString();
      await setMeta("peer_last_sync", at);
      set({ status: "connected", lastSync: at });
      return;
    }
    case "photo-request":
      photoRequest = { req: m.req, label: m.label };
      emitPhoto();
      return;
    case "photo-end":
      if (photoRequest?.req === m.req) {
        photoRequest = null;
        emitPhoto();
      }
      photoHandlers.get(m.req)?.onEnd?.();
      photoHandlers.delete(m.req);
      return;
    case "photo": {
      photoHandlers.get(m.req)?.onPhoto(new Blob([b64ToBytes(m.b64) as BlobPart], { type: m.mime }), m.name);
      return;
    }
  }
}

async function connectNow() {
  const p = state.paired;
  if (!p || conn?.open) return;
  try {
    const pr = await startPeer();
    set({ status: "waiting", error: null });
    // Un seul des deux appareils appelle l'autre (le plus petit identifiant) ; l'autre attend.
    if (p.me < p.other) {
      const c = pr.connect(p.other, { reliable: true, serialization: "binary" });
      c.once("open", () => void attach(c, true));
    }
  } catch (e) {
    set({ error: (e as Error).message });
  }
  scheduleConnect();
}

function scheduleConnect() {
  if (retry) clearTimeout(retry);
  if (!state.paired) return;
  retry = setTimeout(() => {
    if (document.visibilityState === "visible" && !conn?.open) void connectNow();
    else scheduleConnect();
  }, 8000);
}

/* ------------------------------------------------------------------ envoi en direct des modifications */

const dirty = new Map<SyncedTable, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function markDirty(table: SyncedTable, id: string) {
  if (applying || !conn?.open) return;
  if (!dirty.has(table)) dirty.set(table, new Set());
  dirty.get(table)!.add(id);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 600);
}

async function flush() {
  const c = conn;
  if (!c?.open || !key) return;
  const batch = [...dirty.entries()];
  dirty.clear();
  for (const [t, ids] of batch) {
    const rows = (await db.table(t).bulkGet([...ids])).filter(Boolean) as Row[];
    for (const r of rows) c.send(await seal(key, { t: "rows", table: t, rows: [await packRow(t, r)] } satisfies Msg));
  }
  const at = new Date().toISOString();
  set({ lastSync: at });
}

let hooked = false;
function hookTables() {
  if (hooked) return;
  hooked = true;
  for (const t of SYNCED) {
    const table = db.table(t);
    table.hook("creating", function (pk) {
      this.onsuccess = () => markDirty(t, String(pk));
    });
    table.hook("updating", function (_m, pk) {
      this.onsuccess = () => markDirty(t, String(pk));
    });
  }
}

/* ------------------------------------------------------------------ API pour l'interface */

/** Au démarrage de l'application. */
export async function initPeerSync() {
  const p = (await getMeta<Pairing>("peer_pairing")) ?? null;
  set({ paired: p, lastSync: (await getMeta<string>("peer_last_sync")) ?? null });
  if (!p) return;
  key = await importKey(p.key);
  hookTables();
  void connectNow();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !conn?.open) void connectNow();
  });
}

/** Côté ordinateur : prépare l'association et renvoie le contenu du QR code. */
export async function startPairing(): Promise<string> {
  const raw = b64(crypto.getRandomValues(new Uint8Array(32)));
  pairingKey = { raw, key: await importKey(raw) };
  hookTables();
  await startPeer();
  set({ status: "pairing", error: null });
  return `C2S1.${await myId()}.${raw}`;
}

export function cancelPairing() {
  pairingKey = null;
  if (state.status === "pairing") set({ status: state.paired ? "waiting" : "off" });
}

/** Côté téléphone : code lu dans le QR (ou recopié). */
export async function joinPairing(code: string) {
  const m = code.trim().match(/^C2S1\.([a-z0-9-]+)\.([A-Za-z0-9_-]{40,})$/);
  if (!m) throw new Error("Ce code n'est pas un code de liaison Carnet de suivi.");
  const p: Pairing = { me: await myId(), other: m[1]!, key: m[2]!, label: "ordinateur", paired_at: new Date().toISOString() };
  if (p.other === p.me) throw new Error("Scanne ce code avec l'autre appareil.");
  key = await importKey(p.key);
  hookTables();
  const pr = await startPeer();
  await new Promise<void>((resolve, reject) => {
    const c = pr.connect(p.other, { reliable: true, serialization: "binary" });
    const to = setTimeout(() => reject(new Error("L'ordinateur ne répond pas. Vérifie que le code est toujours affiché.")), 20000);
    c.once("open", async () => {
      clearTimeout(to);
      await setMeta("peer_pairing", p);
      set({ paired: p });
      await attach(c, true);
      resolve();
    });
    pr.once("error", (e) => {
      clearTimeout(to);
      reject(new Error((e as { type?: string }).type === "peer-unavailable" ? "L'ordinateur ne répond pas. Vérifie que le code est toujours affiché." : "La liaison a échoué. Réessaie."));
    });
  });
  scheduleConnect();
}

export async function syncAgain() {
  if (conn?.open && key) {
    set({ status: "syncing" });
    conn.send(await seal(key, { t: "manifest", m: await manifest() } satisfies Msg));
  } else void connectNow();
}

export async function unpair() {
  await db.meta.delete("peer_pairing");
  key = null;
  conn?.close();
  conn = null;
  peer?.destroy();
  peer = null;
  set({ paired: null, status: "off" });
}

/* ------------------------------------------------------------------ photo prise avec le téléphone */

let photoRequest: { req: string; label: string } | null = null;
const photoListeners = new Set<() => void>();
const photoHandlers = new Map<string, { onPhoto: (b: Blob, name: string) => void; onEnd?: () => void }>();
function emitPhoto() {
  photoListeners.forEach((l) => l());
}

/** Côté téléphone : demande en cours venant de l'ordinateur. */
export function usePhotoRequest() {
  return useSyncExternalStore(
    (l) => (photoListeners.add(l), () => photoListeners.delete(l)),
    () => photoRequest,
  );
}

/** Côté ordinateur : ouvre l'appareil photo du téléphone ; chaque photo arrive dans onPhoto. Renvoie de quoi arrêter. */
export async function askPhonePhoto(
  label: string,
  onPhoto: (b: Blob, name: string) => void,
  onEnd?: () => void,
): Promise<() => void> {
  if (!conn?.open || !key) throw new Error("Le téléphone n'est pas relié : ouvre l'application dessus.");
  const req = crypto.randomUUID();
  photoHandlers.set(req, { onPhoto, onEnd });
  const c = conn;
  const k = key;
  c.send(await seal(k, { t: "photo-request", req, label } satisfies Msg));
  return () => {
    photoHandlers.delete(req);
    if (c.open) void seal(k, { t: "photo-end", req } satisfies Msg).then((b) => c.send(b));
  };
}

/** Côté téléphone : envoie une photo à l'ordinateur. */
export async function sendPhoto(req: string, blob: Blob, name: string) {
  if (!conn?.open || !key) throw new Error("La liaison avec l'ordinateur est coupée.");
  conn.send(await seal(key, { t: "photo", req, name, mime: blob.type || "image/jpeg", b64: bytesToB64(await blob.arrayBuffer()) } satisfies Msg));
}

export function endPhotoRequest() {
  const r = photoRequest;
  photoRequest = null;
  emitPhoto();
  if (r && conn?.open && key) void seal(key, { t: "photo-end", req: r.req } satisfies Msg).then((b) => conn?.send(b));
}
