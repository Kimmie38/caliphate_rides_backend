// Signing in with a phone number, ending with { token, user, isNewUser }.
// A new number is confirmed once with a 6-digit code, then the person creates a 4-digit PIN
// (POST /me/pin). After that they sign in with number + PIN on any phone; "Forgot PIN" gets a code.
// The code is shown by the app as a notification (SMS_PROVIDER=app, free), sent by SMS (termii),
// or only written to the server log (console, for testing). Demo numbers in DEMO_LOGINS have fixed codes.
//   POST /auth/otp/request { phone, forgotPin? } -> { delivery: "pin", phoneName }  (has a PIN: ask for it)
//                                             or { expiresIn, delivery: "sms" | "app" | "support" | "log", code?, phoneName? }
//     "app": code is in the reply; the app shows it as a notification.
//     "support": the number already has an account on other phones; staff read the code to the person
//                after calling that number (it's in the server log).
//   POST /auth/otp/verify  { phone, code }    -> { token, user, isNewUser }
//   POST /auth/pin/verify  { phone, pin }     -> { token, user, isNewUser: false }
//   GET  /auth/methods                          -> for app versions before 1.0 that ask which sign-ins are on
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
import { deviceIdFrom, knowsDevice, lastDeviceName, strongerCheck } from "../lib/devices.js";
import { fixedCode, pinMatches, PIN_LOCK_AFTER, PIN_PAUSE_AFTER, PIN_PAUSE_MS } from "../lib/pin.js";
import { sessionFor } from "../services/signin.js";

export const authRouter = Router();

const perIp = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "Too many sign-in attempts from this network. Try again in a few minutes." });

// Older apps ask which ways to sign in are on: only the phone number now.
authRouter.get("/methods", (req, res) => {
  res.json({
    whatsapp: false,
    whatsappNumber: "",
    email: false,
    sms: config.sms.provider === "termii",
    phoneCode: config.sms.provider === "termii" ? "sms" : config.sms.provider === "app" ? "app" : "log",
  });
});

const phoneFrom = (body) => {
  const phone = normalizeNgPhone(obj(body).phone);
  if (!phone) throw badRequest("Enter a Nigerian mobile number, like 803 214 5567.", "invalid_phone");
  return phone;
};

authRouter.post("/otp/request", perIp, async (req, res) => {
  const phone = phoneFrom(req.body);
  const forgotPin = req.body?.forgotPin === true;
  const fixed = fixedCode(phone);
  const isTest = !!fixed;
  const device = deviceIdFrom(req);
  const existing = await User.findOne({ phone }, { devices: 1, pinHash: 1 });

  // Signed up before and has a PIN: sign in with it (no code). Older apps without PIN screens
  // (they send no phone ID) and demo numbers keep using codes.
  if (existing?.pinHash && device && !fixed && !forgotPin) {
    return res.json({ delivery: "pin", phoneName: lastDeviceName(existing) });
  }

  const recent = await OtpCode.find({ phone, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } }).sort({ createdAt: -1 });
  if (!isTest && recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - recent[0].createdAt.getTime())) / 1000);
    throw tooMany(`Wait ${wait} seconds before asking for another code.`, "otp_wait");
  }
  if (!isTest && recent.length >= OTP_MAX_PER_HOUR) throw tooMany("Too many codes requested for this number. Try again in an hour.", "otp_limit");

  const code = fixed ?? newCode();
  const expiresIn = Math.round(OTP_TTL_MS / 1000);
  const provider = config.sms.provider;

  // How this person gets the code.
  let via;
  if (fixed) via = "fixed";
  else if (provider === "termii") via = "sms";
  else if (provider === "app") {
    if (!device) via = "log"; // an older app that can't show codes: it goes to the server log, as before
    // Shown in the app, but only on a phone this account has used (or for a brand-new number).
    // On any other phone, support confirms it's them first (they forgot their PIN on a new phone).
    else via = knowsDevice(existing, device) ? "app" : "support";
  } else via = "log";

  await OtpCode.create({
    phone, codeHash: hashCode(phone, code, config.jwtSecret), expiresAt: new Date(Date.now() + OTP_TTL_MS), via,
    resetPin: forgotPin && !!existing?.pinHash,
  });

  if (via === "sms") {
    try {
      await sendSms(phone, `Your Caliphate Rides code is ${code}. It expires in 5 minutes. Don't share it with anyone.`);
    } catch (err) {
      log.error("could not send sign-in code", { err: err.message });
      throw badRequest("We couldn't send the code. Check the number and try again.", "sms_failed");
    }
    return res.json({ expiresIn, delivery: "sms" });
  }
  if (via === "support") {
    // Staff: call this number, check it's the account holder, then read them the code.
    log.info("Sign-in code for a NEW phone on an existing account (call the number before giving it)", { to: phone, code, forgotPin });
    return res.json({ expiresIn, delivery: "support", phoneName: lastDeviceName(existing) });
  }
  if (via === "log") {
    // Testing, or an older app that can't show codes: the code is only written to the server log.
    log.info(`Sign-in code (not sent: SMS_PROVIDER=${provider})`, { to: phone, message: `Your Caliphate Rides code is ${code}. It expires in 5 minutes.` });
    return res.json({ expiresIn, delivery: "log" });
  }
  // "app" (and demo numbers when the app shows codes): the app shows it as a notification.
  if (via === "fixed" && provider !== "app") return res.json({ expiresIn, delivery: provider === "termii" ? "sms" : "log" });
  res.json({ expiresIn, delivery: "app", code });
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

  const checked = { sms: "sms", support: "support", app: "app", fixed: "demo", log: "app" }[otp.via ?? "sms"] ?? "sms";
  let user = await User.findOne({ phone });
  const isNewUser = !user;
  if (!user) {
    try { user = await User.create({ phone, phoneCheckedBy: checked }); }
    catch (err) { if (err?.code === 11000) user = await User.findOne({ phone }); else throw err; }
  } else {
    const update = {};
    if (strongerCheck(user.phoneCheckedBy, checked) !== user.phoneCheckedBy) update.phoneCheckedBy = strongerCheck(user.phoneCheckedBy, checked);
    // "Forgot PIN": the old PIN (and any lock) goes; the app asks them to create a new one.
    if (otp.resetPin) Object.assign(update, { pinHash: "", pinFails: 0, pinLocked: false, pinPausedUntil: null });
    if (Object.keys(update).length) {
      await User.updateOne({ _id: user._id }, update);
      Object.assign(user, update);
    }
  }
  res.json(await sessionFor(user, isNewUser));
});

