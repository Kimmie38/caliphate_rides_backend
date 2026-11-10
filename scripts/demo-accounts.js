// Creates (or resets) two ready-to-use accounts for presenting the app:
//   Rider   0800 000 0001  "Aisha Bello"          ₦20,000 in her wallet and a few past trips
//   Driver  0800 000 0002  "Abubakar Sani Musa"   approved keke driver with all documents and a balance to withdraw
// Both sign in with the code in DEMO_LOGINS (see DEPLOY-VPS.md, "Demo accounts"), no SMS needed.
//
// Run on the VPS:   docker exec caliphate-api node scripts/demo-accounts.js
// Run it again any time to put both accounts back to how they started (it only touches these two accounts).
// Remove them after the demo:   docker exec caliphate-api node scripts/demo-accounts.js --remove
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { checkConfig, config } from "../src/config.js";
import { normalizeNgPhone } from "../src/lib/phone.js";
import { Driver, DriverLedger, Payment, Place, Ride, User, WalletTransaction, Withdrawal } from "../src/models/index.js";
import { ensureDefaults } from "../src/services/bootstrap.js";

const RIDER = { phone: "08000000001", name: "Aisha Bello", email: "aisha.demo@caliphaterides.com.ng", wallet: 20000 };
const DRIVER = { phone: "08000000002", name: "Abubakar Sani Musa", email: "abubakar.demo@caliphaterides.com.ng" };
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "demo-assets");
const remove = process.argv.includes("--remove");

checkConfig();
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
await ensureDefaults();

const riderPhone = normalizeNgPhone(RIDER.phone);
const driverPhone = normalizeNgPhone(DRIVER.phone);

/** Clears everything these two accounts did, so each run starts clean. */
async function wipe() {
  const users = await User.find({ phone: { $in: [riderPhone, driverPhone] } });
  const ids = users.map((u) => u._id);
  const drivers = await Driver.find({ user: { $in: ids } });
  const dIds = drivers.map((d) => d._id);
  await Ride.deleteMany({ $or: [{ rider: { $in: ids } }, { driver: { $in: dIds } }] });
  await WalletTransaction.deleteMany({ user: { $in: ids } });
  await Payment.deleteMany({ user: { $in: ids } });
  await DriverLedger.deleteMany({ driver: { $in: dIds } });
  await Withdrawal.deleteMany({ driver: { $in: dIds } });
  // The sample photos stored on the last run.
  const files = drivers.flatMap((d) => [...(d.documents?.values?.() ?? [])].flatMap((doc) => [doc.current, ...(doc.history ?? [])].filter(Boolean).flatMap((v) => v.files ?? [])));
  if (files.length && config.storage === "mongo") {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "documents" });
    for (const f of await bucket.find({ filename: { $in: files } }).toArray()) await bucket.delete(f._id).catch(() => {});
  } else if (files.length) {
    await Promise.all(files.map((f) => unlink(join(config.uploadDir, f)).catch(() => {})));
  }
  return { users, drivers };
}

if (remove) {
  const { users, drivers } = await wipe();
  await Driver.deleteMany({ _id: { $in: drivers.map((d) => d._id) } });
  await User.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  console.log("Demo accounts removed. Also delete DEMO_LOGINS from .env and redeploy.");
  await mongoose.disconnect();
  process.exit(0);
}

await wipe();

/** Stores a sample photo where the server keeps document photos (MongoDB or disk). */
async function storeSample(file) {
  const name = `${randomBytes(16).toString("hex")}.jpg`;
  const src = join(ASSETS, file);
  if (config.storage === "mongo") {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "documents" });
    await pipeline(createReadStream(src), bucket.openUploadStream(name, { metadata: { contentType: "image/jpeg" } }));
  } else {
    await mkdir(config.uploadDir, { recursive: true });
    await copyFile(src, join(config.uploadDir, name));
  }
  return name;
}

const now = Date.now();
const day = 86_400_000;
const hr = 3_600_000;

// ---- Rider
const rider = await User.findOneAndUpdate(
  { phone: riderPhone },
  { $set: { name: RIDER.name, email: RIDER.email, language: "en", walletBalance: RIDER.wallet, blocked: false, rating: { avg: 4.9, count: 12 } } },
  { upsert: true, returnDocument: "after" },
);

