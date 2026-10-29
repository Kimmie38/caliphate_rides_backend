// A driver's balance: what they've earned through the app, minus Caliphate Rides' commission, minus
// what they've withdrawn.
//
// How the commission is collected:
//   - Every finished trip takes the commission off the driver's balance, whatever the payment method.
//   - Card and wallet trips are paid to Caliphate Rides, so the full fare is added to the driver's balance
//     when the payment is confirmed. Net: the driver gets fare − commission, which they can withdraw.
//   - Cash and transfer trips are paid straight to the driver, so only the commission comes off, and the
//     balance can go below zero (the driver owes). It's cleared by later card/wallet trips, or the driver
//     pays it through Flutterwave. Past the admin's limit (default ₦5,000) they can't go online until then.
import { randomBytes } from "node:crypto";
import { badRequest, conflict, HttpError } from "../lib/errors.js";
import { FlutterwaveError, bankCodeFor, createTransfer, flutterwaveReady, getTransfer, resolveAccount } from "../lib/flutterwave.js";
import { log } from "../lib/log.js";
import { namesMatch } from "../lib/names.js";
import { Driver, DriverLedger, Withdrawal } from "../models/index.js";
import { getPricing } from "./pricing.js";
import { emitTo, userRoom } from "./realtime.js";

const naira = (n) => `₦${Math.round(Math.abs(n)).toLocaleString("en-NG")}`;

/** Tells the driver's phones their new balance. */
async function announceBalance(driver) {
  const pricing = await getPricing();
  emitTo(userRoom(driver.user), "driver:balance", { balance: driver.balance, owedLimit: pricing.owedLimit, blocked: driver.balance < -pricing.owedLimit });
}

/**
 * Adds an entry to the driver's ledger and moves their balance, once per reference.
 * With requireBalance, a debit only happens if the balance covers it. Returns { ok, balance }.
 */
export async function postLedger(driverId, amount, { kind, label, reference, ride, withdrawal, by }, { requireBalance = false } = {}) {
  let entry;
  try {
    entry = await DriverLedger.create({ driver: driverId, kind, label, amount, reference, ride, withdrawal, by });
  } catch (err) {
    if (err?.code === 11000) return { ok: true, duplicate: true };
    throw err;
  }
  const filter = requireBalance && amount < 0 ? { _id: driverId, balance: { $gte: -amount } } : { _id: driverId };
  const driver = await Driver.findOneAndUpdate(filter, { $inc: { balance: amount } }, { returnDocument: "after", projection: { balance: 1, user: 1 } });
  if (!driver) {
    await DriverLedger.deleteOne({ _id: entry._id });
    return { ok: false };
  }
  await DriverLedger.updateOne({ _id: entry._id }, { balanceAfter: driver.balance });
  announceBalance(driver).catch(() => {});
  return { ok: true, balance: driver.balance };
}

