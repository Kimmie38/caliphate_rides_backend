// Riders' trips. All need sign-in.
//   POST  /rides/quote        { pickup, destination }                           -> { quotes }
//   POST  /rides              { pickup, destination, rideType, paymentMethod }  -> { ride }
//   GET   /rides/current                                                        -> { ride | null }
//   GET   /rides/history                                                        -> { trips }
//   POST  /rides/:id/cancel   { reason? }                                       -> { ride }
//   POST  /rides/:id/rate     { stars, comment? }                               -> { ok }
//   PATCH /rides/:id/payment  { paymentMethod }                                 -> { ride }
//   POST  /rides/:id/pay                                                        -> { checkoutUrl }   (card, Flutterwave)
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { HttpError, badRequest, conflict, notFound } from "../lib/errors.js";
import { haversineKm } from "../lib/geo.js";
import { createCheckout, paymentEmail } from "../lib/flutterwave.js";
import { RIDE_TYPES } from "../lib/pricing.js";
import { tripSummaryDTO } from "../lib/serialize.js";
import { int, obj, oneOf, point, text } from "../lib/validate.js";
import { requireUser } from "../middleware/auth.js";
import { Driver, PAYMENT_METHODS, Payment, Ride } from "../models/index.js";
import { notifyCancelled, offerNext } from "../services/matching.js";
import { quoteTrip, rideSplit } from "../services/pricing.js";
import { debitWallet, markRidePaid, publishRide, rideView } from "../services/rides.js";
import { log } from "../lib/log.js";

export const ridesRouter = Router();
ridesRouter.use(requireUser);

const OPEN = ["searching", "accepted", "arrived", "in_progress"];
const lowBalance = () => new HttpError(402, "Your wallet balance is too low for this trip. Pay with cash or add money to your wallet.", "insufficient_balance");

function tripPoints(body) {
  const b = obj(body);
  const pickup = point(b.pickup, "Pickup");
  const destination = point(b.destination, "Destination");
  if (haversineKm(pickup, destination) < 0.15) throw badRequest("Your pickup and destination are the same place. Choose a different destination.", "same_place");
  const a = config.serviceArea;
  if (a && !(pickup.latitude >= a.south && pickup.latitude <= a.north && pickup.longitude >= a.west && pickup.longitude <= a.east)) {
    throw badRequest("Caliphate Rides isn't available here yet. Pickups need to be in Sokoto.", "outside_service_area");
  }
  return { pickup, destination };
}

const asPlace = (p, prefix) => ({
  id: `${prefix}_${p.latitude.toFixed(5)}_${p.longitude.toFixed(5)}`,
  name: p.name,
  category: "pin",
  location: { latitude: p.latitude, longitude: p.longitude },
});

async function ownRide(req) {
  const ride = await Ride.findOne({ _id: req.params.id, rider: req.user._id });
  if (!ride) throw notFound("We couldn't find that ride.");
  return ride;
}

ridesRouter.post("/quote", async (req, res) => {
  const { pickup, destination } = tripPoints(req.body);
  const { quotes } = await quoteTrip(pickup, destination);
  res.json({ quotes });
});

ridesRouter.post("/", async (req, res) => {
  const { pickup, destination } = tripPoints(req.body);
  const rideType = oneOf(req.body.rideType, "Ride type", RIDE_TYPES);
  const paymentMethod = oneOf(req.body.paymentMethod, "Payment method", PAYMENT_METHODS);

  if (await Ride.exists({ rider: req.user._id, status: { $in: OPEN } })) throw conflict("You already have a ride in progress.", "ride_in_progress");

  // The price is worked out here, never taken from the app.
  const { quotes, pricing } = await quoteTrip(pickup, destination);
  const quote = quotes.find((q) => q.rideType === rideType);
  if (!quote) throw badRequest("That ride type isn't available right now.", "ride_type_unavailable");
  if (paymentMethod === "wallet" && req.user.walletBalance < quote.fare) throw lowBalance();

  const ride = await Ride.create({
    rider: req.user._id,
    pickup: asPlace(pickup, "pickup"),
    destination: asPlace(destination, "dest"),
    rideType,
    distanceKm: quote.distanceKm,
    durationMin: quote.durationMin,
    baseFare: quote.baseFare,
    ratePerKm: quote.ratePerKm,
    minimumFare: quote.minimumFare,
    fare: quote.fare,
    ...rideSplit(quote.fare, pricing),
    route: quote.route,
    paymentMethod,
    searchUntil: new Date(Date.now() + config.matching.timeoutSeconds * 1000),
  });
  offerNext(ride._id).catch((err) => log.error("matching failed to start", { ride: ride._id.toString(), err: err.message }));
  res.status(201).json({ ride: await rideView(ride) });
});

