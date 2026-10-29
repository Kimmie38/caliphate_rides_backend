// The web admin dashboard's API (the dashboard itself is in /public/dashboard and served at /dashboard).
// Sign in with email + password; everything else needs that token.
//   POST /admin/auth/login                         { email, password } -> { token, admin }
//   GET  /admin/me                                 GET /admin/settings (map, service area, place categories)
//   GET  /admin/stats                              numbers for the dashboard home
//   GET  /admin/config/pricing                     PUT /admin/config/pricing (fares, commission, payout settings)
//   GET  /admin/drivers?status=&q=&owing=1         GET /admin/drivers/:id
//   POST /admin/drivers/:id/review                 { action: approve|request_changes|reject|suspend|reinstate, note? }
//   POST /admin/drivers/:id/documents/:kind/review { action: approve|reject, note? }
//   POST /admin/drivers/:id/bank/verify            POST /admin/drivers/:id/bank/approve { note }
//   POST /admin/drivers/:id/adjust                 { amount, reason }   (+ gives the driver money, − takes it)
//   POST /admin/drivers/:id/recompute
//   GET  /admin/finance                            GET /admin/withdrawals?status=
//   POST /admin/withdrawals/:id/check              POST /admin/withdrawals/:id/resolve { outcome: successful|failed, note }
//   GET  /admin/rides?status=                      GET /admin/riders?q=   POST /admin/riders/:id/block { blocked }
//   GET/POST /admin/places   PUT/DELETE /admin/places/:id
//   GET /admin/admins  POST /admin/admins { email, name, password }  POST /admin/admins/:id/active { active }  (owner only)
import { Router } from "express";
import { config } from "../config.js";
import { badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { DOCUMENT_KINDS, documentRequirement, drivingBlockers } from "../lib/driverRules.js";
import { signToken } from "../lib/jwt.js";
import { hashPassword, checkPassword } from "../lib/password.js";
import { DEFAULT_PRICING, LIMITS, RIDE_TYPES } from "../lib/pricing.js";
import { applicationDTO, placeDTO } from "../lib/serialize.js";
import { bool, int, obj, oneOf, point, text } from "../lib/validate.js";
import { requireAdmin, requireOwner } from "../middleware/auth.js";
import { rateLimit } from "../middleware/http.js";
import {
  Admin, Config, Driver, DriverLedger, PLACE_CATEGORIES, Place, Payment, RIDE_STATUSES, Ride, User, WITHDRAWAL_STATUSES, Withdrawal,
} from "../models/index.js";
import {
  checkWithdrawal, completeWithdrawal, failWithdrawal, ledgerDTO, postLedger, recomputeBalance, verifyDriverBank,
} from "../services/driverMoney.js";
import { clearPricingCache, getPricing } from "../services/pricing.js";
import { emitTo, userRoom } from "../services/realtime.js";

export const adminRouter = Router();

const adminDTO = (a) => ({ id: a._id.toString(), email: a.email, name: a.name, role: a.role, active: a.active, lastLoginAt: a.lastLoginAt?.toISOString() });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const event = (text, by) => ({ at: new Date(), event: text, by });
const who = (req) => req.admin.name || req.admin.email;
const naira = (n) => `₦${Math.round(n).toLocaleString("en-NG")}`;

/** Start of today in Nigeria (UTC+1), whatever time zone the server runs in. */
function lagosDayStart(daysAgo = 0) {
  const lagos = new Date(Date.now() + 3600_000);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() - daysAgo) - 3600_000);
}

// ---------- sign in ----------

adminRouter.post(
  "/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many sign-in attempts. Try again in 15 minutes." }),
  async (req, res) => {
    const email = text(req.body?.email, "Email", { min: 3, max: 120 }).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const admin = await Admin.findOne({ email });
    if (!admin || !admin.active || !(await checkPassword(password, admin.passwordHash))) throw unauthorized("Email or password is wrong.", "bad_login");
    admin.lastLoginAt = new Date();
    await admin.save();
    const token = signToken({ sub: admin._id.toString(), role: "admin" }, config.jwtSecret, { days: 1 });
    res.json({ token, admin: adminDTO(admin) });
  },
);

