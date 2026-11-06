// Logique pure de la reprise des e-mails (sans dépendance : testée avec vitest).

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
  snippet?: string;
};

export type Contact = { email: string; patient_id: string };

export type ParsedMail = {
  external_id: string;
  thread_id: string;
  occurred_at: string;
  direction: "entrant" | "sortant";
  counterpart: string;
  counterpart_email: string;
  subject: string;
  body: string;
};

export function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Toutes les adresses e-mail d'un en-tête « From/To/Cc », en minuscules. */
export function addresses(value: string): string[] {
  return [...value.matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase());
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data && !part.filename) return part;
  for (const p of part.parts ?? []) {
    const f = findPart(p, mime);
    if (f) return f;
  }
  return undefined;
}

/** Texte du message : partie texte brut, sinon HTML converti en texte, sinon extrait. */
export function bodyText(msg: GmailMessage, max = 20_000): string {
  const plain = findPart(msg.payload, "text/plain");
  let text = plain?.body?.data ? decodeBase64Url(plain.body.data) : "";
  if (!text) {
    const html = findPart(msg.payload, "text/html");
    if (html?.body?.data) {
      text = decodeBase64Url(html.body.data)
        .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
    }
  }
  if (!text) text = msg.snippet ?? "";
  // On retire l'historique cité (« Le … a écrit : » et lignes « > »).
  const cut = text.search(/\n(Le .{5,120} a écrit\s*:|On .{5,120} wrote\s*:)/);
  if (cut > 0) text = text.slice(0, cut);
  text = text
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Prépare un message Gmail pour le journal des échanges.
 * Renvoie null si le message ne concerne aucune adresse connue et n'est pas
 * explicitement marqué pour le cabinet (libellé Gmail) : la boîte personnelle
 * n'entre jamais dans le dossier.
 */
export function parseMail(
  msg: GmailMessage,
  ownEmail: string,
  contacts: Contact[],
  labelId: string | null,
): (ParsedMail & { patient_id: string | null }) | null {
  const own = ownEmail.toLowerCase();
  const from = addresses(header(msg, "From"));
  const to = [...addresses(header(msg, "To")), ...addresses(header(msg, "Cc"))];
  const outgoing = from.includes(own);
  const others = (outgoing ? to : from).filter((a) => a !== own);
  const byEmail = new Map(contacts.map((c) => [c.email.toLowerCase(), c.patient_id]));
  const matched = others.find((a) => byEmail.has(a));
  const labelled = labelId !== null && (msg.labelIds ?? []).includes(labelId);
  if (!matched && !labelled) return null;

  const counterpartEmail = matched ?? others[0] ?? "";
  const rawName = (outgoing ? header(msg, "To") : header(msg, "From")).split(",")[0] ?? "";
  const name = rawName.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
  return {
    external_id: `gmail:${msg.id}`,
    thread_id: msg.threadId,
    occurred_at: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    direction: outgoing ? "sortant" : "entrant",
    counterpart: name && name.toLowerCase() !== counterpartEmail ? `${name} <${counterpartEmail}>` : counterpartEmail,
    counterpart_email: counterpartEmail,
    subject: header(msg, "Subject").slice(0, 500),
    body: bodyText(msg),
    patient_id: matched ? byEmail.get(matched)! : null,
  };
}

/** Encode un e-mail (RFC 2822) pour l'envoi par l'API Gmail. */
export function buildRawEmail(opts: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  inReplyTo?: string | null;
}): string {
  const enc = (s: string) => `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(", ")}`,
    `Subject: ${enc(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`);
  const bytes = new TextEncoder().encode(opts.text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const raw = `${lines.join("\r\n")}\r\n\r\n${btoa(bin)}`;
  return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
