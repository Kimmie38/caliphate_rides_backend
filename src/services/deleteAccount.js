// Deleting an account from the app (Apple and Google both require this for apps people sign up to).
// Contact and identity details are removed for good; trips, payments and payouts stay in the records
// (needed for the accounts), shown as "Deleted account". The same phone number can sign up again later.
import { conflict } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { deleteStored } from "../lib/storage.js";
import { Driver, Ride, User, Withdrawal } from "../models/index.js";

const naira = (n) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const LIVE_RIDE = ["searching", "accepted", "arrived", "in_progress"];

/** Throws a clear message if something has to be settled first. */
async function checkCanDelete(user, driver) {
  if (await Ride.exists({ rider: user._id, status: { $in: LIVE_RIDE } })) {
    throw conflict("Finish or cancel your current ride first.", "ride_active");
  }
  if (!driver) return;
  if (driver.currentRide) throw conflict("Finish your current trip first.", "trip_active");
  if (await Withdrawal.exists({ driver: driver._id, status: { $in: ["processing", "needs_check"] } })) {
    throw conflict("A withdrawal is still being paid to your bank. Try again once it has arrived.", "withdrawal_pending");
  }
  if (driver.balance >= 1) throw conflict(`You have ${naira(driver.balance)} to withdraw. Withdraw it first so we can pay you.`, "balance_left");
  if (driver.balance <= -1) throw conflict(`You owe ${naira(-driver.balance)} in commission. Pay it or call driver support before deleting your account.`, "balance_owed");
}

/** Every stored document photo of a driver (current and older versions). */
function documentFiles(driver) {
  const names = [];
  for (const doc of driver.documents?.values?.() ?? []) {
    names.push(...(doc.current?.files ?? []));
    for (const v of doc.history ?? []) names.push(...(v.files ?? []));
  }
  return names;
}

export async function deleteAccount(user) {
  const driver = await Driver.findOne({ user: user._id });
  await checkCanDelete(user, driver);

  if (driver) {
    const files = documentFiles(driver);
    driver.set({
      status: "deleted",
      online: false,
      location: undefined,
      currentRide: null,
      // Kept for past trips and payouts: name, record number, vehicle, ratings, the signed declaration.
      "personal.dateOfBirth": "", "personal.gender": "", "personal.address": "", "personal.nin": "", "personal.email": "",
      "personal.lga": "",
      guarantor: { fullName: "", phone: "", relationship: "", address: "" },
      owner: { fullName: "", phone: "", email: "", address: "" },
      bank: { bankName: "", accountNumber: "", accountName: "" },
      documents: new Map(),
    });
    driver.timeline.unshift({ at: new Date(), event: "Account deleted by the driver", by: "Driver" });
    await driver.save();
    await deleteStored(files).catch((err) => log.error("could not delete document files", { err: err.message }));
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: { name: "", email: "", devices: [], phoneCheckedBy: "", deletedAt: new Date(), lastSeenAt: new Date() },
      $unset: { phone: 1, signInEmail: 1 },
    },
  );
  log.info("account deleted", { user: user._id.toString(), driver: driver?._id?.toString() });
}