adminRouter.use(requireAdmin);

adminRouter.get("/me", (req, res) => res.json({ admin: adminDTO(req.admin) }));

adminRouter.get("/settings", (_req, res) => {
  res.json({
    mapStyleUrl: config.admin.mapStyleUrl,
    serviceArea: config.serviceArea,
    placeCategories: PLACE_CATEGORIES,
    limits: LIMITS,
    paymentsReady: !!config.flutterwave.secretKey,
  });
});

// ---------- dashboard numbers ----------

adminRouter.get("/stats", async (_req, res) => {
  const start = lagosDayStart();
  const [riders, approved, waiting, changes, online, ridesToday, completedToday, inProgress, today, payoutsWaiting] = await Promise.all([
    User.countDocuments(),
    Driver.countDocuments({ status: "approved" }),
    Driver.countDocuments({ status: "submitted" }),
    Driver.countDocuments({ status: "changes_requested" }),
    Driver.countDocuments({ status: "approved", online: true }),
    Ride.countDocuments({ createdAt: { $gte: start } }),
    Ride.countDocuments({ status: "completed", completedAt: { $gte: start } }),
    Ride.countDocuments({ status: { $in: ["searching", "accepted", "arrived", "in_progress"] } }),
    Ride.aggregate([{ $match: { status: "completed", completedAt: { $gte: start } } }, { $group: { _id: null, fares: { $sum: "$fare" }, commission: { $sum: "$commission" } } }]),
    Withdrawal.countDocuments({ status: { $in: ["processing", "needs_check"] } }),
  ]);
  res.json({
    riders,
    drivers: { approved, waitingForReview: waiting, changesRequested: changes, online },
    rides: { today: ridesToday, completedToday, inProgress },
    faresToday: today[0]?.fares ?? 0,
    commissionToday: today[0]?.commission ?? 0,
    payoutsWaiting,
  });
});

// ---------- fares, commission and payouts ----------

adminRouter.get("/config/pricing", async (_req, res) => {
  const doc = await Config.findById("pricing", { history: 1 }).lean();
  res.json({ ...(await getPricing()), defaults: DEFAULT_PRICING, history: (doc?.history ?? []).slice(0, 30) });
});

const money = (v, label, k) => int(v, label, LIMITS[k]);

