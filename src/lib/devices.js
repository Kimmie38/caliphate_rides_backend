// Phones an account has been used on. The app makes a random ID once (kept in secure storage) and sends
// it as X-Device-Id with every request. With SMS_PROVIDER=app, a number that already has an account
// only gets its sign-in code shown on one of its own phones; on any other phone, support has to read
// the code to the person over a call to that number. That stops someone typing another person's
// number on their own phone and getting into that account.
import { User } from "../models/index.js";

export const MAX_DEVICES = 5;
const ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The phone's make and model the app sends (X-Device-Name), e.g. "Tecno Spark 10 Pro", or "". */
export function deviceNameFrom(req) {
  const v = req.headers["x-device-name"];
  if (typeof v !== "string") return "";
  return v.replace(/[^\p{L}\p{N} ()+.,'_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** The name of the phone this account was used on most recently ("" if none is known). */
export function lastDeviceName(user) {
  const named = (user?.devices ?? []).filter((d) => d.name);
  return named.length ? named[named.length - 1].name : "";
}

/** The phone's ID from the request, or "" if it didn't send a valid one. */
export function deviceIdFrom(req) {
  const v = req.headers["x-device-id"];
  return typeof v === "string" && ID.test(v) ? v : "";
}

/** True if this account has been used on that phone, or hasn't recorded any phone yet. */
export function knowsDevice(user, deviceId) {
  const list = user?.devices ?? [];
  if (!list.length) return true;
  return !!deviceId && list.some((d) => d.id === deviceId);
}

/** Remembers that the account is used on this phone (keeps the newest MAX_DEVICES). */
export async function rememberDevice(user, deviceId, name = "") {
  if (!deviceId || !user?._id) return;
  const known = (user.devices ?? []).find((d) => d.id === deviceId);
  if (known) {
    if (name && !known.name) await User.updateOne({ _id: user._id, "devices.id": deviceId }, { $set: { "devices.$.name": name } });
    return; // already known: no write
  }
  await User.updateOne(
    { _id: user._id },
    { $push: { devices: { $each: [{ id: deviceId, name, lastSeenAt: new Date() }], $slice: -MAX_DEVICES } } },
  );
}

/** Ranks how well a phone number has been confirmed; a weaker check never replaces a stronger one. */
const STRENGTH = { "": 0, demo: 1, app: 1, support: 2, sms: 2, whatsapp: 2 };
export const strongerCheck = (current, next) => ((STRENGTH[next] ?? 0) > (STRENGTH[current ?? ""] ?? 0) ? next : current ?? "");
