// What the apps say over the live connection:
//   rider and driver:  "ride:subscribe" / "ride:unsubscribe"  { rideId }
//   driver:            "driver:online"    { online, vehicleType }
//                      "driver:position"  { location: { latitude, longitude }, heading, at }
// and what the server sends back: "ride:updated", "driver:position", "ride:request",
// "ride:cancelled", "ride:paid", "driver:balance", "driver:withdrawal", and "driver:error" { message }
// when going online isn't allowed (not approved, expired document, owes too much commission).
import { drivingBlockers } from "../lib/driverRules.js";
import { log } from "../lib/log.js";
import { Driver, Ride } from "../models/index.js";
import { owedMessage, owesTooMuch } from "./driverMoney.js";
import { onDriverAvailable } from "./matching.js";
import { connectionCount, emitTo, onConnection, rideRoom } from "./realtime.js";
import { rideView } from "./rides.js";

const OFFLINE_GRACE_MS = 60_000; // phones drop and reconnect; wait before marking a driver offline
const MIN_POSITION_GAP_MS = 1000;

const validPosition = (p) =>
  p && p.location && Number.isFinite(p.location.latitude) && Number.isFinite(p.location.longitude) &&
  Math.abs(p.location.latitude) <= 90 && Math.abs(p.location.longitude) <= 180;

onConnection((socket, user) => {
  // ---- Following a ride (rider, or the ride's driver) ----
  socket.on("ride:subscribe", async (msg) => {
    try {
      const ride = await Ride.findById(msg?.rideId);
      if (!ride) return;
      let allowed = ride.rider.equals(user._id);
      if (!allowed && ride.driver) allowed = !!(await Driver.exists({ _id: ride.driver, user: user._id }));
      if (!allowed) return;
      socket.join(rideRoom(ride._id));
      socket.emit("ride:updated", await rideView(ride)); // catch up on anything missed while offline
      if (ride.lastDriverPosition?.location?.latitude !== undefined) socket.emit("driver:position", ride.lastDriverPosition);
    } catch (err) {
      log.error("ride:subscribe failed", { err: err.message });
    }
  });
  socket.on("ride:unsubscribe", (msg) => {
    if (msg?.rideId) socket.leave(rideRoom(msg.rideId));
  });

  // ---- Driver going online / offline ----
  socket.on("driver:online", async (msg) => {
    try {
      const driver = await Driver.findOne({ user: user._id });
      if (!driver) return socket.emit("driver:error", { message: "Sign up to drive first." });
      if (!msg?.online) {
        await Driver.updateOne({ _id: driver._id }, { online: false });
        socket.data.driverId = undefined;
        return;
      }
      if (driver.status !== "approved") return socket.emit("driver:error", { message: "Your driver account isn't approved yet." });
      const blockers = drivingBlockers(driver.toObject({ flattenMaps: true }));
      if (blockers.length) {
        return socket.emit("driver:error", { message: `You can't go online: ${blockers.map((b) => `${b.title.toLowerCase()} ${b.reason}`).join(", ")}.` });
      }
      const owing = await owesTooMuch(driver);
      if (owing) return socket.emit("driver:error", { message: owedMessage(owing.owed) });
      socket.data.driverId = driver._id.toString();
      // Rides are matched only once a fresh GPS position arrives (see "driver:position"),
      // never to wherever the phone was last time.
      socket.data.announced = false;
      await Driver.updateOne({ _id: driver._id }, { online: true });
    } catch (err) {
      log.error("driver:online failed", { err: err.message });
    }
  });

  // ---- Driver position: stored for matching, and passed on to the rider during a trip ----
  let lastPositionAt = 0;
  socket.on("driver:position", async (p) => {
    try {
      if (!socket.data.driverId || !validPosition(p)) return;
      const now = Date.now();
      if (now - lastPositionAt < MIN_POSITION_GAP_MS) return;
      lastPositionAt = now;
      const heading = Number.isFinite(p.heading) ? p.heading : 0;
      const position = { location: { latitude: p.location.latitude, longitude: p.location.longitude }, heading, at: Number.isFinite(p.at) ? p.at : now };
      const driver = await Driver.findByIdAndUpdate(
        socket.data.driverId,
        { location: { type: "Point", coordinates: [position.location.longitude, position.location.latitude] }, heading, lastSeenAt: new Date() },
        { returnDocument: "after", projection: { currentRide: 1, online: 1, vehicleType: 1, location: 1 } },
      );
      if (driver?.currentRide) {
        emitTo(rideRoom(driver.currentRide), "driver:position", position);
        await Ride.updateOne({ _id: driver.currentRide }, { lastDriverPosition: position });
      } else if (driver?.online && !socket.data.announced) {
        socket.data.announced = true; // first position since going online: offer any ride waiting nearby
        await onDriverAvailable(driver);
      }
    } catch (err) {
      log.error("driver:position failed", { err: err.message });
    }
  });

  // ---- Disconnects: mark the driver offline if they don't come back soon ----
  socket.on("disconnect", () => {
    const driverId = socket.data.driverId;
    if (!driverId) return;
    setTimeout(async () => {
      try {
        if ((await connectionCount(user._id)) === 0) await Driver.updateOne({ _id: driverId }, { online: false });
      } catch (err) {
        log.error("offline check failed", { err: err.message });
      }
    }, OFFLINE_GRACE_MS).unref?.();
  });
});
