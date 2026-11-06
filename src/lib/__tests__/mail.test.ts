import { describe, expect, it } from "vitest";
import { buildRawEmail, parseMail, type GmailMessage } from "../../../supabase/functions/_shared/mail-core";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64url");
const msg = (from: string, to: string, text: string, labels: string[] = []): GmailMessage => ({
  id: "m1",
  threadId: "t1",
  internalDate: String(Date.parse("2026-11-05T10:00:00Z")),
  labelIds: labels,
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "To", value: to },
      { name: "Subject", value: "Séance de jeudi" },
    ],
    parts: [{ mimeType: "text/plain", body: { data: b64(text) } }],
  },
});

const contacts = [{ email: "maman.durand@mail.fr", patient_id: "p1" }];

describe("reprise des e-mails", () => {
  it("rattache un e-mail reçu d'une famille connue et retire l'historique cité", () => {
    const r = parseMail(
      msg('"Claire Durand" <Maman.Durand@mail.fr>', "praticienne@cabinet.fr", "Bonjour, Léo sera absent.\n\nLe 4 nov. 2026, la praticienne a écrit :\n> ancien message"),
      "praticienne@cabinet.fr",
      contacts,
      null,
    );
    expect(r?.patient_id).toBe("p1");
    expect(r?.direction).toBe("entrant");
    expect(r?.body).toBe("Bonjour, Léo sera absent.");
    expect(r?.counterpart).toBe("Claire Durand <maman.durand@mail.fr>");
  });

  it("reconnaît un e-mail envoyé", () => {
    const r = parseMail(msg("praticienne@cabinet.fr", "maman.durand@mail.fr", "Bonjour"), "praticienne@cabinet.fr", contacts, null);
    expect(r?.direction).toBe("sortant");
  });

  it("ignore la boîte personnelle, sauf les e-mails marqués du libellé du cabinet", () => {
    const perso = msg("banque@exemple.fr", "praticienne@cabinet.fr", "Relevé");
    expect(parseMail(perso, "praticienne@cabinet.fr", contacts, "Label_1")).toBeNull();
    const marked = msg("ecole@exemple.fr", "praticienne@cabinet.fr", "Réunion ESS", ["Label_1"]);
    expect(parseMail(marked, "praticienne@cabinet.fr", contacts, "Label_1")?.patient_id).toBeNull();
  });

  it("prépare un e-mail lisible avec accents", () => {
    const raw = buildRawEmail({ from: "a@b.fr", to: ["c@d.fr"], subject: "Séance du 05/11", text: "Très bien passé." });
    const decoded = Buffer.from(raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: c@d.fr");
    expect(decoded).toContain("=?UTF-8?B?");
    const body = decoded.split("\r\n\r\n")[1]!;
    expect(Buffer.from(body, "base64").toString("utf-8")).toBe("Très bien passé.");
  });
});
