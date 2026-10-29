import { config } from "../config.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyToken } from "../lib/jwt.js";
import { Admin, Driver, User } from "../models/index.js";

const bearer = (req) => {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
};

/** Signed-in rider or driver (phone login). Sets req.user. */
export async function requireUser(req, _res, next) {
  const payload = verifyToken(bearer(req), config.jwtSecret);
  if (!payload || payload.role !== "user") throw unauthorized();
  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized();
  if (user.blocked) throw forbidden("This account is on hold. Call Caliphate Rides support.", "account_blocked");
  req.user = user;
  next();
}

/** The signed-in person's driver record (any status). Sets req.driver. Use after requireUser. */
export async function requireDriver(req, _res, next) {
  const driver = await Driver.findOne({ user: req.user._id });
  if (!driver) throw forbidden("Sign up to drive first.", "not_a_driver");
  req.driver = driver;
  next();
}

/** Only approved drivers can take trips. Use after requireDriver. */
export function requireApprovedDriver(req, _res, next) {
  if (req.driver.status !== "approved") {
    throw forbidden(req.driver.status === "suspended" ? "Your driver account is on hold. Call driver support." : "Your driver account isn't approved yet.", "driver_not_approved");
  }
  next();
}

/** Signed-in admin (email + password login). Sets req.admin. */
export async function requireAdmin(req, _res, next) {
  const payload = verifyToken(bearer(req), config.jwtSecret);
  if (!payload || payload.role !== "admin") throw unauthorized();
  const admin = await Admin.findById(payload.sub);
  if (!admin || !admin.active) throw unauthorized();
  req.admin = admin;
  next();
}

export function requireOwner(req, _res, next) {
  if (req.admin?.role !== "owner") throw forbidden("Only the account owner can do that.");
  next();
}

/** Verifies a socket's token. Returns { kind: "user", user } or null. */
export async function userFromToken(token) {
  const payload = verifyToken(token, config.jwtSecret);
  if (!payload || payload.role !== "user") return null;
  const user = await User.findById(payload.sub);
  return user && !user.blocked ? user : null;
}