/** Recalculates a balance from the ledger (admin tool, in case the two ever disagree). */
export async function recomputeBalance(driverId) {
  const [sum] = await DriverLedger.aggregate([{ $match: { driver: driverId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  const balance = sum?.total ?? 0;
  await Driver.updateOne({ _id: driverId }, { balance });
  return balance;
}

// ---------- trips ----------

/** Caliphate Rides' share of a finished trip. Called once, when the driver completes it. */
export async function chargeCommission(ride) {
  if (!ride.driver || !(ride.commission > 0)) return;
  await postLedger(ride.driver, -ride.commission, {
    kind: "commission",
    label: `Commission (${ride.commissionPercent}%) on trip to ${ride.destination.name}`,
    reference: `commission-${ride._id}`,
    ride: ride._id,
  });
}

/** A card or wallet trip was paid to Caliphate Rides: the full fare goes to the driver. */
export async function creditInAppFare(ride) {
  if (!ride.driver || !["card", "wallet"].includes(ride.paymentMethod)) return;
  await postLedger(ride.driver, ride.fare, {
    kind: "fare",
    label: `${ride.paymentMethod === "card" ? "Card" : "Wallet"} payment for trip to ${ride.destination.name}`,
    reference: `fare-${ride._id}`,
    ride: ride._id,
  });
}

/** Whether a driver owes too much to take trips. */
export async function owesTooMuch(driver) {
  const pricing = await getPricing();
  return (driver.balance ?? 0) < -pricing.owedLimit ? { owed: -driver.balance, limit: pricing.owedLimit } : null;
}

export const owedMessage = (owed) => `You owe ${naira(owed)} in commission. Pay it from the Earnings tab to go online again.`;

// ---------- bank account check ----------

/** Asks the bank (through Flutterwave) whose account this is, and whether it matches the driver. */
export async function verifyDriverBank(driver) {
  const bank = driver.bank ?? {};
  const reset = { "bank.verifiedName": undefined, "bank.verifiedAt": undefined, "bank.nameMatches": undefined, "bank.approvedBy": undefined, "bank.bankCode": undefined };
  if (!bank.bankName || !/^\d{10}$/.test(bank.accountNumber ?? "")) {
    await Driver.updateOne({ _id: driver._id }, { $set: { "bank.verifyError": "Add your bank account first." }, $unset: reset });
    return Driver.findById(driver._id);
  }
  if (!flutterwaveReady()) {
    await Driver.updateOne({ _id: driver._id }, { $set: { "bank.verifyError": "Bank checks aren't set up yet." } });
    return Driver.findById(driver._id);
  }
  try {
    const code = await bankCodeFor(bank.bankName);
    if (!code) throw new Error("no code");
    const name = await resolveAccount(bank.accountNumber, code);
    const matches = namesMatch(name, driver.personal?.fullName || bank.accountName);
    await Driver.updateOne(
      { _id: driver._id },
      { $set: { "bank.bankCode": code, "bank.verifiedName": name, "bank.verifiedAt": new Date(), "bank.nameMatches": matches }, $unset: { "bank.verifyError": 1, "bank.approvedBy": 1 } },
    );
  } catch (err) {
    const message = err instanceof FlutterwaveError && err.reached
      ? "The bank couldn't find this account. Check the account number and bank."
      : err.message === "no code" ? "We couldn't find this bank. Contact driver support." : "We couldn't check the account right now. Try again later.";
    await Driver.updateOne({ _id: driver._id }, { $set: { "bank.verifyError": message }, $unset: reset });
  }
  return Driver.findById(driver._id);
}

/** Why payouts to this driver's account aren't possible yet, or null when they are. */
export function payoutBlocker(driver) {
  const b = driver.bank ?? {};
  if (!b.verifiedAt || !b.bankCode) return b.verifyError || "Your bank account hasn't been checked yet.";
  if (!b.nameMatches && !b.approvedBy) return `The bank says this account belongs to ${b.verifiedName}. Driver support needs to confirm it's yours before you can withdraw.`;
  return null;
}

// ---------- withdrawals ----------

export async function requestWithdrawal(driver, amount) {
  if (!flutterwaveReady()) throw new HttpError(503, "Withdrawals aren't set up yet. Contact driver support.", "payouts_unavailable");
  const pricing = await getPricing();
  if (!Number.isInteger(amount) || amount < pricing.minWithdrawal) throw badRequest(`You can withdraw ${naira(pricing.minWithdrawal)} or more.`, "below_minimum");
  if (amount > 1_000_000) throw badRequest("You can withdraw up to ₦1,000,000 at a time.", "above_maximum");
  const blocker = payoutBlocker(driver);
  if (blocker) throw conflict(blocker, "bank_not_verified");
  if (await Withdrawal.exists({ driver: driver._id, status: { $in: ["processing", "needs_check"] } })) {
    throw conflict("You already have a withdrawal on its way. Wait for it to arrive first.", "withdrawal_in_progress");
  }

  const reference = `CR-WD-${driver._id}-${randomBytes(4).toString("hex")}`;
  const w = await Withdrawal.create({
    driver: driver._id, amount, reference,
    bank: { bankName: driver.bank.bankName, bankCode: driver.bank.bankCode, accountNumber: driver.bank.accountNumber, accountName: driver.bank.verifiedName },
  });
  const debit = await postLedger(driver._id, -amount, {
    kind: "withdrawal", label: `Withdrawal to ${driver.bank.bankName} ••${driver.bank.accountNumber.slice(-4)}`, reference: `withdrawal-${w._id}`, withdrawal: w._id,
  }, { requireBalance: true });
  if (!debit.ok) {
    await Withdrawal.deleteOne({ _id: w._id });
    const fresh = await Driver.findById(driver._id, { balance: 1 });
    throw badRequest(`Your balance is ${naira(Math.max(0, fresh?.balance ?? 0))}.`, "insufficient_balance");
  }

  try {
    const t = await createTransfer({ bankCode: w.bank.bankCode, accountNumber: w.bank.accountNumber, amount, reference, narration: "Caliphate Rides earnings" });
    await Withdrawal.updateOne({ _id: w._id }, { providerId: t.id, fee: t.fee });
    if (t.status === "FAILED") await failWithdrawal(w._id, t.message || "The bank refused the transfer.");
    else if (t.status === "SUCCESSFUL") await completeWithdrawal(w._id);
  } catch (err) {
    if (err instanceof FlutterwaveError && err.reached) {
      await failWithdrawal(w._id, err.providerMessage || "Flutterwave refused the transfer.");
    } else {
      // We don't know if Flutterwave got it. Don't return the money or retry automatically: an admin checks.
      await Withdrawal.updateOne({ _id: w._id }, { status: "needs_check", failureReason: "No answer from Flutterwave" });
      log.error("withdrawal needs checking", { withdrawal: w._id.toString(), err: err.message });
    }
  }
  return Withdrawal.findById(w._id);
}

/** Marks a payout as arrived (once). */
export async function completeWithdrawal(withdrawalId, by) {
  const w = await Withdrawal.findOneAndUpdate(
    { _id: withdrawalId, status: { $in: ["processing", "needs_check"] } },
    { $set: { status: "successful", completedAt: new Date(), ...(by ? { resolvedBy: by } : {}) }, $unset: { failureReason: 1 } },
    { returnDocument: "after" },
  );
  if (w) await notifyWithdrawal(w);
  return w;
}

/** Marks a payout as failed (once) and gives the money back to the driver. */
export async function failWithdrawal(withdrawalId, reason, by) {
  const w = await Withdrawal.findOneAndUpdate(
    { _id: withdrawalId, status: { $in: ["processing", "needs_check"] } },
    { status: "failed", failureReason: reason, completedAt: new Date(), ...(by ? { resolvedBy: by } : {}) },
    { returnDocument: "after" },
  );
  if (!w) return null;
  await postLedger(w.driver, w.amount, {
    kind: "withdrawal_returned", label: "Withdrawal didn't go through: money returned", reference: `withdrawal-returned-${w._id}`, withdrawal: w._id,
  });
  await notifyWithdrawal(w);
  return w;
}

async function notifyWithdrawal(w) {
  const d = await Driver.findById(w.driver, { user: 1 });
  if (d) emitTo(userRoom(d.user), "driver:withdrawal", withdrawalDTO(w));
}

/** Checks a payout with Flutterwave and applies the result. */
export async function checkWithdrawal(w) {
  if (!w.providerId || !["processing", "needs_check"].includes(w.status)) return w;
  const t = await getTransfer(w.providerId);
  await Withdrawal.updateOne({ _id: w._id }, { checkedAt: new Date(), ...(t.fee ? { fee: t.fee } : {}) });
  if (t.status === "SUCCESSFUL") return completeWithdrawal(w._id);
  if (t.status === "FAILED") return failWithdrawal(w._id, t.message || "The bank refused the transfer.");
  return w;
}

/** Flutterwave webhook for a payout. */
export async function onTransferWebhook(reference) {
  const w = await Withdrawal.findOne({ reference });
  if (w) await checkWithdrawal(w); // re-checked with Flutterwave, never trusted from the webhook alone
}

/** Runs every few minutes: payouts that have been on their way for a while get checked. */
export async function reconcileWithdrawals() {
  if (!flutterwaveReady()) return;
  const stale = await Withdrawal.find({ status: "processing", providerId: { $exists: true }, updatedAt: { $lt: new Date(Date.now() - 10 * 60_000) } }).limit(50);
  for (const w of stale) {
    try { await checkWithdrawal(w); } catch (err) { log.error("withdrawal check failed", { withdrawal: w._id.toString(), err: err.message }); }
  }
}

export function withdrawalDTO(w) {
  return {
    id: w._id.toString(),
    amount: w.amount,
    status: w.status === "needs_check" ? "processing" : w.status, // the driver just sees "on its way"
    bankName: w.bank?.bankName ?? "",
    accountEnding: (w.bank?.accountNumber ?? "").slice(-4),
    ...(w.status === "failed" && w.failureReason ? { failureReason: w.failureReason } : {}),
    createdAt: w.createdAt?.toISOString(),
    ...(w.completedAt ? { completedAt: w.completedAt.toISOString() } : {}),
  };
}

export function ledgerDTO(e) {
  return { id: e._id.toString(), kind: e.kind, label: e.label, amount: e.amount, ...(e.balanceAfter !== undefined ? { balanceAfter: e.balanceAfter } : {}), at: e.createdAt?.toISOString() };
}
