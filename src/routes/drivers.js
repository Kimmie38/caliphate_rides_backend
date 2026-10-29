// A driver's official onboarding record. All need sign-in.
//   GET  /drivers/me/application                      -> { application | null }
//   PUT  /drivers/me/application  (draft fields)      -> { application }
//   POST /drivers/me/documents    multipart: kind, number?, expiry?, files[]  -> { application }
//   POST /drivers/me/application/submit { signedName } -> { application }
import { Router } from "express";
import { badRequest, conflict } from "../lib/errors.js";
import {
  BANKS, DOCUMENT_KINDS, RELATIONSHIPS, SOKOTO_LGAS, documentRequirement, isIsoDate,
  missingSections, normalizePlate, validateDocumentDetails,
} from "../lib/driverRules.js";
import { applicationDTO } from "../lib/serialize.js";
import { discardUploads, storeUploads } from "../lib/storage.js";
import { log } from "../lib/log.js";
import { verifyDriverBank } from "../services/driverMoney.js";
import { obj } from "../lib/validate.js";
import { requireUser } from "../middleware/auth.js";
import { documentUpload } from "../middleware/upload.js";
import { Driver, nextSeq } from "../models/index.js";

export const driversRouter = Router();
driversRouter.use(requireUser);

const EDITABLE = ["draft", "changes_requested"];
const event = (text, by) => ({ at: new Date(), event: text, ...(by ? { by } : {}) });

/** A short trimmed string, or "" (the app sends empty strings for unfilled fields). */
const s = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const choice = (v, options) => (options.includes(v) ? v : "");

async function newRecordId() {
  const year = new Date().getFullYear();
  const n = await nextSeq(`driver-record-${year}`);
  return `CR-DRV-${year}-${String(n).padStart(6, "0")}`;
}

/** The signed-in person's record, created on first save. */
async function findOrCreate(user) {
  const existing = await Driver.findOne({ user: user._id });
  if (existing) return existing;
  try {
    return await Driver.create({
      user: user._id,
      recordId: await newRecordId(),
      personal: { fullName: user.name ?? "" },
      timeline: [event("Application started")],
    });
  } catch (err) {
    if (err?.code === 11000) return Driver.findOne({ user: user._id }); // two saves at once
    throw err;
  }
}

driversRouter.get("/me/application", async (req, res) => {
  const driver = await Driver.findOne({ user: req.user._id });
  res.json({ application: driver ? applicationDTO(driver) : null });
});

driversRouter.put("/me/application", async (req, res) => {
  const body = obj(req.body);
  const driver = await findOrCreate(req.user);
  if (!EDITABLE.includes(driver.status)) throw conflict("Your application has been sent for review, so it can't be changed now.", "not_editable");

  if (body.vehicleType !== undefined) driver.vehicleType = choice(body.vehicleType, ["keke", "car"]) || undefined;
  if (body.personal) {
    const p = obj(body.personal, "Personal details");
    driver.personal = {
      fullName: s(p.fullName, 80),
      dateOfBirth: isIsoDate(p.dateOfBirth) ? p.dateOfBirth : "",
      gender: choice(p.gender, ["male", "female"]),
      address: s(p.address, 240),
      lga: choice(p.lga, SOKOTO_LGAS),
      nin: s(p.nin, 11).replace(/\D/g, ""),
      email: s(p.email, 120).toLowerCase(),
    };
  }
  if (body.vehicle) {
    const v = obj(body.vehicle, "Vehicle details");
    driver.vehicle = {
      make: s(v.make, 40), model: s(v.model, 40), year: s(v.year, 4), colour: s(v.colour, 30),
      plate: normalizePlate(s(v.plate, 12)),
      ownsVehicle: typeof v.ownsVehicle === "boolean" ? v.ownsVehicle : true,
    };
  }
  if (body.guarantor) {
    const g = obj(body.guarantor, "Guarantor");
    driver.guarantor = { fullName: s(g.fullName, 80), phone: s(g.phone, 20), relationship: choice(g.relationship, RELATIONSHIPS), address: s(g.address, 240) };
  }
  let bankChanged = false;
  if (body.bank) {
    const b = obj(body.bank, "Bank account");
    const next = { bankName: choice(b.bankName, BANKS), accountNumber: s(b.accountNumber, 10).replace(/\D/g, ""), accountName: s(b.accountName, 80) };
    bankChanged = next.bankName !== driver.bank?.bankName || next.accountNumber !== driver.bank?.accountNumber;
    // A new account has to be checked with the bank again before any payout.
    driver.bank = bankChanged ? next : { ...(driver.bank?.toObject?.() ?? driver.bank ?? {}), ...next };
  }
  await driver.save();
  if (bankChanged && /^\d{10}$/.test(driver.bank.accountNumber) && driver.bank.bankName) {
    verifyDriverBank(driver).catch((err) => log.error("bank check failed", { err: err.message }));
  }
  res.json({ application: applicationDTO(driver) });
});

