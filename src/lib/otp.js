// One-time sign-in codes. Only a salted hash is stored, never the code itself.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000; // a code works for 5 minutes
export const OTP_MAX_ATTEMPTS = 5; // wrong guesses before the code is thrown away
export const OTP_RESEND_MS = 45 * 1000; // minimum gap between codes to one phone
export const OTP_MAX_PER_HOUR = 5;

export const newCode = () => String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

export const hashCode = (phone, code, secret) => createHash("sha256").update(`${phone}:${code}:${secret}`).digest("hex");

export function codeMatches(storedHash, phone, code, secret) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashCode(phone, code, secret), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
