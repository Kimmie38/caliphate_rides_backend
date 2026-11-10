// WhatsApp sign-in, receive-only. The app shows a short code; the person sends it to our WhatsApp
// Business number; Meta calls our webhook with the message, and we note which number sent it.
// Messages people send to a business are free on WhatsApp's official API (Cloud API).
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { log } from "./log.js";
import { normalizeNgPhone } from "./phone.js";

/** Letters and digits that can't be confused when read aloud or typed (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const newCheckCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const newSecret = () => randomBytes(24).toString("base64url");

export const whatsappReady = () => !!(config.whatsapp.number && config.whatsapp.appSecret && config.whatsapp.verifyToken);

/** The text the app pre-fills in WhatsApp. The code is what matters; the words help the person. */
export const messageFor = (code) => `Caliphate Rides code: ${code}`;
/** https://wa.me link that opens a chat with our number and the message typed in. */
export const chatLink = (code) => `https://wa.me/${config.whatsapp.number}?text=${encodeURIComponent(messageFor(code))}`;

/**
 * Possible codes in a message: whole 8-character words, or two pieces typed with a space or dash
 * ("K4M9 Q2XT"). The webhook checks each against the pending codes.
 */
export function codesIn(text) {
  if (typeof text !== "string") return [];
  const ok = /^[2-9A-HJKMNP-Z]+$/;
  const words = text.toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
  const out = new Set();
  words.forEach((w, i) => {
    if (w.length === 8 && ok.test(w)) out.add(w);
    const joined = w + (words[i + 1] ?? "");
    if (words[i + 1] && joined.length === 8 && ok.test(joined)) out.add(joined);
  });
  return [...out];
}

/** True when the webhook body was signed by Meta with our app secret (X-Hub-Signature-256). */
export function validSignature(rawBody, header) {
  if (!config.whatsapp.appSecret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", config.whatsapp.appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Text messages in a webhook payload: [{ from: "+2348031234567", text, id }]. */
export function messagesIn(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      if (!v?.messages) continue;
      if (config.whatsapp.phoneNumberId && v.metadata?.phone_number_id && v.metadata.phone_number_id !== config.whatsapp.phoneNumberId) continue;
      for (const m of v.messages) {
        const raw = String(m.from ?? "").replace(/\D/g, "");
        if (!raw) continue;
        const text = m.type === "text" ? m.text?.body : m.type === "button" ? m.button?.text : m.type === "interactive" ? (m.interactive?.button_reply?.title ?? "") : "";
        out.push({ from: normalizeNgPhone(raw) ?? `+${raw}`, text: text ?? "", id: m.id });
      }
    }
  }
  return out;
}

/** Optional "you're confirmed" reply (WHATSAPP_REPLY=true). Never blocks sign-in if it fails. */
export async function reply(toPhone, text) {
  const wa = config.whatsapp;
  if (!wa.reply || !wa.accessToken || !wa.phoneNumberId) return;
  try {
    const res = await fetch(`https://graph.facebook.com/${wa.graphVersion}/${wa.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${wa.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: toPhone.replace(/\D/g, ""), type: "text", text: { body: text } }),
    });
    if (!res.ok) log.warn("WhatsApp reply not sent", { status: res.status, body: (await res.text().catch(() => "")).slice(0, 200) });
  } catch (err) {
    log.warn("WhatsApp reply not sent", { err: err.message });
  }
}
