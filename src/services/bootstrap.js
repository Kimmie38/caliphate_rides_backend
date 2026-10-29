// What a new database needs on day one. Runs every time the server starts and only adds what's
// missing, so nothing is ever overwritten:
//   - fares and commission (₦500 per km, ₦500 minimum, 15% commission until changed in the dashboard)
//   - the Sokoto places (only into an empty places collection, so deleted ones don't come back)
//   - the first admin account (owner), from ADMIN_EMAIL / ADMIN_PASSWORD, only while there are no admins
// This lets a host like Render's free plan, which has no shell, set itself up. `npm run seed` does the
// same from your computer.
import { config } from "../config.js";
import { LANDMARKS } from "../data/landmarks.js";
import { log } from "../lib/log.js";
import { hashPassword } from "../lib/password.js";
import { DEFAULT_PRICING } from "../lib/pricing.js";
import { Admin, Config, Place } from "../models/index.js";

export async function ensureDefaults({ say = (m) => log.info(m) } = {}) {
  await Promise.all([Admin.init(), Config.init(), Place.init()]); // build indexes

  if (await Config.exists({ _id: "pricing" })) {
    say("Fares: already set, left as they are.");
  } else {
    const { currency, roundTo, rideTypes, commissionPercent, owedLimit, minWithdrawal } = DEFAULT_PRICING;
    try {
      await Config.create({ _id: "pricing", currency, roundTo, rideTypes, commissionPercent, owedLimit, minWithdrawal, updatedBy: "setup" });
      say(`Fares: set to ₦${rideTypes[0].perKm} per km, ₦${rideTypes[0].minimumFare} minimum, ${commissionPercent}% commission.`);
    } catch (err) {
      if (err?.code !== 11000) throw err; // another copy of the server did it at the same moment
    }
  }

  if ((await Place.estimatedDocumentCount()) === 0) {
    const result = await Place.bulkWrite(
      LANDMARKS.map((p) => ({ updateOne: { filter: { slug: p.slug }, update: { $setOnInsert: { ...p, active: true, source: "seed" } }, upsert: true } })),
    );
    say(`Places: added ${result.upsertedCount} Sokoto places.`);
  } else {
    say("Places: already there.");
  }

  const { email, password, name } = config.admin;
  if (await Admin.exists({})) {
    say("Admin: already set up.");
  } else if (!email || !password) {
    say("Admin: none yet. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create the first one.");
  } else if (password.length < 10) {
    say("Admin: not created. ADMIN_PASSWORD must be at least 10 characters.");
  } else {
    await Admin.create({ email, name, passwordHash: await hashPassword(password), role: "owner" });
    say(`Admin: created ${email} (owner). You can now remove ADMIN_PASSWORD from the settings.`);
  }
}