adminRouter.put("/config/pricing", async (req, res) => {
  const body = obj(req.body);
  const current = await getPricing();
  const next = structuredClone(current);
  const changes = [];
  const note = (label, from, to, fmt = naira) => { if (from !== to) changes.push(`${label} ${fmt(from)} → ${fmt(to)}`); };
  const pct = (n) => `${n}%`;

  if (body.rideTypes !== undefined) {
    if (!Array.isArray(body.rideTypes)) throw badRequest("Ride types must be a list.");
    for (const change of body.rideTypes) {
      const id = oneOf(change?.id, "Ride type", RIDE_TYPES);
      const t = next.rideTypes.find((r) => r.id === id);
      const before = { ...t };
      if (change.enabled !== undefined) t.enabled = bool(change.enabled, `${t.name} on/off`);
      if (change.baseFare !== undefined) t.baseFare = money(change.baseFare, `${t.name} base fare`, "baseFare");
      if (change.perKm !== undefined) t.perKm = money(change.perKm, `${t.name} price per km`, "perKm");
      if (change.minimumFare !== undefined) t.minimumFare = money(change.minimumFare, `${t.name} minimum fare`, "minimumFare");
      if (before.enabled !== t.enabled) changes.push(`${t.name} ${t.enabled ? "turned on" : "turned off"}`);
      note(`${t.name} base fare`, before.baseFare, t.baseFare);
      note(`${t.name} per km`, before.perKm, t.perKm);
      note(`${t.name} minimum`, before.minimumFare, t.minimumFare);
    }
    if (!next.rideTypes.some((t) => t.enabled)) throw badRequest("At least one ride type has to stay on.");
  }
  if (body.commissionPercent !== undefined) next.commissionPercent = money(body.commissionPercent, "Commission", "commissionPercent");
  if (body.owedLimit !== undefined) next.owedLimit = money(body.owedLimit, "Most a driver can owe", "owedLimit");
  if (body.minWithdrawal !== undefined) next.minWithdrawal = money(body.minWithdrawal, "Smallest withdrawal", "minWithdrawal");
  if (body.roundTo !== undefined) next.roundTo = oneOf(Number(body.roundTo), "Round fares to", LIMITS.roundTo);
  note("Commission", current.commissionPercent, next.commissionPercent, pct);
  note("Most a driver can owe", current.owedLimit, next.owedLimit);
  note("Smallest withdrawal", current.minWithdrawal, next.minWithdrawal);
  note("Fares rounded to", current.roundTo, next.roundTo);

  if (!changes.length) return res.json({ ...current, defaults: DEFAULT_PRICING, unchanged: true });

  await Config.findByIdAndUpdate(
    "pricing",
    {
      $set: {
        currency: "NGN",
        roundTo: next.roundTo,
        rideTypes: next.rideTypes.map(({ id, name, seats, enabled, baseFare, perKm, minimumFare }) => ({ id, name, seats, enabled, baseFare, perKm, minimumFare })),
        commissionPercent: next.commissionPercent,
        owedLimit: next.owedLimit,
        minWithdrawal: next.minWithdrawal,
        updatedBy: req.admin.email,
      },
      $unset: { ratePerKm: 1 },
      $push: { history: { $each: [{ at: new Date(), by: who(req), summary: changes.join(", ") }], $position: 0, $slice: 100 } },
    },
    { upsert: true },
  );
  clearPricingCache();
  const doc = await Config.findById("pricing", { history: 1 }).lean();
  res.json({ ...(await getPricing()), defaults: DEFAULT_PRICING, history: (doc?.history ?? []).slice(0, 30) });
});

// ---------- drivers ----------

adminRouter.get("/drivers", async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = oneOf(req.query.status, "Status", ["draft", "submitted", "changes_requested", "approved", "rejected", "suspended"]);
  if (req.query.owing === "1") filter.balance = { $lt: 0 };
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ "personal.fullName": rx }, { recordId: rx }, { "vehicle.plate": rx }];
  }
  const sort = req.query.owing === "1" ? { balance: 1 } : { submittedAt: -1, createdAt: -1 };
  const drivers = await Driver.find(filter).sort(sort).limit(300).populate("user", "phone");
  res.json({
    drivers: drivers.map((d) => ({
      id: d._id.toString(),
      recordId: d.recordId,
      name: d.personal?.fullName ?? "",
      phone: d.user?.phone ?? "",
      vehicleType: d.vehicleType,
      plate: d.vehicle?.plate ?? "",
      status: d.status,
      online: d.online,
      rating: d.rating?.avg ?? 5,
      trips: d.tripsCount ?? 0,
      balance: d.balance ?? 0,
      submittedAt: d.submittedAt?.toISOString(),
    })),
  });
});

async function loadDriver(id) {
  const d = await Driver.findById(id).populate("user", "phone name");
  if (!d) throw notFound("Driver not found.");
  return d;
}

async function fullDriver(d) {
  const [ledger, withdrawals, pricing] = await Promise.all([
    DriverLedger.find({ driver: d._id }).sort({ createdAt: -1 }).limit(100),
    Withdrawal.find({ driver: d._id }).sort({ createdAt: -1 }).limit(30),
    getPricing(),
  ]);
  const b = d.bank ?? {};
  return {
    id: d._id.toString(),
    phone: d.user?.phone ?? "",
    rating: d.rating?.avg ?? 5,
    trips: d.tripsCount ?? 0,
    online: d.online,
    blockers: drivingBlockers(d.toObject({ flattenMaps: true })),
    ...applicationDTO(d),
    money: {
      balance: d.balance ?? 0,
      blocked: (d.balance ?? 0) < -pricing.owedLimit,
      bank: {
        bankName: b.bankName ?? "", accountNumber: b.accountNumber ?? "", accountName: b.accountName ?? "",
        bankCode: b.bankCode, verifiedName: b.verifiedName, verifiedAt: b.verifiedAt?.toISOString(),
        nameMatches: b.nameMatches, approvedBy: b.approvedBy, verifyError: b.verifyError,
      },
      ledger: ledger.map((e) => ({ ...ledgerDTO(e), ...(e.by ? { by: e.by } : {}) })),
      withdrawals: withdrawals.map(adminWithdrawalDTO),
    },
  };
}