// ---- Driver (a keke driven for its owner, every document approved)
const driverUser = await User.findOneAndUpdate(
  { phone: driverPhone },
  { $set: { name: DRIVER.name, email: DRIVER.email, language: "en", blocked: false } },
  { upsert: true, returnDocument: "after" },
);
const approved = async (files, extra = {}) => ({
  current: { files: await Promise.all(files.map(storeSample)), uploadedAt: new Date(now - 10 * day), status: "approved", reviewedBy: "demo", reviewedAt: new Date(now - 9 * day), ...extra },
  history: [],
});
const documents = {
  licence: { kind: "licence", ...(await approved(["licence-front.jpg", "licence-back.jpg"], { variant: "Driver's licence", number: "SKT 21345 AA19", expiry: "2028-03-14" })) },
  proof_of_address: { kind: "proof_of_address", ...(await approved(["proof-of-address.jpg"], { variant: "Electricity bill" })) },
  selfie: { kind: "selfie", ...(await approved(["selfie.jpg"])) },
  vehicle_photo: { kind: "vehicle_photo", ...(await approved(["vehicle-photo.jpg"])) },
  vehicle_licence: { kind: "vehicle_licence", ...(await approved(["vehicle-licence.jpg"], { expiry: "2027-01-31" })) },
  ownership: { kind: "ownership", ...(await approved(["ownership.jpg"])) },
  owner_letter: { kind: "owner_letter", ...(await approved(["owner-letter.jpg"])) },
  owner_id: { kind: "owner_id", ...(await approved(["owner-id.jpg"], { variant: "NIN slip or card", number: "1234 567 8901" })) },
  insurance: { kind: "insurance", ...(await approved(["insurance.jpg"], { number: "TP/SK/2026/88412", expiry: "2027-10-30" })) },
};
const existing = await Driver.findOne({ user: driverUser._id });
const driverFields = {
  user: driverUser._id,
  status: "approved",
  vehicleType: "keke",
  personal: { fullName: DRIVER.name, dateOfBirth: "1988-05-10", gender: "male", address: "14 Sultan Bello Road, Sokoto", state: "Sokoto", lga: "Sokoto North", nin: "12345678901", email: DRIVER.email },
  vehicle: { make: "Bajaj", model: "RE", year: "2021", colour: "Yellow", plate: "SKT 482 KK", ownsVehicle: false },
  guarantor: { fullName: "Alhaji Musa Sani", phone: "+2348039876543", relationship: "Parent", address: "Mabera, Sokoto" },
  owner: { fullName: "Alhaji Umar Bello", phone: "+2348035551234", email: "umar.bello@example.com", address: "7 Gidan Dare Road, Sokoto" },
  bank: {
    bankName: "GTBank", accountNumber: "0123456789", accountName: DRIVER.name, bankCode: config.paymentProvider === "demo" ? "000" : "058",
    codeFrom: config.paymentProvider, verifiedName: DRIVER.name.toUpperCase(), verifiedAt: new Date(now - 9 * day), nameMatches: true,
  },
  documents,
  declaration: { signedName: DRIVER.name, signedAt: new Date(now - 10 * day) },
  submittedAt: new Date(now - 10 * day),
  approvedAt: new Date(now - 9 * day),
  timeline: [
    { at: new Date(now - 10 * day), event: "Application submitted", by: DRIVER.name },
    { at: new Date(now - 9 * day), event: "Approved (demo account)", by: "demo" },
  ],
  tripsCount: 3,
  rating: { avg: 4.8, count: 3 },
  balance: 0,
  online: false,
  currentRide: null,
  location: { type: "Point", coordinates: [5.2301, 13.0615] },
  lastSeenAt: new Date(now - hr),
};
const driver = existing
  ? await Driver.findOneAndUpdate({ _id: existing._id }, { $set: driverFields, $unset: { reviewNote: 1 } }, { returnDocument: "after" })
  : await Driver.create({ ...driverFields, recordId: `CR-DRV-${new Date().getFullYear()}-DEMO02` });