driversRouter.post("/me/documents", documentUpload, async (req, res) => {
  const files = req.files ?? [];
  try {
    const kind = req.body?.kind;
    if (!DOCUMENT_KINDS.includes(kind)) throw badRequest("Choose which document this is.", "invalid_kind");
    const reqs = documentRequirement(kind);
    if (files.length < reqs.photos) throw badRequest(reqs.photos > 1 ? "Add a photo of each side." : "Add a photo.", "missing_photos");
    const number = s(req.body.number, 40);
    const expiry = s(req.body.expiry, 10);
    const errors = validateDocumentDetails(reqs, { number, expiry });
    const first = Object.values(errors)[0];
    if (first) throw badRequest(first, "invalid_document");

    const driver = await findOrCreate(req.user);
    if (["submitted", "rejected"].includes(driver.status)) throw conflict("Your application is being reviewed. You can update documents once it's decided.", "under_review");

    await storeUploads(files);
    const version = {
      files: files.map((f) => f.filename),
      ...(reqs.needsNumber ? { number } : {}),
      ...(reqs.needsExpiry ? { expiry } : {}),
      uploadedAt: new Date(),
      status: "pending",
    };
    const prev = driver.documents.get(kind);
    const history = prev?.current ? [prev.current, ...(prev.history ?? [])] : prev?.history ?? [];
    driver.documents.set(kind, { kind, current: version, history });
    // Renewals after approval go to the review team; the record shows each version.
    if (["approved", "suspended"].includes(driver.status)) driver.timeline.unshift(event(`${reqs.title} updated and sent for review`));
    await driver.save();
    res.status(201).json({ application: applicationDTO(driver) });
  } catch (err) {
    await discardUploads(files).catch(() => {});
    throw err;
  }
});

driversRouter.post("/me/application/submit", async (req, res) => {
  const driver = await Driver.findOne({ user: req.user._id });
  if (!driver) throw badRequest("Fill in your application first.", "no_application");
  if (!EDITABLE.includes(driver.status)) throw conflict("Your application has already been sent.", "already_submitted");

  const plain = driver.toObject({ flattenMaps: true });
  const missing = missingSections(plain, req.user.phone);
  if (missing.length) throw badRequest(`Still to do: ${missing.join(", ")}.`, "incomplete");

  const signedName = s(req.body?.signedName, 80);
  if (!signedName || signedName.toLowerCase() !== driver.personal.fullName.trim().toLowerCase()) {
    throw badRequest("Type your full name exactly as above to sign.", "signature_mismatch");
  }

  const resubmit = driver.status === "changes_requested";
  driver.status = "submitted";
  driver.declaration = { signedName, signedAt: new Date() };
  driver.submittedAt = new Date();
  driver.reviewNote = undefined;
  driver.timeline.unshift(event(resubmit ? "Changes sent for review" : "Application submitted for review", driver.personal.fullName));
  await driver.save();
  res.json({ application: applicationDTO(driver) });
});