adminRouter.get("/drivers/:id", async (req, res) => {
  res.json({ driver: await fullDriver(await loadDriver(req.params.id)) });
});

const REVIEW = {
  approve: { from: ["submitted", "changes_requested", "rejected"], to: "approved", text: "Approved to drive", needsNote: false },
  request_changes: { from: ["submitted"], to: "changes_requested", text: "Changes requested", needsNote: true },
  reject: { from: ["submitted", "changes_requested"], to: "rejected", text: "Application rejected", needsNote: true },
  suspend: { from: ["approved"], to: "suspended", text: "Account put on hold", needsNote: true },
  reinstate: { from: ["suspended"], to: "approved", text: "Account reinstated", needsNote: false },
};

adminRouter.post("/drivers/:id/review", async (req, res) => {
  const action = oneOf(req.body?.action, "Action", Object.keys(REVIEW));
  const rule = REVIEW[action];
  const note = text(req.body?.note, "Note", { max: 500, min: rule.needsNote ? 3 : 0, optional: !rule.needsNote });
  const d = await loadDriver(req.params.id);
  if (!rule.from.includes(d.status)) throw conflict(`Can't ${action.replace("_", " ")} a driver whose status is "${d.status}".`);

  d.status = rule.to;
  d.reviewNote = note || undefined;
  d.timeline.unshift(event(note ? `${rule.text}: ${note}` : rule.text, who(req)));
  if (action === "approve") {
    d.approvedAt = new Date();
    // Approving the application approves the documents it was approved with.
    for (const [kind, doc] of d.documents) {
      if (doc.current?.status === "pending") {
        doc.current.status = "approved";
        doc.current.reviewedBy = req.admin.email;
        doc.current.reviewedAt = new Date();
        d.documents.set(kind, doc);
      }
    }
    d.markModified("documents");
  }
  if (action === "suspend") d.online = false;
  await d.save();
  if (action === "suspend") emitTo(userRoom(d.user._id), "driver:error", { message: "Your driver account is on hold. Call driver support." });
  res.json({ driver: await fullDriver(d) });
});

adminRouter.post("/drivers/:id/documents/:kind/review", async (req, res) => {
  const kind = oneOf(req.params.kind, "Document", DOCUMENT_KINDS);
  const action = oneOf(req.body?.action, "Action", ["approve", "reject"]);
  const note = text(req.body?.note, "Note", { max: 500, min: action === "reject" ? 3 : 0, optional: action !== "reject" });
  const d = await loadDriver(req.params.id);
  const doc = d.documents.get(kind);
  if (!doc?.current) throw notFound("This driver hasn't uploaded that document.");
  doc.current.status = action === "approve" ? "approved" : "rejected";
  doc.current.reviewNote = note || undefined;
  doc.current.reviewedBy = req.admin.email;
  doc.current.reviewedAt = new Date();
  d.documents.set(kind, doc);
  d.markModified("documents");
  const title = documentRequirement(kind).title;
  d.timeline.unshift(event(action === "approve" ? `${title} approved` : `${title} rejected: ${note}`, who(req)));
  await d.save();
  res.json({ driver: await fullDriver(d) });
});

// ---------- driver money ----------

adminRouter.post("/drivers/:id/bank/verify", async (req, res) => {
  const d = await loadDriver(req.params.id);
  await verifyDriverBank(d);
  res.json({ driver: await fullDriver(await loadDriver(d._id)) });
});

