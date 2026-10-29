// Ride state, payments and the wallet: shared by the rider, driver and admin routes.
import { conflict } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { rideDTO } from "../lib/serialize.js";
import { Driver, Ride, User, WalletTransaction } from "../models/index.js";
import { chargeCommission, creditInAppFare } from "./driverMoney.js";
import { emitTo, rideRoom, userRoom } from "./realtime.js";

/** The ride as the rider's app shows it, with the driver filled in. */
export async function rideView(ride) {
  if (!ride.driver) return rideDTO(ride);
  const driver = ride.driver.personal ? ride.driver : await Driver.findById(ride.driver);
  const driverUser = driver ? await User.findById(driver.user) : null;
  return rideDTO(ride, driver ?? undefined, driverUser ?? undefined);
}

/** Tells everyone following the ride (rider and driver) about its latest state. */
export async function publishRide(ride) {
  const view = await rideView(ride);
  emitTo([rideRoom(ride._id), userRoom(ride.rider)], "ride:updated", view);
  return view;
}

// ---------- wallet ----------

const isDuplicate = (err) => err?.code === 11000;

/** Adds money to a wallet once per reference (safe to call twice for the same payment). */
export async function creditWallet(userId, amount, { label, reference, method, kind = "topup", ride } = {}) {
  try {
    await WalletTransaction.create({ user: userId, kind, label, amount, method, reference, ride });
  } catch (err) {
    if (isDuplicate(err)) return false; // already credited
    throw err;
  }
  await User.updateOne({ _id: userId }, { $inc: { walletBalance: amount } });
  return true;
}

/** Takes money from a wallet if the balance covers it. Returns false when it doesn't. Once per reference. */
export async function debitWallet(userId, amount, { label, reference, ride }) {
  try {
    await WalletTransaction.create({ user: userId, kind: "ride", label, amount: -amount, method: "Wallet", reference, ride });
  } catch (err) {
    if (isDuplicate(err)) return true; // already paid
    throw err;
  }
  const res = await User.updateOne({ _id: userId, walletBalance: { $gte: amount } }, { $inc: { walletBalance: -amount } });
  if (res.modifiedCount === 1) return true;
  await WalletTransaction.deleteOne({ reference }); // not enough money: undo the record
  return false;
}

// ---------- payment ----------

/** Marks a ride paid (once), pays the driver for card and wallet trips, and tells the rider and the driver. */
export async function markRidePaid(rideId, via) {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, paymentStatus: "pending" },
    { paymentStatus: "paid", paidAt: new Date(), paidVia: via },
    { returnDocument: "after" },
  );
  if (!ride) return null;
  await creditInAppFare(ride);
  await publishRide(ride);
  if (ride.driver) {
    const driver = await Driver.findById(ride.driver, { user: 1 });
    if (driver) emitTo(userRoom(driver.user), "ride:paid", { rideId: ride._id.toString() });
  }
  log.info("ride paid", { ride: ride._id.toString(), via });
  return ride;
}

/** Wallet rides are charged when the trip ends. Returns true if paid. */
export async function chargeWalletForRide(ride) {
  const ok = await debitWallet(ride.rider, ride.fare, { label: `Ride to ${ride.destination.name}`, reference: `ride-${ride._id}`, ride: ride._id });
  if (ok) await markRidePaid(ride._id, "wallet");
  return ok;
}

// ---------- trip steps ----------

/** Allowed driver steps: from → to. */
export const NEXT_STEP = { arrived: "accepted", in_progress: "arrived", completed: "in_progress" };

/** Moves the driver's ride to the next step. Throws 409 if it isn't at the step before. */
export async function advanceRide(rideId, driverId, to) {
  const stamp = { arrived: "arrivedAt", in_progress: "startedAt", completed: "completedAt" }[to];
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, driver: driverId, status: NEXT_STEP[to] },
    { status: to, [stamp]: new Date() },
    { returnDocument: "after" },
  );
  if (!ride) throw conflict("This trip has moved on. Pull down to refresh.", "wrong_step");
  if (to === "completed") {
    await Driver.updateOne({ _id: driverId }, { $set: { currentRide: null }, $inc: { tripsCount: 1 } });
    await chargeCommission(ride);
    if (ride.paymentMethod === "wallet") {
      const paid = await chargeWalletForRide(ride);
      if (paid) return Ride.findById(ride._id);
    }
  }
  await publishRide(ride);
  return ride;
}
