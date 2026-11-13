//   GET   /me           -> { user }
//   PATCH /me { name?, email?, language? ("en" | "ha") }  -> { user }
//   POST /me/pin { pin, currentPin? } -> { user }   (create or change the sign-in PIN)
//   DELETE /me          -> { deleted: true }   (deletes the account; see src/services/deleteAccount.js)
import { hashPin, pinMatches, pinProblem } from "../lib/pin.js";
import { deleteAccount } from "../services/deleteAccount.js";
import { Router } from "express";
import { userDTO } from "../lib/serialize.js";
import { badRequest } from "../lib/errors.js";
import { obj, text } from "../lib/validate.js";
import { requireUser } from "../middleware/auth.js";

export const meRouter = Router();
meRouter.use(requireUser);

meRouter.get("/", (req, res) => {
  res.json({ user: userDTO(req.user) });
});

meRouter.patch("/", async (req, res) => {
  const body = obj(req.body);
  if (body.name !== undefined) req.user.name = text(body.name, "Your name", { min: 2, max: 80 });
  if (body.email !== undefined) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw badRequest("Enter a valid email address, or leave it empty.", "invalid_email");
    if (email.length > 120) throw badRequest("That email address is too long.", "invalid_email");
    req.user.email = email;
  }
  if (body.language !== undefined) {
    if (body.language !== "en" && body.language !== "ha") throw badRequest("Language must be en or ha.", "invalid_language");
    req.user.language = body.language;
  }
  await req.user.save();
  res.json({ user: userDTO(req.user) });
});

// Creates or changes the 4-digit sign-in PIN. Changing it needs the current one.
meRouter.post("/pin", async (req, res) => {
  const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
  const problem = pinProblem(pin);
  if (problem) throw badRequest(problem, "weak_pin");
  if (req.user.pinHash) {
    const current = typeof req.body?.currentPin === "string" ? req.body.currentPin.trim() : "";
    if (!pinMatches(req.user.pinHash, current)) throw badRequest("Your current PIN isn't right.", "wrong_pin");
  }
  Object.assign(req.user, { pinHash: hashPin(pin), pinSetAt: new Date(), pinFails: 0, pinLocked: false, pinPausedUntil: null });
  await req.user.save();
  res.json({ user: userDTO(req.user) });
});

// Deletes the account (see src/services/deleteAccount.js). The app then signs out.
meRouter.delete("/", async (req, res) => {
  await deleteAccount(req.user);
  res.json({ deleted: true });
});