adminRouter.post("/drivers/:id/bank/approve", async (req, res) => {
  const note = text(req.body?.note, "Note", { min: 3, max: 300 });
  const d = await loadDriver(req.params.id);
  if (!d.bank?.verifiedName) throw conflict("Check the account with the bank first.", "not_checked");
  await Driver.updateOne({ _id: d._id }, { "bank.approvedBy": req.admin.email });
  await Driver.updateOne({ _id: d._id }, { $push: { timeline: { $each: [event(`Bank account accepted (${d.bank.verifiedName}): ${note}`, who(req))], $position: 0 } } });
  res.json({ driver: await fullDriver(await loadDriver(d._id)) });
});

adminRouter.post("/drivers/:id/adjust", async (req, res) => {
  const amount = int(req.body?.amount, "Amount", { min: -500_000, max: 500_000 });
  if (amount === 0) throw badRequest("Enter an amount other than zero.");
  const reason = text(req.body?.reason, "Reason", { min: 3, max: 200 });
  const d = await loadDriver(req.params.id);
  await postLedger(d._id, amount, {
    kind: "adjustment", label: `Correction by Caliphate Rides: ${reason}`, reference: `adjust-${d._id}-${Date.now()}`, by: req.admin.email,
  });
  await Driver.updateOne({ _id: d._id }, { $push: { timeline: { $each: [event(`Balance ${amount > 0 ? "increased" : "reduced"} by ${naira(Math.abs(amount))}: ${reason}`, who(req))], $position: 0 } } });
  res.json({ driver: await fullDriver(await loadDriver(d._id)) });
});

adminRouter.post("/drivers/:id/recompute", async (req, res) => {
  const d = await loadDriver(req.params.id);
  await recomputeBalance(d._id);
  res.json({ driver: await fullDriver(await loadDriver(d._id)) });
});

// ---------- money overview and payouts ----------

function adminWithdrawalDTO(w) {
  return {
    id: w._id.toString(),
    driverId: (w.driver?._id ?? w.driver)?.toString(),
    driverName: w.driver?.personal?.fullName,
    amount: w.amount,
    fee: w.fee,
    status: w.status,
    reference: w.reference,
    providerId: w.providerId,
    bank: w.bank,
    failureReason: w.failureReason,
    resolvedBy: w.resolvedBy,
    createdAt: w.createdAt?.toISOString(),
    completedAt: w.completedAt?.toISOString(),
  };
}

