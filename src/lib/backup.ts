/**
 * Sauvegarde de tous les dossiers de l'appareil dans un fichier, protégé par un mot de passe.
 * Chiffrement AES-GCM 256 bits, clé dérivée du mot de passe (PBKDF2, 310 000 itérations).
 * Sans le mot de passe, le fichier est illisible : il peut être rangé sur une clé USB.
 */
import { db, getMeta, setMeta } from "./db";
import { TABLES, type PatientDocument, type SyncedRow } from "./types";

const ITERATIONS = 310_000;

type Payload = { app: "carnet2suivi"; version: 1; exported_at: string; data: Record<string, unknown[]> };
type EncryptedFile = {
  app: "carnet2suivi";
  format: "chiffre-v1";
  exported_at: string;
  salt: string;
  iv: string;
  data: string;
};

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(payload: unknown, password: string): Promise<EncryptedFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain);
  return { app: "carnet2suivi", format: "chiffre-v1", exported_at: new Date().toISOString(), salt: b64(salt), iv: b64(iv), data: b64(cipher) };
}

export async function decrypt(file: EncryptedFile, password: string): Promise<Payload> {
  const key = await deriveKey(password, unb64(file.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) as BufferSource }, key, unb64(file.data) as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("Mot de passe incorrect, ou fichier abîmé.");
  }
}

/** Construit le fichier de sauvegarde chiffré de tous les dossiers de l'appareil. */
export async function buildBackup(password: string): Promise<Blob> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  // Documents joints : le fichier est converti en texte pour tenir dans la sauvegarde.
  data.documents = await Promise.all(
    (await db.documents.toArray()).map(async ({ blob, ...d }) => ({ ...d, blob_b64: b64(await readBlob(blob)) })),
  );
  const payload: Payload = { app: "carnet2suivi", version: 1, exported_at: new Date().toISOString(), data };
  const file = await encrypt(payload, password);
  await setMeta("lastBackupAt", new Date().toISOString());
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

export function isEncrypted(json: unknown): json is EncryptedFile {
  return !!json && typeof json === "object" && (json as EncryptedFile).format === "chiffre-v1";
}

/**
 * Restaure une sauvegarde (chiffrée, ou ancienne sauvegarde non chiffrée).
 * Une version plus récente déjà présente sur l'appareil n'est jamais écrasée.
 */
export async function restoreBackup(text: string, password: string | null): Promise<number> {
  let json = JSON.parse(text);
  if (json?.app !== "carnet2suivi") throw new Error("Ce fichier n'est pas une sauvegarde du Carnet de suivi.");
  if (isEncrypted(json)) {
    if (!password) throw new Error("Cette sauvegarde est protégée : indique son mot de passe.");
    json = await decrypt(json, password);
  }
  let n = 0;
  for (const d of (json.data?.documents ?? []) as (Record<string, unknown> & { id: string; updated_at: string; blob_b64: string; mime: string })[]) {
    const local = await db.documents.get(d.id);
    if (local && local.updated_at >= d.updated_at) continue;
    const { blob_b64, ...rest } = d;
    await db.documents.put({ ...rest, blob: new Blob([unb64(blob_b64) as BlobPart], { type: d.mime }) } as unknown as PatientDocument);
    n++;
  }
  await db.transaction("rw", [...TABLES.map((t) => db.table(t)), db.outbox], async () => {
    for (const t of TABLES) {
      const rows = (json.data?.[t] ?? []) as SyncedRow[];
      for (const r of rows) {
        const local = (await db.table(t).get(r.id)) as SyncedRow | undefined;
        if (local && local.updated_at >= r.updated_at) continue;
        await db.table(t).put(r);
        await db.outbox.add({ table: t, row_id: r.id, queued_at: new Date().toISOString() });
        n++;
      }
    }
  });
  return n;
}

export async function daysSinceBackup(): Promise<number | null> {
  const last = await getMeta<string>("lastBackupAt");
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
}
