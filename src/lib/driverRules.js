// Driver sign-up rules: which documents are needed, how each section is checked, and what stops
// a driver going online. Ported from the app (src/driver/config/requirements.ts and lib/validate.ts)
// so the app and the server always agree. The server's check is the one that counts.
import { normalizeNgPhone } from "./phone.js";

export const MIN_DRIVER_AGE = 18;
export const EXPIRY_WARNING_DAYS = 30;

export const DOCUMENT_KINDS = ["licence", "selfie", "vehicle_photo", "vehicle_licence", "ownership", "insurance", "roadworthiness", "operating_permit"];

export const DOCUMENTS = [
  { kind: "licence", title: "Driver's licence", photos: 2, needsNumber: "Licence number", needsExpiry: true, required: () => true, blocksDriving: true },
  { kind: "selfie", title: "Profile photo", photos: 1, needsExpiry: false, required: () => true, blocksDriving: false },
  { kind: "vehicle_photo", title: "Vehicle photo", photos: 1, needsExpiry: false, required: () => true, blocksDriving: false },
  { kind: "vehicle_licence", title: "Vehicle licence", photos: 1, needsExpiry: true, required: () => true, blocksDriving: true },
  { kind: "ownership", title: "Proof of ownership", photos: 1, needsExpiry: false, required: () => true, blocksDriving: false },
  { kind: "insurance", title: "Insurance certificate", photos: 1, needsNumber: "Policy number", needsExpiry: true, required: () => true, blocksDriving: true },
  { kind: "roadworthiness", title: "Roadworthiness certificate", photos: 1, needsExpiry: true, required: (v) => v === "car", blocksDriving: true },
  { kind: "operating_permit", title: "Commercial operating permit", photos: 1, needsNumber: "Permit number", needsExpiry: true, required: () => false, blocksDriving: false },
];

export const documentRequirement = (kind) => DOCUMENTS.find((d) => d.kind === kind);

/** Documents that apply to this vehicle (required ones, plus the optional keke permit). */
export function documentsFor(vehicleType, ownsVehicle) {
  return DOCUMENTS.filter((d) => d.required(vehicleType, ownsVehicle) || (vehicleType === "keke" && d.kind === "operating_permit"));
}

export const SOKOTO_LGAS = [
  "Binji", "Bodinga", "Dange Shuni", "Gada", "Goronyo", "Gudu", "Gwadabawa", "Illela", "Isa", "Kebbe",
  "Kware", "Rabah", "Sabon Birni", "Shagari", "Silame", "Sokoto North", "Sokoto South", "Tambuwal",
  "Tangaza", "Tureta", "Wamako", "Wurno", "Yabo",
];

export const BANKS = [
  "Access Bank", "Ecobank", "Fidelity Bank", "First Bank", "FCMB", "Globus Bank", "GTBank", "Jaiz Bank",
  "Keystone Bank", "Kuda", "Moniepoint", "OPay", "PalmPay", "Polaris Bank", "Providus Bank", "Stanbic IBTC",
  "Sterling Bank", "TAJBank", "Union Bank", "UBA", "Unity Bank", "Wema Bank", "Zenith Bank",
];

export const RELATIONSHIPS = ["Parent", "Brother or sister", "Spouse", "Uncle or aunt", "Employer", "Community leader", "Friend", "Other"];

// ---------- dates (stored as YYYY-MM-DD) ----------

export function isIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const DAY = 86400000;
const startOfToday = (now = new Date()) => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

/** Whole days from today until the date (negative = already past). */
export function daysUntil(iso, now = new Date()) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - startOfToday(now)) / DAY);
}

export function ageOn(dobIso, now = new Date()) {
  const [y, m, d] = dobIso.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

// ---------- section checks: each returns { field: message }, empty = valid ----------

const words = (s) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

export function validatePersonal(p) {
  const e = {};
  if (words(p.fullName) < 2) e.fullName = "Enter your full name as it appears on your licence.";
  if (!isIsoDate(p.dateOfBirth)) e.dateOfBirth = "Enter your date of birth as DD/MM/YYYY.";
  else if (ageOn(p.dateOfBirth) < MIN_DRIVER_AGE) e.dateOfBirth = `You need to be at least ${MIN_DRIVER_AGE} to drive with Caliphate Rides.`;
  else if (ageOn(p.dateOfBirth) > 90) e.dateOfBirth = "Check the year of your date of birth.";
  if (!p.gender) e.gender = "Choose one.";
  if ((p.address ?? "").trim().length < 8) e.address = "Enter your house address, including the area.";
  if (!p.lga) e.lga = "Choose your local government area.";
  if (!/^\d{11}$/.test(p.nin ?? "")) e.nin = "Your NIN has 11 digits. Dial *346# to get it if you don't have your slip.";
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) e.email = "Check the email address, or leave it empty.";
  return e;
}

