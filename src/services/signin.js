// Signing someone in: a token for the app, and their profile.
import { config } from "../config.js";
import { badRequest } from "../lib/errors.js";
import { signToken } from "../lib/jwt.js";
import { userDTO } from "../lib/serialize.js";
import { User } from "../models/index.js";

export async function sessionFor(user, isNewUser) {
  if (user.blocked) throw badRequest("This account is on hold. Call Caliphate Rides support.", "account_blocked");
  await User.updateOne({ _id: user._id }, { lastSeenAt: new Date() });
  const token = signToken({ sub: user._id.toString(), role: "user" }, config.jwtSecret, { days: config.jwtDays });
  return { token, user: userDTO(user), isNewUser };
}
