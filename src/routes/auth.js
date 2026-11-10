// Signing in. Three ways in, all ending with { token, user, isNewUser }:
//   GET  /auth/methods                          -> { whatsapp, email, sms, whatsappNumber }  which ones are switched on
//   WhatsApp (free): the app shows a code, the person sends it to our WhatsApp number, the app checks.
//     POST /auth/whatsapp/start                 -> { checkId, secret, code, link, number, message, expiresIn }
//     POST /auth/whatsapp/check { checkId, secret } -> { status: "pending" } | { status: "confirmed", token, user, isNewUser }
//   Email (free): a 6-digit code by email.
//     POST /auth/email/request { email, lang? } -> { expiresIn }
//     POST /auth/email/verify  { email, code }  -> { token, user, isNewUser }
//   Phone code by SMS (Termii, paid), and the demo numbers in DEMO_LOGINS:
//     POST /auth/otp/request { phone }          -> { expiresIn }
//     POST /auth/otp/verify  { phone, code }    -> { token, user, isNewUser }
import { Router } from "express";
import { config } from "../config.js";
import { badRequest, tooMany } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_RESEND_MS, OTP_TTL_MS, codeMatches, hashCode, newCode } from "../lib/otp.js";
import { normalizeNgPhone } from "../lib/phone.js";
import { sendSms } from "../lib/sms.js";
import { obj } from "../lib/validate.js";
import { rateLimit } from "../middleware/http.js";
import { OtpCode, User } from "../models/index.js";
import { whatsappReady } from "../lib/whatsapp.js";
import { checkEmailCode, emailFrom, sendEmailCode, sessionFor, startWhatsAppCheck, takeWhatsAppCheck } from "../services/signin.js";

export const authRouter = Router();

const perIp = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "Too many sign-in attempts from this network. Try again in a few minutes." });
// The app asks every 2 seconds while the person is in WhatsApp, so checks get their own, higher limit.
const checks = rateLimit({ windowMs: 10 * 60 * 1000, max: 600, message: "Too many checks. Try again in a few minutes." });

authRouter.get("/methods", (req, res) => {
  res.json({
    whatsapp: whatsappReady(),
    whatsappNumber: whatsappReady() ? config.whatsapp.number : "",
    email: config.email.provider !== "console" || config.env !== "production",
    sms: config.sms.provider === "termii",
  });
});

authRouter.post("/whatsapp/start", perIp, async (req, res) => {
  if (!whatsappReady()) throw badRequest("WhatsApp sign-in isn't switched on yet. Use email instead.", "whatsapp_off");
  res.json(await startWhatsAppCheck("signin"));
});

authRouter.post("/whatsapp/check", checks, async (req, res) => {
  const r = await takeWhatsAppCheck(req.body, "signin");
  if (r.status === "pending") return res.json(r);
  let user = await User.findOne({ phone: r.phone });
  const isNewUser = !user;
  if (!user) {
    try { user = await User.create({ phone: r.phone }); }
    catch (err) { if (err?.code === 11000) user = await User.findOne({ phone: r.phone }); else throw err; }
  }
  res.json({ status: "confirmed", ...(await sessionFor(user, isNewUser)) });
});

authRouter.post("/email/request", perIp, async (req, res) => {
  res.json(await sendEmailCode(emailFrom(req.body), req.body?.lang));
});

authRouter.post("/email/verify", perIp, async (req, res) => {
  const email = emailFrom(req.body);
  await checkEmailCode(email, req.body?.code);
  let user = await User.findOne({ signInEmail: email });
  const isNewUser = !user;
  if (!user) {
    try { user = await User.create({ signInEmail: email, email }); }
    catch (err) { if (err?.code === 11000) user = await User.findOne({ signInEmail: email }); else throw err; }
  }
  res.json(await sessionFor(user, isNewUser));
});

/** The fixed code for a test or demo number (TEST_PHONE / DEMO_LOGINS), or null for everyone else. */
function fixedCode(phone) {
  if (config.testLogin.phone && config.testLogin.code && normalizeNgPhone(config.testLogin.phone) === phone) return config.testLogin.code;
  const demo = config.demoLogins.find(([p]) => normalizeNgPhone(p) === phone);
  return demo ? demo[1] : null;
}

const phoneFrom = (body) => {
  const phone = normalizeNgPhone(obj(body).phone);
  if (!phone) throw badRequest("Enter a Nigerian mobile number, like 803 214 5567.", "invalid_phone");
  return phone;
};

authRouter.post("/otp/request", perIp, async (req, res) => {
  const phone = phoneFrom(req.body);
  const fixed = fixedCode(phone);
  const isTest = !!fixed;

  const recent = await OtpCode.find({ phone, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } }).sort({ createdAt: -1 });
  if (!isTest && recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - recent[0].createdAt.getTime())) / 1000);
    throw tooMany(`Wait ${wait} seconds before asking for another code.`, "otp_wait");
  }
  if (!isTest && recent.length >= OTP_MAX_PER_HOUR) throw tooMany("Too many codes requested for this number. Try again in an hour.", "otp_limit");

  const code = fixed ?? newCode();
  await OtpCode.create({ phone, codeHash: hashCode(phone, code, config.jwtSecret), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
  if (!isTest) {
    try {
      await sendSms(phone, `Your Caliphate Rides code is ${code}. It expires in 5 minutes. Don't share it with anyone.`);
    } catch (err) {
      log.error("could not send sign-in code", { err: err.message });
      throw badRequest("We couldn't send the code. Check the number and try again.", "sms_failed");
    }
  }
  res.json({ expiresIn: Math.round(OTP_TTL_MS / 1000) });
});

authRouter.post("/otp/verify", perIp, async (req, res) => {
  const phone = phoneFrom(req.body);
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  const otp = await OtpCode.findOne({ phone, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (!otp) throw badRequest("That code has expired. Ask for a new one.", "otp_expired");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await OtpCode.deleteMany({ phone });
    throw tooMany("Too many wrong codes. Ask for a new one.", "otp_locked");
  }
  if (!codeMatches(otp.codeHash, phone, code, config.jwtSecret)) {
    await OtpCode.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw badRequest("That code isn't right. Check the SMS and try again.", "invalid_code");
  }
  await OtpCode.deleteMany({ phone });

  let user = await User.findOne({ phone });
  const isNewUser = !user;
  if (!user) user = await User.create({ phone });
  res.json(await sessionFor(user, isNewUser));
});
