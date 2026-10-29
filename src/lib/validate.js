// Small input checks. Each throws a 400 with a message the app can show as written.
import { badRequest } from "./errors.js";

export function obj(value, what = "Request") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest(`${what} is missing or isn't valid.`);
  return value;
}

export function text(value, label, { min = 0, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional || min === 0) return "";
    throw badRequest(`${label} is required.`);
  }
  if (typeof value !== "string") throw badRequest(`${label} must be text.`);
  const v = value.trim();
  if (v.length < min) throw badRequest(min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
  if (v.length > max) throw badRequest(`${label} must be ${max} characters or fewer.`);
  return v;
}

export function int(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) throw badRequest(`${label} must be a whole number.`);
  if (n < min || n > max) throw badRequest(`${label} must be between ${min} and ${max}.`);
  return n;
}

export function oneOf(value, label, options) {
  if (!options.includes(value)) throw badRequest(`${label} must be one of: ${options.join(", ")}.`);
  return value;
}

export function bool(value, label) {
  if (typeof value !== "boolean") throw badRequest(`${label} must be true or false.`);
  return value;
}

/** A place sent by the app: { name, latitude, longitude }. */
export function point(value, label) {
  const p = obj(value, label);
  const latitude = Number(p.latitude);
  const longitude = Number(p.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw badRequest(`${label} has an invalid location.`);
  }
  const name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 120) : "Pinned location";
  return { name, latitude, longitude };
}