adminRouter.get("/finance", async (_req, res) => {
  const ranges = { today: lagosDayStart(), week: lagosDayStart(6), month: lagosDayStart(29) };
  const periods = {};
  for (const [name, since] of Object.entries(ranges)) {
    const [r] = await Ride.aggregate([
      { $match: { status: "completed", completedAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          trips: { $sum: 1 },
          fares: { $sum: "$fare" },
          commission: { $sum: "$commission" },
          inApp: { $sum: { $cond: [{ $in: ["$paymentMethod", ["card", "wallet"]] }, "$fare", 0] } },
          direct: { $sum: { $cond: [{ $in: ["$paymentMethod", ["cash", "transfer"]] }, "$fare", 0] } },
        },
      },
    ]);
    const [paid] = await Withdrawal.aggregate([{ $match: { status: "successful", completedAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: "$amount" }, fees: { $sum: "$fee" } } }]);
    const [driverPaid] = await Payment.aggregate([{ $match: { kind: "driver_payment", status: "success", paidAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
    periods[name] = {
      trips: r?.trips ?? 0, fares: r?.fares ?? 0, commission: r?.commission ?? 0, inApp: r?.inApp ?? 0, direct: r?.direct ?? 0,
      paidOut: paid?.total ?? 0, payoutFees: paid?.fees ?? 0, paidByDrivers: driverPaid?.total ?? 0,
    };
  }
  const [owe] = await Driver.aggregate([{ $match: { balance: { $lt: 0 } } }, { $group: { _id: null, total: { $sum: "$balance" }, count: { $sum: 1 } } }]);
  const [owed] = await Driver.aggregate([{ $match: { balance: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: "$balance" }, count: { $sum: 1 } } }]);
  const [onTheWay] = await Withdrawal.aggregate([{ $match: { status: { $in: ["processing", "needs_check"] } } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]);
  const pricing = await getPricing();
  res.json({
    periods,
    driversOwe: { total: -(owe?.total ?? 0), drivers: owe?.count ?? 0 },
    owedToDrivers: { total: owed?.total ?? 0, drivers: owed?.count ?? 0 },
    payoutsOnTheWay: { total: onTheWay?.total ?? 0, count: onTheWay?.count ?? 0 },
    needsCheck: await Withdrawal.countDocuments({ status: "needs_check" }),
    settings: { commissionPercent: pricing.commissionPercent, owedLimit: pricing.owedLimit, minWithdrawal: pricing.minWithdrawal },
  });
});

adminRouter.get("/withdrawals", async (req, res) => {
  const filter = req.query.status ? { status: oneOf(req.query.status, "Status", WITHDRAWAL_STATUSES) } : {};
  const list = await Withdrawal.find(filter).sort({ createdAt: -1 }).limit(200).populate("driver", "personal.fullName");
  res.json({ withdrawals: list.map(adminWithdrawalDTO) });
});

adminRouter.post("/withdrawals/:id/check", async (req, res) => {
  const w = await Withdrawal.findById(req.params.id);
  if (!w) throw notFound("Withdrawal not found.");
  if (!w.providerId) throw conflict("Flutterwave never gave this payout an id. Look it up by its reference in the Flutterwave dashboard, then mark it.", "no_provider_id");
  await checkWithdrawal(w);
  res.json({ withdrawal: adminWithdrawalDTO(await Withdrawal.findById(w._id).populate("driver", "personal.fullName")) });
});

adminRouter.post("/withdrawals/:id/resolve", async (req, res) => {
  const outcome = oneOf(req.body?.outcome, "Outcome", ["successful", "failed"]);
  const note = text(req.body?.note, "Note", { min: 3, max: 300 });
  const w = await Withdrawal.findById(req.params.id);
  if (!w) throw notFound("Withdrawal not found.");
  if (!["processing", "needs_check"].includes(w.status)) throw conflict("This payout is already settled.", "already_settled");
  if (outcome === "successful") await completeWithdrawal(w._id, req.admin.email);
  else await failWithdrawal(w._id, `Checked by Caliphate Rides: ${note}`, req.admin.email);
  res.json({ withdrawal: adminWithdrawalDTO(await Withdrawal.findById(w._id).populate("driver", "personal.fullName")) });
});

// ---------- rides and riders ----------

adminRouter.get("/rides", async (req, res) => {
  const filter = req.query.status ? { status: oneOf(req.query.status, "Status", RIDE_STATUSES) } : {};
  const rides = await Ride.find(filter).sort({ createdAt: -1 }).limit(200).populate("rider", "phone name").populate("driver", "personal.fullName vehicle.plate");
  res.json({
    rides: rides.map((r) => ({
      id: r._id.toString(),
      status: r.status,
      rider: { name: r.rider?.name ?? "", phone: r.rider?.phone ?? "" },
      driver: r.driver ? { id: r.driver._id.toString(), name: r.driver.personal?.fullName ?? "", plate: r.driver.vehicle?.plate ?? "" } : null,
      pickup: r.pickup.name,
      destination: r.destination.name,
      rideType: r.rideType,
      distanceKm: r.distanceKm,
      fare: r.fare,
      commission: r.commission ?? 0,
      driverEarning: r.driverEarning ?? r.fare,
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString(),
    })),
  });
});

adminRouter.get("/riders", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filter = q ? { $or: [{ name: new RegExp(escapeRegex(q), "i") }, { phone: new RegExp(escapeRegex(q.replace(/\s/g, ""))) }] } : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({
    riders: users.map((u) => ({ id: u._id.toString(), name: u.name, phone: u.phone, walletBalance: u.walletBalance, blocked: u.blocked, joinedAt: u.createdAt.toISOString() })),
  });
});

adminRouter.post("/riders/:id/block", async (req, res) => {
  const blocked = bool(req.body?.blocked, "Blocked");
  const u = await User.findByIdAndUpdate(req.params.id, { blocked }, { returnDocument: "after" });
  if (!u) throw notFound("Rider not found.");
  res.json({ ok: true, blocked: u.blocked });
});

// ---------- places on the map ----------

const adminPlace = (p) => ({
  ...placeDTO({ ...p, id: p.slug }),
  dbId: p._id.toString(),
  popular: !!p.popular,
  active: p.active !== false,
  source: p.source ?? "admin",
  ...(p.addedBy ? { addedBy: p.addedBy } : {}),
  updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined,
});

adminRouter.get("/places", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filter = q ? { $or: [{ name: new RegExp(escapeRegex(q), "i") }, { subtitle: new RegExp(escapeRegex(q), "i") }] } : {};
  const places = await Place.find(filter).sort({ name: 1 }).limit(5000).lean();
  res.json({ places: places.map(adminPlace) });
});

function placeInput(body) {
  const b = obj(body);
  const at = point({ name: b.name, latitude: b.latitude, longitude: b.longitude }, "Place");
  const a = config.serviceArea;
  if (a && !(at.latitude >= a.south - 0.2 && at.latitude <= a.north + 0.2 && at.longitude >= a.west - 0.2 && at.longitude <= a.east + 0.2)) {
    throw badRequest("That pin is far outside Sokoto. Move it onto the map of the city.", "outside_service_area");
  }
  return {
    name: text(b.name, "Name", { min: 2, max: 80 }),
    subtitle: text(b.subtitle, "Description", { max: 80, optional: true }),
    category: b.category === undefined || b.category === "" ? "landmark" : oneOf(b.category, "Category", PLACE_CATEGORIES),
    location: { latitude: Math.round(at.latitude * 1e6) / 1e6, longitude: Math.round(at.longitude * 1e6) / 1e6 },
    popular: b.popular === true,
    active: b.active !== false,
  };
}

adminRouter.post("/places", async (req, res) => {
  const p = placeInput(req.body);
  const near = await Place.findOne({ name: new RegExp(`^${escapeRegex(p.name)}$`, "i") }).lean();
  if (near && Math.abs(near.location.latitude - p.location.latitude) < 0.002 && Math.abs(near.location.longitude - p.location.longitude) < 0.002) {
    throw conflict(`"${near.name}" is already on the map right there.`, "duplicate_place");
  }
  const slug = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${Date.now().toString(36)}`;
  const place = await Place.create({ ...p, slug, source: "admin", addedBy: req.admin.email });
  res.status(201).json({ place: adminPlace(place.toObject()) });
});

adminRouter.put("/places/:id", async (req, res) => {
  const place = await Place.findByIdAndUpdate(req.params.id, placeInput(req.body), { returnDocument: "after" });
  if (!place) throw notFound("Place not found.");
  res.json({ place: adminPlace(place.toObject()) });
});

adminRouter.delete("/places/:id", async (req, res) => {
  await Place.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ---------- admins (owner only) ----------

adminRouter.get("/admins", requireOwner, async (_req, res) => {
  const admins = await Admin.find().sort({ createdAt: 1 });
  res.json({ admins: admins.map(adminDTO) });
});

adminRouter.post("/admins", requireOwner, async (req, res) => {
  const email = text(req.body?.email, "Email", { min: 3, max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Check the email address.");
  const name = text(req.body?.name, "Name", { max: 80, optional: true });
  const password = text(req.body?.password, "Password", { min: 10, max: 200 });
  if (await Admin.exists({ email })) throw conflict("There's already an admin with that email.");
  const admin = await Admin.create({ email, name, passwordHash: await hashPassword(password), role: "admin" });
  res.status(201).json({ admin: adminDTO(admin) });
});

adminRouter.post("/admins/:id/active", requireOwner, async (req, res) => {
  const active = bool(req.body?.active, "Active");
  if (req.params.id === req.admin._id.toString()) throw conflict("You can't turn off your own account.");
  const admin = await Admin.findByIdAndUpdate(req.params.id, { active }, { returnDocument: "after" });
  if (!admin) throw notFound("Admin not found.");
  res.json({ admin: adminDTO(admin) });
});