// ---- Three past trips between them: they fill the rider's trip list and the driver's earnings.
const at = (slug) => Place.findOne({ slug }).lean();
const trips = [
  { from: "babbar-kasuwa", to: "udus-city-campus", km: 3.2, method: "wallet", ago: 2 * day + 3 * hr },
  { from: "sultan-bello-mosque", to: "karaye-hospital", km: 2.4, method: "cash", ago: day + 5 * hr },
  { from: "udus-city-campus", to: "marna-market", km: 2.7, method: "card", ago: 6 * hr },
];
let balance = 0;
let ledgerN = 0;
let walletSpent = 0;
const ledger = async (kind, label, amount, ride, when) => {
  balance += amount;
  const row = await DriverLedger.create({ driver: driver._id, kind, label, amount, balanceAfter: balance, ride, reference: `demo-${driver._id}-${now}-${ledgerN++}` });
  await DriverLedger.collection.updateOne({ _id: row._id }, { $set: { createdAt: when } });
};
for (const t of trips) {
  const [a, b] = await Promise.all([at(t.from), at(t.to)]);
  if (!a || !b) continue;
  const fare = Math.max(500, Math.round((t.km * 500) / 50) * 50);
  const commission = Math.round(fare * 0.15);
  const done = new Date(now - t.ago);
  const place = (p) => ({ id: p.slug, name: p.name, subtitle: p.subtitle, category: p.category, location: p.location });
  const ride = await Ride.create({
    rider: rider._id, driver: driver._id, status: "completed", pickup: place(a), destination: place(b), rideType: "keke",
    distanceKm: t.km, durationMin: Math.round(t.km * 3 + 2), baseFare: 0, ratePerKm: 500, minimumFare: 500, fare, commissionPercent: 15, commission, driverEarning: fare - commission,
    paymentMethod: t.method, paymentStatus: "paid", completedAt: done, riderRating: { stars: 5 },
  });
  await Ride.collection.updateOne({ _id: ride._id }, { $set: { createdAt: new Date(done.getTime() - 20 * 60_000), updatedAt: done } });
  const to = b.name;
  if (t.method === "wallet" || t.method === "card") await ledger("fare", `Trip to ${to} (${t.method})`, fare, ride._id, done);
  if (t.method === "wallet") {
    walletSpent += fare;
    const w = await WalletTransaction.create({ user: rider._id, kind: "ride", label: `Trip to ${to}`, amount: -fare, ride: ride._id, reference: `demo-ride-${ride._id}` });
    await WalletTransaction.collection.updateOne({ _id: w._id }, { $set: { createdAt: done } });
  }
  await ledger("commission", `Commission (15%) on trip to ${to}`, -commission, ride._id, done);
}
// A starting credit that leaves ₦20,000 in the wallet after the wallet trip.
const credit = await WalletTransaction.create({ user: rider._id, kind: "topup", label: "Demo credit", amount: RIDER.wallet + walletSpent, method: "Demo", reference: `demo-credit-${rider._id}-${now}` });
await WalletTransaction.collection.updateOne({ _id: credit._id }, { $set: { createdAt: new Date(now - 3 * day) } });
await User.updateOne({ _id: rider._id }, { $set: { walletBalance: RIDER.wallet } });
await Driver.updateOne({ _id: driver._id }, { $set: { balance } });

console.log(`
Demo accounts ready.
  Rider   ${RIDER.phone}  ${RIDER.name}  wallet ₦${RIDER.wallet.toLocaleString("en-NG")}
  Driver  ${DRIVER.phone}  ${DRIVER.name}  approved keke · balance ₦${balance.toLocaleString("en-NG")}
Sign-in code: the one set in DEMO_LOGINS (for example 123456).
${config.demoLogins.length ? "" : "\n!! DEMO_LOGINS is not set yet, so the code won't work: add it to .env and redeploy (DEPLOY-VPS.md, Demo accounts).\n"}${config.paymentProvider === "demo" ? "" : `!! PAYMENT_PROVIDER is ${config.paymentProvider}: card payments and payouts need that gateway. For the demo set PAYMENT_PROVIDER=demo.\n`}`);
await mongoose.disconnect();
process.exit(0);
