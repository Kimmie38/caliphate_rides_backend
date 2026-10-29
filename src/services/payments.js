// Applying Flutterwave payments: top-ups credit the rider's wallet, ride payments mark the ride paid,
// and driver payments clear what the driver owes. Safe to run more than once for the same reference
// (webhook retries, the return page, the app checking).
import { log } from "../lib/log.js";
import { verifyTransaction } from "../lib/flutterwave.js";
import { Payment } from "../models/index.js";
import { postLedger } from "./driverMoney.js";
import { creditWallet, markRidePaid } from "./rides.js";

const CHANNELS = { card: "Card", bank_transfer: "Bank transfer", ussd: "USSD", account: "Bank account", opay: "OPay" };

/** Checks the payment with Flutterwave and applies it. Returns "success", "pending", "failed" or "unknown". */
export async function settlePayment(reference, transactionId) {
  const payment = await Payment.findOne({ reference });
  if (!payment) return "unknown";
  if (payment.status === "success") return "success";

  const result = await verifyTransaction({ id: transactionId, reference }); // never trust the webhook or return link alone
  if (result.reference && result.reference !== reference) {
    log.error("flutterwave reference mismatch", { reference, got: result.reference });
    return "failed";
  }
  if (result.status !== "successful") {
    if (result.status === "failed") await Payment.updateOne({ _id: payment._id, status: "pending" }, { status: "failed", providerId: result.id });
    return result.status === "failed" ? "failed" : "pending";
  }
  if (result.currency !== "NGN" || Math.round(result.amount) < payment.amount) {
    log.error("flutterwave amount mismatch", { reference, expected: payment.amount, got: result.amount, currency: result.currency });
    return "failed";
  }

  // Only one caller wins the switch to success, so money is applied once.
  const won = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: "success" } },
    { status: "success", paidAt: result.paidAt ? new Date(result.paidAt) : new Date(), channel: result.channel, providerId: result.id },
    { returnDocument: "after" },
  );
  if (!won) return "success";

  if (payment.kind === "topup") {
    await creditWallet(payment.user, payment.amount, { label: "Top up", reference: `topup-${reference}`, method: CHANNELS[result.channel] ?? "Flutterwave" });
  } else if (payment.kind === "ride" && payment.ride) {
    await markRidePaid(payment.ride, "flutterwave");
  } else if (payment.kind === "driver_payment" && payment.driver) {
    await postLedger(payment.driver, payment.amount, { kind: "payment", label: "You paid Caliphate Rides", reference: `payment-${reference}` });
  }
  log.info("payment applied", { reference, kind: payment.kind, amount: payment.amount });
  return "success";
}