/** Nigerian plates look like "ABC 123 XY". */
export function normalizePlate(input) {
  const s = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]{3})(\d{2,3})([A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : (input ?? "").toUpperCase().trim();
}

export function validateVehicle(v) {
  const e = {};
  if (!(v.make ?? "").trim()) e.make = "Enter the make, e.g. Bajaj or Toyota.";
  if (!(v.model ?? "").trim()) e.model = "Enter the model, e.g. RE or Corolla.";
  const y = Number(v.year);
  if (!/^\d{4}$/.test(v.year ?? "") || y < 1990 || y > new Date().getFullYear() + 1) e.year = "Enter the year it was made, e.g. 2019.";
  if (!(v.colour ?? "").trim()) e.colour = "Enter the colour.";
  if (!/^[A-Z]{3} \d{2,3} [A-Z]{2}$/.test(normalizePlate(v.plate))) e.plate = "Enter the plate number like ABC 123 XY.";
  return e;
}

export function validateGuarantor(g, driverPhone) {
  const e = {};
  if (words(g.fullName) < 2) e.fullName = "Enter your guarantor's full name.";
  const ph = normalizeNgPhone(g.phone ?? "");
  if (!ph) e.phone = "Enter a Nigerian mobile number.";
  else if (driverPhone && ph === driverPhone) e.phone = "Your guarantor needs their own phone number, not yours.";
  if (!g.relationship) e.relationship = "Choose how you know them.";
  if ((g.address ?? "").trim().length < 8) e.address = "Enter their house address.";
  return e;
}

export function validateBank(b) {
  const e = {};
  if (!b.bankName) e.bankName = "Choose your bank.";
  if (!/^\d{10}$/.test(b.accountNumber ?? "")) e.accountNumber = "Account numbers have 10 digits.";
  if (words(b.accountName) < 2) e.accountName = "Enter the account name exactly as your bank shows it.";
  return e;
}

/** Checks one document upload's details (photos are checked by the upload route). */
export function validateDocumentDetails(req, { number, expiry }) {
  const e = {};
  if (req.needsNumber && !(number ?? "").trim()) e.number = `Enter the ${req.needsNumber.toLowerCase()}.`;
  if (req.needsExpiry) {
    if (!isIsoDate(expiry)) e.expiry = "Enter the expiry date as DD/MM/YYYY.";
    else if (daysUntil(expiry) < 0) e.expiry = "This document has expired. Renew it, then upload the new one.";
  }
  return e;
}

/** What's still missing before the application can be submitted (titles, in sign-up order). */
export function missingSections(app, driverPhone = "") {
  const missing = [];
  if (!app.vehicleType) missing.push("Vehicle type");
  if (Object.keys(validatePersonal(app.personal ?? {})).length) missing.push("Personal details");
  if (Object.keys(validateVehicle(app.vehicle ?? {})).length) missing.push("Vehicle details");
  if (app.vehicleType) {
    for (const d of documentsFor(app.vehicleType, app.vehicle?.ownsVehicle ?? true)) {
      if (d.required(app.vehicleType, app.vehicle?.ownsVehicle ?? true) && !app.documents?.[d.kind]?.current) missing.push(d.title);
    }
  }
  if (Object.keys(validateGuarantor(app.guarantor ?? {}, driverPhone)).length) missing.push("Guarantor");
  if (Object.keys(validateBank(app.bank ?? {})).length) missing.push("Bank account");
  return missing;
}

/** Documents stopping an approved driver from going online (missing approval or expired). */
export function drivingBlockers(app) {
  if (!app?.vehicleType) return [];
  const out = [];
  for (const d of DOCUMENTS) {
    if (!d.blocksDriving || !d.required(app.vehicleType, app.vehicle?.ownsVehicle ?? true)) continue;
    const doc = app.documents?.[d.kind];
    const versions = [doc?.current, ...(doc?.history ?? [])].filter(Boolean);
    const valid = versions.find((v) => v.status === "approved" && (!v.expiry || daysUntil(v.expiry) >= 0));
    if (!valid) {
      const expired = versions.some((v) => v.expiry && daysUntil(v.expiry) < 0);
      out.push({ kind: d.kind, title: d.title, reason: expired ? "expired" : "not approved yet" });
    }
  }
  return out;
}