const minutes = (ms) => Math.max(1, Math.ceil(ms / 60000));

authRouter.post("/pin/verify", perIp, async (req, res) => {
  const phone = phoneFrom(req.body);
  const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
  const user = await User.findOne({ phone });
  if (!user?.pinHash) throw badRequest("This number signs in with a code. Go back and tap Continue.", "no_pin");

  const now = new Date();
  // Count the attempt BEFORE checking it, so attempts sent all at once are all counted.
  const counted = await User.findOneAndUpdate(
    { _id: user._id, pinLocked: { $ne: true }, $or: [{ pinPausedUntil: null }, { pinPausedUntil: { $lte: now } }] },
    { $inc: { pinFails: 1 } },
    { returnDocument: "after" },
  );
  if (!counted) {
    if (user.pinLocked) throw tooMany("Your PIN is locked after too many wrong tries. Tap Forgot PIN to get back in.", "pin_locked");
    throw tooMany(`Too many wrong PINs. Try again in ${minutes(user.pinPausedUntil - now)} minutes, or tap Forgot PIN.`, "pin_paused");
  }
  if (counted.pinFails > PIN_LOCK_AFTER) {
    await User.updateOne({ _id: user._id }, { pinLocked: true });
    throw tooMany("Your PIN is locked after too many wrong tries. Tap Forgot PIN to get back in.", "pin_locked");
  }

  if (!pinMatches(counted.pinHash, pin)) {
    const fails = counted.pinFails;
    if (fails >= PIN_LOCK_AFTER) {
      await User.updateOne({ _id: user._id }, { pinLocked: true });
      throw tooMany("Your PIN is locked after too many wrong tries. Tap Forgot PIN to get back in.", "pin_locked");
    }
    if (fails % PIN_PAUSE_AFTER === 0) {
      await User.updateOne({ _id: user._id }, { pinPausedUntil: new Date(Date.now() + PIN_PAUSE_MS) });
      throw tooMany(`Too many wrong PINs. Try again in ${minutes(PIN_PAUSE_MS)} minutes, or tap Forgot PIN.`, "pin_paused");
    }
    const left = PIN_PAUSE_AFTER - (fails % PIN_PAUSE_AFTER);
    throw badRequest(left === 1 ? "Wrong PIN. 1 try left before a 30-minute pause." : `Wrong PIN. ${left} tries left before a 30-minute pause.`, "wrong_pin");
  }

  await User.updateOne({ _id: user._id }, { pinFails: 0, pinPausedUntil: null });
  res.json(await sessionFor(counted, false));
});
