// Monnify (by Moniepoint): checkout for card / bank transfer / USSD payments (wallet top-ups, ride
// payments, drivers paying what they owe), bank account checks, and payouts to drivers from the
// Monnify wallet. Amounts are in naira.
//
// Docs: https://developers.monnify.com  (sandbox https://sandbox.monnify.com, live https://api.monnify.com)
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { HttpError, PaymentProviderError } from "./errors.js";
import { findBankCode } from "./banks.js";
import { log } from "./log.js";

const TIMEOUT_MS = 25_000;
const UA = "CaliphateRides/1.0 (+https://caliphaterides.com.ng)";

const m = () => config.monnify;
/** Sandbox keys start MK_TEST_; live keys MK_PROD_. */
export const monnifyTestMode = () => /^MK_TEST/i.test(m().apiKey);
const baseUrl = () => m().baseUrl || (monnifyTestMode() ? "https://sandbox.monnify.com" : "https://api.monnify.com");

export const monnifyReady = () => !!(m().apiKey && m().secretKey && m().contractCode);
/** Payouts also need the Monnify wallet's account number (Dashboard → Disbursements / Wallet). */
export const monnifyPayoutsReady = () => monnifyReady() && !!m().walletAccount;

// ---------- calling the API ----------

let token = null;
let tokenUntil = 0;

async function request(path, { method = "GET", body, auth } = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    log.error("monnify unreachable", { path, err: err.message });
    throw new PaymentProviderError("The payment service didn't respond. Try again in a moment.", { reached: false });
  }
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function accessToken(force = false) {
  if (!force && token && Date.now() < tokenUntil) return token;
  const basic = Buffer.from(`${m().apiKey}:${m().secretKey}`).toString("base64");
  const { res, json } = await request("/api/v1/auth/login", { method: "POST", auth: `Basic ${basic}` });
  if (!res.ok || !json?.requestSuccessful || !json.responseBody?.accessToken) {
    log.error("monnify login refused", { status: res.status, message: json?.responseMessage });
    throw new PaymentProviderError("The payment service couldn't sign in. Check the Monnify keys.", { reached: true, providerMessage: json?.responseMessage ?? `HTTP ${res.status}` });
  }
  token = json.responseBody.accessToken;
  const seconds = Number(json.responseBody.expiresIn) || 3000;
  tokenUntil = Date.now() + Math.max(60, seconds - 120) * 1000;
  return token;
}

/**
 * Calls Monnify and returns responseBody. Errors:
 *   reached: true   Monnify answered and refused (safe to treat as "didn't happen")
 *   reached: false  no answer, or a server error on Monnify's side (it may or may not have happened)
 */
async function call(path, { method = "GET", body } = {}) {
  if (!monnifyReady()) throw new HttpError(503, "Online payments aren't set up yet. Pay with cash or transfer for now.", "payments_unavailable");
  let { res, json } = await request(path, { method, body, auth: `Bearer ${await accessToken()}` });
  if (res.status === 401) ({ res, json } = await request(path, { method, body, auth: `Bearer ${await accessToken(true)}` }));
  if (res.status >= 500 && !json?.responseCode) {
    log.error("monnify server error", { path, status: res.status });
    throw new PaymentProviderError("The payment service had a problem. Try again in a moment.", { reached: false });
  }
  if (!res.ok || !json?.requestSuccessful) {
    const providerMessage = json?.responseMessage ?? `HTTP ${res.status}`;
    log.error("monnify refused", { path, status: res.status, code: json?.responseCode, message: providerMessage });
    throw new PaymentProviderError("The payment service couldn't do that. Try again in a moment.", { reached: true, providerMessage, providerCode: json?.responseCode });
  }
  return json.responseBody;
}

// ---------- taking payments (hosted checkout page) ----------

/** Starts a checkout and returns the page to open. The person comes back to /payments/monnify/return. */
export async function createCheckout({ reference, amountNaira, customer, description }) {
  const data = await call("/api/v1/merchant/transactions/init-transaction", {
    method: "POST",
    body: {
      amount: amountNaira,
      currencyCode: "NGN",
      paymentReference: reference,
      paymentDescription: description || "Caliphate Rides",
      customerName: customer.name || "Caliphate Rides customer",
      customerEmail: customer.email,
      contractCode: m().contractCode,
      redirectUrl: `${config.publicUrl}/payments/monnify/return?ref=${encodeURIComponent(reference)}`,
      paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD"],
    },
  });
  // Monnify references contain "|", which phones won't open in a link unless it's encoded.
  return { checkoutUrl: String(data.checkoutUrl).replace(/\|/g, "%7C"), providerId: data.transactionReference };
}

