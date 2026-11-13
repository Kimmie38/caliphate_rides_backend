// The 4-digit sign-in PIN. People confirm a new number once with a code, then create a PIN; after that
// they sign in with number + PIN on any phone (after logging out, reinstalling, or on a new phone).
//
// Guessing is limited: every attempt is counted BEFORE the PIN is checked (so many attempts sent at
// once are all counted), 5 wrong in a row pause it for 30 minutes, and 10 wrong in a row lock it until
// the person resets it with "Forgot PIN" (a code on a phone they've used, or from support).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { normalizeNgPhone } from "./phone.js";

export const PIN_PAUSE_AFTER = 5;
export const PIN_LOCK_AFTER = 10;
export const PIN_PAUSE_MS = 30 * 60 * 1000;

// Easy to guess: every repeated digit, runs, and common patterns.
const WEAK = new Set([
  ...Array.from({ length: 10 }, (_, d) => String(d).repeat(4)),
  "0123", "1234", "2345", "3456", "4567", "5678", "6789", "9876", "8765", "7654", "6543", "5432", "4321", "3210",
  "1212", "2121", "1010", "0101", "1122", "2580", "0852", "1357", "2468", "6969", "1004", "2000", "2020", "2026",
]);

/** Why this PIN can't be used, or null if it's fine. */
export function pinProblem(pin) {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return "Your PIN must be 4 digits.";
  if (WEAK.has(pin)) return "That PIN is too easy to guess. Choose another.";
  return null;
}

export function hashPin(pin) {
  const salt = randomBytes(16);
  return `s1$${salt.toString("hex")}$${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function pinMatches(stored, pin) {
  if (typeof stored !== "string" || typeof pin !== "string") return false;
  const [version, salt, hash] = stored.split("$");
  if (version !== "s1" || !salt || !hash) return false;
  const got = scryptSync(pin, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The fixed code for a test or demo number (TEST_PHONE / DEMO_LOGINS), or null for everyone else. */
export function fixedCode(phone) {
  if (config.testLogin.phone && config.testLogin.code && normalizeNgPhone(config.testLogin.phone) === phone) return config.testLogin.code;
  const demo = config.demoLogins.find(([p]) => normalizeNgPhone(p) === phone);
  return demo ? demo[1] : null;
}

/** Demo and test numbers keep signing in with their fixed code, so they never need a PIN. */
export const needsPin = (user) => !!user?.phone && !user.pinHash && !fixedCode(user.phone);
