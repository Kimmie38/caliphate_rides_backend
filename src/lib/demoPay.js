// "Demo" payment provider (PAYMENT_PROVIDER=demo): for showing the app before a real gateway is live.
// No money moves. Checkouts open our own pretend payment page, and payouts and bank checks succeed at once.
// Never use it with real riders and drivers: anyone could "pay" by pressing a button.
import { config } from "../config.js";
import { Payment } from "../models/index.js";

/** References "paid" on the demo page since the server started (the Payment itself is updated straight after). */
const paid = new Map();

export const demoReady = () => true;
export const demoTestMode = () => true;

export async function createCheckout({ reference }) {
  return { checkoutUrl: `${config.publicUrl}/payments/demo/checkout?ref=${encodeURIComponent(reference)}`, providerId: `demo-${reference}` };
}

/** Called by the demo page's Pay button. */
export function markDemoPaid(reference) {
  paid.set(reference, new Date());
}

export async function verifyTransaction({ reference }) {
  const payment = await Payment.findOne({ reference }).lean();
  const at = paid.get(reference);
  if (!payment || !at) return { id: `demo-${reference}`, reference, status: "pending" };
  return { id: `demo-${reference}`, reference, status: "successful", amount: payment.amount, currency: "NGN", channel: "card", paidAt: at.toISOString() };
}

export const bankCodeFor = async () => "000";
/** Pretends the bank confirmed the name the driver typed. */
export const resolveAccount = async (_accountNumber, _bankCode, expectedName) => (expectedName || "DEMO ACCOUNT").toUpperCase();

export async function createTransfer({ reference }) {
  return { id: `demo-${reference}`, status: "SUCCESSFUL", fee: 0, message: "Demo payout: no money was sent." };
}
export async function getTransfer({ reference }) {
  return { id: `demo-${reference}`, status: "SUCCESSFUL", reference, fee: 0 };
}
