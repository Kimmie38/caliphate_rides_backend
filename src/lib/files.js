// Driver documents (licences, insurance…) are private. The API hands out short-lived signed links
// instead of public URLs: /files/<name>?exp=<unix seconds>&sig=<hmac>.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const LINK_SECONDS = 60 * 60; // links work for an hour

const sign = (name, exp) => createHmac("sha256", `${config.jwtSecret}:files`).update(`${name}:${exp}`).digest("base64url");

export function signedFileUrl(name, seconds = LINK_SECONDS) {
  if (!name) return "";
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `${config.publicUrl}/files/${encodeURIComponent(name)}?exp=${exp}&sig=${sign(name, exp)}`;
}

export function validFileSignature(name, exp, sig) {
  const e = Number(exp);
  if (!Number.isInteger(e) || e < Math.floor(Date.now() / 1000) || typeof sig !== "string") return false;
  const a = Buffer.from(sign(name, e));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only names we generated: 32 hex characters plus an image extension. */
export const safeFileName = (name) => /^[a-f0-9]{32}\.(jpg|jpeg|png|webp|heic)$/.test(name);
