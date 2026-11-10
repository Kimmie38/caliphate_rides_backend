// Flutterwave (API v3): checkout for card payments, wallet top-ups and drivers paying what they owe;
// bank account checks and payouts to drivers. Amounts are in naira.
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { findBankCode } from "./banks.js";
import { HttpError, PaymentProviderError } from "./errors.js";
import { log } from "./log.js";

const BASE = "https://api.flutterwave.com/v3";
const TIMEOUT_MS = 20_000;

export const flutterwaveReady = () => !!config.flutterwave.secretKey;

/** Test keys (FLWSECK_TEST-…): nothing is really charged or paid out. */
export const flutterwaveTestMode = () => /_TEST/i.test(config.flutterwave.secretKey);

/**
 * In test mode Flutterwave leaves transfers "pending" forever unless the reference ends in a mock
 * suffix. _PMCKDU_1 = "mock success after 1 minute", so test withdrawals complete like real ones.
 */
export const transferReference = (base) => (flutterwaveTestMode() ? `${base}_PMCKDU_1` : base);

/** Errors are PaymentProviderError (see errors.js); the old name still works. */
export { PaymentProviderError as FlutterwaveError };

async function call(path, { method = "GET", body } = {}) {
  if (!flutterwaveReady()) throw new HttpError(503, "Online payments aren't set up yet. Pay with cash or transfer for now.", "payments_unavailable");
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.flutterwave.secretKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    log.error("flutterwave unreachable", { path, err: err.message });
    throw new PaymentProviderError("The payment service didn't respond. Try again in a moment.", { reached: false });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== "success") {
    const providerMessage = json?.message ?? `HTTP ${res.status}`;
    log.error("flutterwave refused", { path, status: res.status, message: providerMessage });
    throw new PaymentProviderError("The payment service couldn't do that. Try again in a moment.", { reached: true, providerMessage });
  }
  return json.data;
}

// ---------- taking payments (Flutterwave Standard: a hosted checkout page) ----------

/** Starts a checkout and returns the page to open. The rider comes back to /payments/flutterwave/return. */
export async function createCheckout({ reference, amountNaira, customer, title, description, meta }) {
  const data = await call("/payments", {
    method: "POST",
    body: {
      tx_ref: reference,
      amount: amountNaira,
      currency: "NGN",
      redirect_url: `${config.publicUrl}/payments/flutterwave/return`,
      customer: { email: customer.email, name: customer.name || undefined, phonenumber: customer.phone || undefined },
      customizations: { title: title ?? "Caliphate Rides", description, ...(config.flutterwave.logoUrl ? { logo: config.flutterwave.logoUrl } : {}) },
      configurations: { session_duration: 30 },
      meta,
    },
  });
  return { checkoutUrl: data.link };
}

/** Asks Flutterwave how a payment went. Uses the transaction id when we have it, else our reference. */
export async function verifyTransaction({ id, reference }) {
  const data = id
    ? await call(`/transactions/${encodeURIComponent(id)}/verify`)
    : await call(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
  return {
    id: data.id != null ? String(data.id) : undefined,
    reference: data.tx_ref,
    status: data.status, // "successful" | "failed" | "pending"
    amount: Number(data.amount),
    currency: data.currency,
    channel: data.payment_type,
    paidAt: data.created_at,
  };
}

/** Webhooks carry the secret hash you set in the Flutterwave dashboard in the "verif-hash" header. */
export function validWebhookHash(header) {
  const secret = config.flutterwave.webhookHash;
  if (!secret || typeof header !== "string") return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Flutterwave needs an email; riders sign in by phone, so use a stable placeholder when they have none. */
export const paymentEmail = (user) => user.email || user.signInEmail || `${(user.phone ?? "").replace(/\D/g, "") || user._id}@${config.flutterwave.emailDomain}`;

// ---------- bank accounts ----------

let bankList = null;
let bankListAt = 0;

export async function listBanks() {
  if (bankList && Date.now() - bankListAt < 24 * 3600_000) return bankList;
  const data = await call("/banks/NG");
  bankList = (data ?? []).map((b) => ({ code: String(b.code), name: b.name }));
  bankListAt = Date.now();
  return bankList;
}

/** The bank code for a bank name from the app's list, or null if it can't be found. */
export async function bankCodeFor(bankName) {
  return findBankCode(bankName, await listBanks().catch(() => []));
}

/** The name the bank has on an account. */
export async function resolveAccount(accountNumber, bankCode) {
  const data = await call("/accounts/resolve", { method: "POST", body: { account_number: accountNumber, account_bank: bankCode } });
  return data.account_name;
}

// ---------- payouts ----------

/** Sends money to a bank account. Returns Flutterwave's transfer id and status. */
export async function createTransfer({ bankCode, accountNumber, amount, reference, narration }) {
  const data = await call("/transfers", {
    method: "POST",
    body: { account_bank: bankCode, account_number: accountNumber, amount, currency: "NGN", debit_currency: "NGN", reference, narration },
  });
  return { id: String(data.id), status: data.status, fee: Number(data.fee) || undefined, message: data.complete_message };
}

/** Where a payout has got to: "NEW", "PENDING", "SUCCESSFUL" or "FAILED". */
export async function getTransfer(id) {
  const data = await call(`/transfers/${encodeURIComponent(id)}`);
  return { id: String(data.id), status: data.status, reference: data.reference, fee: Number(data.fee) || undefined, message: data.complete_message };
}
