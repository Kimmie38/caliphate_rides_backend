// Finding a driver: offer the ride to the nearest free, approved, online driver of the right vehicle
// type. Each driver gets OFFER_SECONDS to answer; if they decline or don't answer, the next one is
// asked. If nobody is free, keep looking every few seconds until MATCH_TIMEOUT_SECONDS, then tell the
// rider no drivers are available.
//
// Timers live in this process. That's fine for one server; with several, run matching on one of them
// (or move the timers to a job queue). On start-up, recoverMatching() picks up rides left searching.
import { config } from "../config.js";
import { conflict } from "../lib/errors.js";
import { toGeoPoint } from "../lib/geo.js";
import { log } from "../lib/log.js";
import { rideRequestDTO } from "../lib/serialize.js";
import { Driver, Ride, User } from "../models/index.js";
import { getPricing } from "./pricing.js";
import { publishRide } from "./rides.js";
import { emitTo, userRoom } from "./realtime.js";

const RETRY_MS = 5000; // when no driver is free, look again this often
const STALE_MS = 90_000; // drivers not heard from in this long are treated as offline
const timers = new Map(); // rideId -> timeout

function setTimer(rideId, ms, fn) {
  clearTimer(rideId);
  const t = setTimeout(() => {
    timers.delete(rideId);
    fn().catch((err) => log.error("matching step failed", { ride: rideId, err: err.message }));
  }, ms);
  t.unref?.();
  timers.set(rideId, t);
}

export function clearTimer(rideId) {
  const key = rideId.toString();
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.delete(key);
}

/** Nearest eligible driver who hasn't already passed on this ride and isn't considering another one. */
export async function findCandidate(ride) {
  const { owedLimit } = await getPricing();
  const nearby = await Driver.find({
    balance: { $not: { $lt: -owedLimit } }, // drivers who owe too much commission don't get trips (missing = 0)
    _id: { $nin: ride.declinedBy ?? [] },
    user: { $ne: ride.rider },
    status: "approved",
    online: true,
    currentRide: null,
    vehicleType: ride.rideType,
    lastSeenAt: { $gte: new Date(Date.now() - STALE_MS) },
    location: { $near: { $geometry: toGeoPoint(ride.pickup.location), $maxDistance: config.matching.radiusM } },
  })
    .limit(10)
    .select({ _id: 1, user: 1 });
  if (!nearby.length) return null;
  const busy = new Set(
    (await Ride.distinct("offer.driver", { status: "searching", _id: { $ne: ride._id }, "offer.driver": { $in: nearby.map((d) => d._id) } })).map(String),
  );
  return nearby.find((d) => !busy.has(d._id.toString())) ?? null;
}

/** Starts (or continues) looking for a driver for this ride. */
export async function offerNext(rideId) {
  const key = rideId.toString();
  clearTimer(key);
  const ride = await Ride.findById(key);
  if (!ride || ride.status !== "searching") return;

  if (ride.searchUntil && ride.searchUntil.getTime() < Date.now()) return noDrivers(key);

  const candidate = await findCandidate(ride);
  if (!candidate) {
    setTimer(key, RETRY_MS, () => offerNext(key));
    return;
  }

  const expiresAt = new Date(Date.now() + config.matching.offerSeconds * 1000);
  const offered = await Ride.findOneAndUpdate(
    { _id: key, status: "searching" },
    { offer: { driver: candidate._id, expiresAt } },
    { returnDocument: "after" },
  );
  if (!offered) return;
  const rider = await User.findById(offered.rider);
  emitTo(userRoom(candidate.user), "ride:request", rideRequestDTO(offered, rider, expiresAt));
  log.info("ride offered", { ride: key, driver: candidate._id.toString() });
  // A little longer than the driver's countdown, so a last-second accept still counts.
  setTimer(key, config.matching.offerSeconds * 1000 + 2000, () => passOn(key, candidate._id));
}

/** The driver declined, or didn't answer in time: ask the next one. */
export async function passOn(rideId, driverId) {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: "searching", "offer.driver": driverId },
    { $unset: { offer: 1 }, $addToSet: { declinedBy: driverId } },
    { returnDocument: "after" },
  );
  if (ride) await offerNext(rideId);
}

async function noDrivers(rideId) {
  clearTimer(rideId);
  const ride = await Ride.findOneAndUpdate({ _id: rideId, status: "searching" }, { status: "no_drivers", $unset: { offer: 1 } }, { returnDocument: "after" });
  if (ride) {
    await publishRide(ride);
    log.info("no drivers available", { ride: rideId.toString() });
  }
}

/** The offered driver accepts. Only works for the driver currently being asked, before the offer runs out. */
export async function acceptOffer(rideId, driver) {
  const now = new Date();
  // Claim the driver first, so they can't end up on two trips at once.
  const claimed = await Driver.findOneAndUpdate({ _id: driver._id, currentRide: null }, { currentRide: rideId }, { returnDocument: "after" });
  if (!claimed) throw conflict("Finish your current trip before accepting another.", "driver_busy");

  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: "searching", "offer.driver": driver._id, "offer.expiresAt": { $gte: new Date(now.getTime() - 3000) } },
    { status: "accepted", driver: driver._id, acceptedAt: now, $unset: { offer: 1 } },
    { returnDocument: "after" },
  );
  if (!ride) {
    await Driver.updateOne({ _id: driver._id, currentRide: rideId }, { currentRide: null });
    throw conflict("This request has expired or was cancelled.", "offer_gone");
  }
  clearTimer(rideId);
  await publishRide(ride);
  log.info("ride accepted", { ride: rideId.toString(), driver: driver._id.toString() });
  return ride;
}

/** Stops any search for the ride and tells the drivers involved that it was cancelled. */
export async function notifyCancelled(ride) {
  clearTimer(ride._id);
  const driverIds = [ride.offer?.driver, ride.driver].filter(Boolean);
  if (!driverIds.length) return;
  const drivers = await Driver.find({ _id: { $in: driverIds } }, { user: 1 });
  for (const d of drivers) emitTo(userRoom(d.user), "ride:cancelled", { rideId: ride._id.toString() });
  if (ride.driver) await Driver.updateOne({ _id: ride.driver, currentRide: ride._id }, { currentRide: null });
}

/** A driver just came online or finished a trip: offer them any nearby ride still waiting. */
export async function onDriverAvailable(driver) {
  if (!driver.location?.coordinates) return;
  const waiting = await Ride.find({
    status: "searching",
    rideType: driver.vehicleType,
    "offer.driver": { $exists: false },
    declinedBy: { $ne: driver._id },
  })
    .sort({ createdAt: 1 })
    .limit(3)
    .select({ _id: 1 });
  for (const r of waiting) await offerNext(r._id);
}

/** After a restart: carry on searching for recent rides, give up on old ones. */
export async function recoverMatching() {
  const searching = await Ride.find({ status: "searching" }).select({ _id: 1, searchUntil: 1 });
  for (const r of searching) {
    await Ride.updateOne({ _id: r._id }, { $unset: { offer: 1 } });
    if (r.searchUntil && r.searchUntil.getTime() > Date.now()) await offerNext(r._id);
    else await noDrivers(r._id);
  }
  if (searching.length) log.info("matching recovered", { rides: searching.length });
}