ridesRouter.get("/current", async (req, res) => {
  // The ride in progress, or a finished one still waiting for payment.
  const ride = await Ride.findOne({
    rider: req.user._id,
    $or: [{ status: { $in: OPEN } }, { status: "completed", paymentStatus: "pending" }],
  }).sort({ createdAt: -1 });
  res.json({ ride: ride ? await rideView(ride) : null });
});

ridesRouter.get("/history", async (req, res) => {
  const rides = await Ride.find({ rider: req.user._id, status: "completed" }).sort({ completedAt: -1 }).limit(50);
  const drivers = await Driver.find({ _id: { $in: rides.map((r) => r.driver).filter(Boolean) } }, { "personal.fullName": 1 });
  const names = new Map(drivers.map((d) => [d._id.toString(), d.personal?.fullName]));
  res.json({ trips: rides.map((r) => tripSummaryDTO(r, names.get(r.driver?.toString()))) });
});

ridesRouter.post("/:id/cancel", async (req, res) => {
  const reason = text(req.body?.reason, "Reason", { max: 300, optional: true });
  const ride = await Ride.findOneAndUpdate(
    { _id: req.params.id, rider: req.user._id, status: { $in: ["searching", "accepted", "arrived"] } },
    { status: "cancelled", cancelledAt: new Date(), cancelledBy: "rider", cancelReason: reason },
    { returnDocument: "before" },
  );
  if (!ride) {
    const existing = await ownRide(req);
    if (existing.status === "in_progress") throw conflict("Your trip has started, so it can't be cancelled in the app. Ask the driver to end it, or call support.", "trip_started");
    return res.json({ ride: await rideView(existing) }); // already over: nothing to do
  }
  await notifyCancelled(ride); // uses the offer/driver as they were before cancelling
  const updated = await Ride.findById(ride._id);
  res.json({ ride: await publishRide(updated) });
});

ridesRouter.post("/:id/rate", async (req, res) => {
  const stars = int(req.body?.stars, "Stars", { min: 1, max: 5 });
  const comment = text(req.body?.comment, "Comment", { max: 500, optional: true });
  const ride = await Ride.findOneAndUpdate(
    { _id: req.params.id, rider: req.user._id, status: "completed", "riderRating.stars": { $exists: false } },
    { riderRating: { stars, comment } },
    { returnDocument: "after" },
  );
  if (!ride) return res.json({ ok: true }); // already rated, or nothing to rate
  if (ride.driver) {
    const d = await Driver.findById(ride.driver, { rating: 1 });
    if (d) {
      const count = d.rating?.count ?? 0;
      const avg = count === 0 ? stars : ((d.rating.avg ?? 5) * count + stars) / (count + 1);
      await Driver.updateOne({ _id: d._id }, { rating: { avg: Math.round(avg * 100) / 100, count: count + 1 } });
    }
  }
  res.json({ ok: true });
});

ridesRouter.patch("/:id/payment", async (req, res) => {
  const paymentMethod = oneOf(req.body?.paymentMethod, "Payment method", PAYMENT_METHODS);
  const ride = await ownRide(req);
  if (["cancelled", "no_drivers"].includes(ride.status)) throw conflict("This ride has ended.", "ride_over");
  if (ride.paymentStatus === "paid") throw conflict("This ride is already paid.", "already_paid");

  if (paymentMethod === "wallet") {
    if (ride.status === "completed") {
      // Charge first; only switch to wallet if the money was there.
      const ok = await debitWallet(ride.rider, ride.fare, { label: `Ride to ${ride.destination.name}`, reference: `ride-${ride._id}`, ride: ride._id });
      if (!ok) throw lowBalance();
      await Ride.updateOne({ _id: ride._id }, { paymentMethod: "wallet" });
      await markRidePaid(ride._id, "wallet");
      return res.json({ ride: await rideView(await Ride.findById(ride._id)) });
    }
    if (req.user.walletBalance < ride.fare) throw lowBalance();
  }
  ride.paymentMethod = paymentMethod;
  await ride.save();
  res.json({ ride: await publishRide(ride) });
});

ridesRouter.post("/:id/pay", async (req, res) => {
  const ride = await ownRide(req);
  if (ride.paymentStatus === "paid") throw conflict("This ride is already paid.", "already_paid");
  if (ride.status !== "completed") throw conflict("You can pay once the trip ends.", "not_finished");
  if (ride.paymentMethod !== "card") {
    ride.paymentMethod = "card";
    await ride.save();
  }
  const reference = `CR-RIDE-${ride._id}-${randomBytes(3).toString("hex")}`;
  await Payment.create({ reference, user: req.user._id, kind: "ride", ride: ride._id, amount: ride.fare });
  const { checkoutUrl } = await createCheckout({
    reference,
    amountNaira: ride.fare,
    customer: { email: paymentEmail(req.user), name: req.user.name, phone: req.user.phone },
    description: `Trip to ${ride.destination.name}`,
    meta: { kind: "ride", rideId: ride._id.toString() },
  });
  res.json({ checkoutUrl });
});
