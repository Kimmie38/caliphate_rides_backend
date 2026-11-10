// Shared pieces of signing in: the session token, emailed codes, and WhatsApp checks.
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { EMAIL_RE, codeEmail, normalizeEmail, sendEmail } from "../lib/email.js";
import { badRequest, tooMany } from "../lib/errors.js";
import { signToken } from "../lib/jwt.js";
import { log } from "../lib/log.js";
import { OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_RESEND_MS, codeMatches, hashCode, newCode } from "../lib/otp.js";
import { userDTO } from "../lib/serialize.js";
import { chatLink, messageFor, newCheckCode, newSecret } from "../lib/whatsapp.js";
import { OtpCode, User, WhatsAppCheck } from "../models/index.js";

/** Signs the person in: a token for the app, and their profile. */
export async function sessionFor(user, isNewUser) {
  if (user.blocked) throw badRequest("This account is on hold. Call Caliphate Rides support.", "account_blocked");
  await User.updateOne({ _id: user._id }, { lastSeenAt: new Date() });
  const token = signToken({ sub: user._id.toString(), role: "user" }, config.jwtSecret, { days: config.jwtDays });
  return { token, user: userDTO(user), isNewUser };
}

// ---- Emailed codes (stored like SMS codes, under "email:<address>")
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000; // email can take a little longer than SMS
const emailKey = (email) => `email:${email}`;

export function emailFrom(body) {
  const email = normalizeEmail(body?.email);
  if (!EMAIL_RE.test(email) || email.length > 120) throw badRequest("Enter a valid email address, like name@gmail.com.", "invalid_email");
  return email;
}

export async function sendEmailCode(email, lang) {
  const key = emailKey(email);
  const recent = await OtpCode.find({ phone: key, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } }).sort({ createdAt: -1 });
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - recent[0].createdAt.getTime())) / 1000);
    throw tooMany(`Wait ${wait} seconds before asking for another code.`, "otp_wait");
  }
  if (recent.length >= OTP_MAX_PER_HOUR) throw tooMany("Too many codes asked for this email. Try again in an hour.", "otp_limit");
  const code = newCode();
  await OtpCode.create({ phone: key, codeHash: hashCode(key, code, config.jwtSecret), expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS) });
  if (config.email.provider === "console") log.info(`Caliphate Rides email code is ${code}`, { to: email });
  try {
    await sendEmail(email, codeEmail(code, lang === "ha" ? "ha" : "en"));
  } catch (err) {
    log.error("could not send email code", { err: err.message });
    throw badRequest("We couldn't send the email. Check the address and try again.", "email_failed");
  }
  return { expiresIn: Math.round(EMAIL_CODE_TTL_MS / 1000) };
}

/** Throws unless the code is right. Uses up the code. */
export async function checkEmailCode(email, code) {
  const key = emailKey(email);
  const otp = await OtpCode.findOne({ phone: key, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (!otp) throw badRequest("That code has expired. Ask for a new one.", "otp_expired");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await OtpCode.deleteMany({ phone: key });
    throw tooMany("Too many wrong codes. Ask for a new one.", "otp_locked");
  }
  if (!codeMatches(otp.codeHash, key, typeof code === "string" ? code.trim() : "", config.jwtSecret)) {
    await OtpCode.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw badRequest("That code isn't right. Check the email and try again.", "invalid_code");
  }
  await OtpCode.deleteMany({ phone: key });
}

// ---- WhatsApp checks
export const WHATSAPP_TTL_MS = 10 * 60 * 1000;
const hashSecret = (s) => createHash("sha256").update(`${s}:${config.jwtSecret}`).digest();

export async function startWhatsAppCheck(purpose, user) {
  for (let i = 0; i < 5; i++) {
    const code = newCheckCode();
    const secret = newSecret();
    try {
      const check = await WhatsAppCheck.create({ code, secretHash: hashSecret(secret).toString("hex"), purpose, user: user?._id, expiresAt: new Date(Date.now() + WHATSAPP_TTL_MS) });
      return {
        checkId: check._id.toString(), secret, code,
        number: config.whatsapp.number, message: messageFor(code), link: chatLink(code),
        expiresIn: Math.round(WHATSAPP_TTL_MS / 1000),
      };
    } catch (err) {
      if (err?.code !== 11000) throw err; // the same code twice: try another
    }
  }
  throw new Error("Couldn't make a WhatsApp code");
}

/**
 * The state of a check started by this app: "pending" (not sent yet), or the confirmed number
 * (and the check is used up so it can't be used twice). Throws if it's not theirs or has expired.
 */
export async function takeWhatsAppCheck(body, purpose, user) {
  const id = typeof body?.checkId === "string" ? body.checkId : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";
  const check = /^[a-f0-9]{24}$/.test(id) ? await WhatsAppCheck.findById(id) : null;
  const given = hashSecret(secret);
  const ok = check && check.purpose === purpose && timingSafeEqual(Buffer.from(check.secretHash, "hex"), given)
    && (purpose !== "link" || String(check.user) === String(user?._id));
  if (!ok || check.expiresAt < new Date() || check.status === "used") throw badRequest("This WhatsApp code has expired. Start again.", "whatsapp_expired");
  if (check.status === "pending") return { status: "pending" };
  const taken = await WhatsAppCheck.findOneAndUpdate({ _id: check._id, status: "confirmed" }, { $set: { status: "used" } });
  if (!taken) throw badRequest("This WhatsApp code has already been used. Start again.", "whatsapp_expired");
  return { status: "confirmed", phone: check.phone };
}
