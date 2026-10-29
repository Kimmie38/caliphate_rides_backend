// What approved drivers do during trips. All need sign-in as an approved driver.
//   POST /driver/rides/:id/accept | /decline
//   POST /driver/rides/:id/arrived | /start | /complete
//   POST /driver/rides/:id/payment-received  { received: true }   (cash and transfer)
//   GET  /driver/rides/current                -> { trip | null }
//   GET  /driver/earnings                     -> { trips }
// Money (also for suspended drivers, so they can still get what they earned):
//   GET  /driver/wallet                       -> { balance, owed, blocked, settings, bank, ledger, withdrawals }
//   POST /driver/withdrawals { amount }       -> { withdrawal, balance }   (Flutterwave transfer to their bank)
//   POST /driver/wallet/pay  { amount? }      -> { checkoutUrl }           (pay commission owed, Flutterwave)
//   POST /driver/bank/verify                  -> { bank }                  (check the account with the bank again)
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { createCheckout, paymentEmail } from "../lib/flutterwave.js";
import { earningsDTO, rideRequestDTO } from "../lib/serialize.js";
import { requireApprovedDriver, requireDriver, requireUser } from "../middleware/auth.js";
import { int } from "../lib/validate.js";
import { Driver, DriverLedger, Payment, Ride, User, Withdrawal } from "../models/index.js";
import { ledgerDTO, payoutBlocker, requestWithdrawal, verifyDriverBank, withdrawalDTO } from "../services/driverMoney.js";
import { getPricing } from "../services/pricing.js";
import { acceptOffer, onDriverAvailable, passOn } from "../services/matching.js";
import { advanceRide, markRidePaid, rideView } from "../services/rides.js";

export const driverTripsRouter = Router();
driverTripsRouter.use(requireUser, requireDriver);

// Earnings stay visible to suspended drivers; trip actions need an approved account.
driverTripsRouter.get("/earnings", async (req, res) => {
  const since = new Date(Date.now() - 60 * 86400000);
  const rides = await Ride.find({ driver: req.driver._id, status: "completed", completedAt: { $gte: since } }).sort({ completedAt: -1 }).limit(500);
  res.json({ trips: rides.map(earningsDTO) });
});

async function walletView(driver) {
  const [pricing, ledger, withdrawals] = await Promise.all([
    getPricing(),
    DriverLedger.find({ driver: driver._id }).sort({ createdAt: -1 }).limit(100),
    Withdrawal.find({ driver: driver._id }).sort({ createdAt: -1 }).limit(20),
  ]);
  const balance = driver.balance ?? 0;
  const b = driver.bank ?? {};
  return {
    balance,
    owed: balance < 0 ? -balance : 0,
    blocked: balance < -pricing.owedLimit,
    settings: { commissionPercent: pricing.commissionPercent, owedLimit: pricing.owedLimit, minWithdrawal: pricing.minWithdrawal },
    bank: {
      bankName: b.bankName ?? "",
      accountEnding: (b.accountNumber ?? "").slice(-4),
      ...(b.verifiedName ? { verifiedName: b.verifiedName } : {}),
      canWithdraw: !payoutBlocker(driver),
      ...(payoutBlocker(driver) ? { problem: payoutBlocker(driver) } : {}),
    },
    ledger: ledger.map(ledgerDTO),
    withdrawals: withdrawals.map(withdrawalDTO),
  };
}

const canUseMoney = (driver) => ["approved", "suspended"].includes(driver.status);

driverTripsRouter.get("/wallet", async (req, res) => {
  res.json(await walletView(req.driver));
});

driverTripsRouter.post("/bank/verify", async (req, res) => {
  if (!canUseMoney(req.driver)) throw conflict("Your account needs to be approved first.", "not_approved");
  const driver = await verifyDriverBank(req.driver);
  res.json({ bank: (await walletView(driver)).bank });
});

driverTripsRouter.post("/withdrawals", async (req, res) => {
  if (!canUseMoney(req.driver)) throw conflict("Your account needs to be approved first.", "not_approved");
  const amount = int(req.body?.amount, "Amount", { min: 1 });
  let driver = req.driver;
  if (!driver.bank?.verifiedAt) driver = await verifyDriverBank(driver); // first withdrawal: check the account now
  const w = await requestWithdrawal(driver, amount);
  const fresh = await Driver.findById(driver._id, { balance: 1 });
  res.status(201).json({ withdrawal: withdrawalDTO(w), balance: fresh?.balance ?? 0 });
});

driverTripsRouter.post("/wallet/pay", async (req, res) => {
  const owed = Math.max(0, -(req.driver.balance ?? 0));
  if (!owed) throw badRequest("You don't owe anything right now.", "nothing_owed");
  const amount = req.body?.amount === undefined ? owed : int(req.body.amount, "Amount", { min: 100, max: owed });
  const user = req.user;
  const reference = `CR-DRP-${req.driver._id}-${randomBytes(4).toString("hex")}`;
  await Payment.create({ reference, user: user._id, kind: "driver_payment", driver: req.driver._id, amount });
  const { checkoutUrl } = await createCheckout({
    reference,
    amountNaira: amount,
    customer: { email: paymentEmail(user), name: req.driver.personal?.fullName || user.name, phone: user.phone },
    description: "Commission payment",
    meta: { kind: "driver_payment", driverId: req.driver._id.toString() },
  });
  res.json({ checkoutUrl });
});

driverTripsRouter.use(requireApprovedDriver);

driverTripsRouter.get("/rides/current", async (req, res) => {
  const ride = req.driver.currentRide ? await Ride.findById(req.driver.currentRide) : null;
  if (!ride) return res.json({ trip: null });
  const rider = await User.findById(ride.rider);
  const stage = { accepted: "to_pickup", arrived: "arrived", in_progress: "in_progress", completed: "payment" }[ride.status] ?? "done";
  res.json({ trip: { ...rideRequestDTO(ride, rider, Date.now()), stage, acceptedAt: ride.acceptedAt?.toISOString(), paymentStatus: ride.paymentStatus } });
});

driverTripsRouter.post("/rides/:id/accept", async (req, res) => {
  const ride = await acceptOffer(req.params.id, req.driver);
  res.json({ ok: true, ride: await rideView(ride) });
});

driverTripsRouter.post("/rides/:id/decline", async (req, res) => {
  await passOn(req.params.id, req.driver._id);
  res.json({ ok: true });
});

const step = (to) => async (req, res) => {
  const ride = await advanceRide(req.params.id, req.driver._id, to);
  if (to === "completed" && req.driver.online) {
    // Free again: offer any ride waiting nearby.
    onDriverAvailable({ ...req.driver.toObject(), currentRide: null }).catch(() => {});
  }
  res.json({ ok: true, ride: await rideView(ride) });
};
driverTripsRouter.post("/rides/:id/arrived", step("arrived"));
driverTripsRouter.post("/rides/:id/start", step("in_progress"));
driverTripsRouter.post("/rides/:id/complete", step("completed"));

driverTripsRouter.post("/rides/:id/payment-received", async (req, res) => {
  const ride = await Ride.findOne({ _id: req.params.id, driver: req.driver._id });
  if (!ride) throw notFound("We couldn't find that trip.");
  if (ride.status !== "completed") throw conflict("Complete the trip first.", "not_finished");
  if (!["cash", "transfer"].includes(ride.paymentMethod)) throw conflict("This rider pays in the app. You'll be notified when it's through.", "in_app_payment");
  await markRidePaid(ride._id, `driver confirmed ${ride.paymentMethod}`);
  res.json({ ok: true });
});
