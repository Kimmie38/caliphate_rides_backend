//   GET   /me           -> { user }
//   PATCH /me { name?, email?, language? ("en" | "ha") }  -> { user }
//   Add a phone number with WhatsApp (accounts made by email need one to book or drive):
//     POST /me/phone/whatsapp/start                    -> { checkId, secret, code, link, number, message, expiresIn }
//     POST /me/phone/whatsapp/check { checkId, secret }  -> { status: "pending" } | { status: "confirmed", user }
//   Add or change the email used to sign in (confirmed with a code):
//     POST /me/sign-in-email/request { email, lang? }    -> { expiresIn }
//     POST /me/sign-in-email/verify  { email, code }     -> { user }
import { Router } from "express";
import { userDTO } from "../lib/serialize.js";
import { badRequest, conflict } from "../lib/errors.js";
import { whatsappReady } from "../lib/whatsapp.js";
import { User } from "../models/index.js";
import { emailFrom, checkEmailCode, sendEmailCode, startWhatsAppCheck, takeWhatsAppCheck } from "../services/signin.js";
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

meRouter.post("/phone/whatsapp/start", async (req, res) => {
  if (!whatsappReady()) throw badRequest("WhatsApp isn't switched on yet. Call support to add your number.", "whatsapp_off");
  res.json(await startWhatsAppCheck("link", req.user));
});

meRouter.post("/phone/whatsapp/check", async (req, res) => {
  const r = await takeWhatsAppCheck(req.body, "link", req.user);
  if (r.status === "pending") return res.json(r);
  const other = await User.findOne({ phone: r.phone, _id: { $ne: req.user._id } });
  if (other) throw conflict("That WhatsApp number already has a Caliphate Rides account. Log out and continue with WhatsApp to use it.", "phone_taken");
  req.user.phone = r.phone;
  await req.user.save();
  res.json({ status: "confirmed", user: userDTO(req.user) });
});

meRouter.post("/sign-in-email/request", async (req, res) => {
  const email = emailFrom(req.body);
  if (await User.exists({ signInEmail: email, _id: { $ne: req.user._id } })) throw conflict("Another account already signs in with that email.", "email_taken");
  res.json(await sendEmailCode(email, req.body?.lang ?? req.user.language));
});

meRouter.post("/sign-in-email/verify", async (req, res) => {
  const email = emailFrom(req.body);
  await checkEmailCode(email, req.body?.code);
  if (await User.exists({ signInEmail: email, _id: { $ne: req.user._id } })) throw conflict("Another account already signs in with that email.", "email_taken");
  req.user.signInEmail = email;
  if (!req.user.email) req.user.email = email;
  await req.user.save();
  res.json({ user: userDTO(req.user) });
});
