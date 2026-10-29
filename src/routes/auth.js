// Phone sign-in with a 6-digit code by SMS.
//   POST /auth/otp/request { phone }        -> { expiresIn }
//   POST /auth/otp/verify  { phone, code }  -> { token, user, isNewUser }
import { Router } from "express";
import { config } from "../config.js";
import { badRequest, tooMany } from "../lib/errors.js";
import { signToken } from "../lib/jwt.js";
import { log } from "../lib/log.js";
import { OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_RESEND_MS, OTP_TTL_MS, codeMatches, hashCode, newCode } from "../lib/otp.js";
import { normalizeNgPhone } from "../lib/phone.js";
import { userDTO } from "../lib/serialize.js";
import { sendSms } from "../lib/sms.js";
import { obj } from "../lib/validate.js";
import { rateLimit } from "../middleware/http.js";
import { OtpCode, User } from "../models/index.js";

export const authRouter = Router();

const perIp = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "Too many sign-in attempts from this network. Try again in a few minutes." });

const phoneFrom = (body) => {
  const phone = normalizeNgPhone(obj(body).phone);
  if (!phone) throw badRequest("Enter a Nigerian mobile number, like 803 214 5567.", "invalid_phone");
  return phone;
};

authRouter.post("/otp/request", perIp, async (req, res) => {
  const phone = phoneFrom(req.body);
  const isTest = config.testLogin.phone && phone === config.testLogin.phone && config.testLogin.code;

  const recent = await OtpCode.find({ phone, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } }).sort({ createdAt: -1 });
  if (!isTest && recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - recent[0].createdAt.getTime())) / 1000);
    throw tooMany(`Wait ${wait} seconds before asking for another code.`, "otp_wait");
  }
  if (!isTest && recent.length >= OTP_MAX_PER_HOUR) throw tooMany("Too many codes requested for this number. Try again in an hour.", "otp_limit");

  const code = isTest ? config.testLogin.code : newCode();
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
  if (user.blocked) throw badRequest("This account is on hold. Call Caliphate Rides support.", "account_blocked");
  await User.updateOne({ _id: user._id }, { lastSeenAt: new Date() });

  const token = signToken({ sub: user._id.toString(), role: "user" }, config.jwtSecret, { days: config.jwtDays });
  res.json({ token, user: userDTO(user), isNewUser });
});