const PAID = new Set(["PAID", "OVERPAID"]);
const FAILED = new Set(["FAILED", "EXPIRED", "CANCELLED", "REVERSED"]);
const CHANNEL = { CARD: "card", ACCOUNT_TRANSFER: "bank_transfer", USSD: "ussd", DIRECT_DEBIT: "account" };

/** Asks Monnify how a payment went, by our reference. */
export async function verifyTransaction({ reference }) {
  const data = await call(`/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`);
  const s = String(data.paymentStatus ?? "").toUpperCase();
  return {
    id: data.transactionReference,
    reference: data.paymentReference,
    status: PAID.has(s) ? "successful" : FAILED.has(s) ? "failed" : "pending",
    amount: Number(data.amountPaid ?? 0),
    currency: data.currencyCode ?? "NGN",
    channel: CHANNEL[String(data.paymentMethod ?? "").toUpperCase()] ?? String(data.paymentMethod ?? "").toLowerCase(),
    paidAt: data.paidOn,
  };
}

/**
 * Webhooks carry "monnify-signature": an HMAC-SHA512 of the raw body with the secret key (hex).
 * Monnify's docs also describe it as SHA-512(secret + body), so either is accepted. The sandbox may
 * send no signature at all; that's allowed in test mode only. Every webhook is re-checked with
 * Monnify before anything is applied, so a forged one can't credit anybody.
 */
export function validWebhookSignature(rawBody, header) {
  const secret = m().secretKey;
  if (!secret) return false;
  if (!header) return monnifyTestMode();
  const got = Buffer.from(String(header).trim().toLowerCase());
  const candidates = [
    createHmac("sha512", secret).update(rawBody).digest("hex"),
    createHash("sha512").update(Buffer.concat([Buffer.from(secret), rawBody])).digest("hex"),
  ];
  return candidates.some((c) => { const b = Buffer.from(c); return b.length === got.length && timingSafeEqual(b, got); });
}

// ---------- bank accounts ----------

let bankList = null;
let bankListAt = 0;

export async function listBanks() {
  if (bankList && Date.now() - bankListAt < 24 * 3600_000) return bankList;
  const data = await call("/api/v1/banks");
  bankList = (data ?? []).map((b) => ({ code: String(b.code), name: b.name }));
  bankListAt = Date.now();
  return bankList;
}

export async function bankCodeFor(bankName) {
  return findBankCode(bankName, await listBanks().catch(() => []));
}

/** The name the bank has on an account. */
export async function resolveAccount(accountNumber, bankCode) {
  const data = await call(`/api/v1/disbursements/account/validate?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`);
  return data.accountName;
}

// ---------- payouts (from the Monnify wallet) ----------

const transferStatus = (s) => {
  s = String(s ?? "").toUpperCase();
  if (s === "SUCCESS" || s === "COMPLETED") return "SUCCESSFUL";
  if (s === "FAILED" || s === "REVERSED" || s === "EXPIRED") return "FAILED";
  if (s === "PENDING_AUTHORIZATION" || s === "OTP_EMAIL_DISPATCH_FAILED") return "NEEDS_OTP";
  return "PENDING";
};

/** Sends money to a bank account. Monnify needs the account name the bank gave us. */
export async function createTransfer({ bankCode, accountNumber, accountName, amount, reference, narration }) {
  if (!m().walletAccount) throw new HttpError(503, "Withdrawals aren't set up yet. Contact driver support.", "payouts_unavailable");
  const data = await call("/api/v2/disbursements/single", {
    method: "POST",
    body: {
      amount, reference, narration, currency: "NGN",
      destinationBankCode: bankCode, destinationAccountNumber: accountNumber, destinationAccountName: accountName,
      sourceAccountNumber: m().walletAccount,
    },
  });
  return { id: data.sessionId || undefined, status: transferStatus(data.status), fee: Number(data.totalFee) || undefined };
}

/** Where a payout has got to, by our reference. */
export async function getTransfer({ reference }) {
  const data = await call(`/api/v2/disbursements/single/summary?reference=${encodeURIComponent(reference)}`);
  return { id: data.sessionId || undefined, status: transferStatus(data.status), reference: data.reference, fee: Number(data.totalFee ?? data.fee) || undefined };
}

/** For tests: forget the cached token and bank list. */
export function resetMonnifyCache() { token = null; tokenUntil = 0; bankList = null; bankListAt = 0; }
