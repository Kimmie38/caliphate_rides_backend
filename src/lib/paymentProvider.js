// One door to whichever payment provider is switched on (PAYMENT_PROVIDER = monnify, flutterwave or demo).
// New payments and payouts use the active provider; ones already started are checked with the
// provider that started them (stored on the Payment / Withdrawal), so switching is safe at any time.
//
// Shared shapes:
//   verifyTransaction → { id, reference, status: "successful" | "failed" | "pending", amount, currency, channel, paidAt }
//   transfers         → { id, status: "SUCCESSFUL" | "FAILED" | "PENDING" | "NEEDS_OTP", fee, message }
import { config } from "../config.js";
import * as flw from "./flutterwave.js";
import * as mnf from "./monnify.js";
import * as demo from "./demoPay.js";

const flutterwaveStatus = (s) => (s === "SUCCESSFUL" || s === "FAILED" ? s : "PENDING"); // NEW / PENDING → PENDING

const PROVIDERS = {
  flutterwave: {
    label: "Flutterwave",
    ready: flw.flutterwaveReady,
    payoutsReady: flw.flutterwaveReady,
    testMode: flw.flutterwaveTestMode,
    createCheckout: flw.createCheckout,
    verifyTransaction: flw.verifyTransaction,
    bankCodeFor: flw.bankCodeFor,
    resolveAccount: flw.resolveAccount,
    transferReference: flw.transferReference,
    createTransfer: async (a) => { const t = await flw.createTransfer(a); return { ...t, status: flutterwaveStatus(t.status) }; },
    getTransfer: async ({ id }) => { const t = await flw.getTransfer(id); return { ...t, status: flutterwaveStatus(t.status) }; },
    /** Flutterwave payouts are looked up by the id it gave us. */
    canCheckTransfer: (w) => !!w.providerId,
  },
  monnify: {
    label: "Monnify",
    ready: mnf.monnifyReady,
    payoutsReady: mnf.monnifyPayoutsReady,
    testMode: mnf.monnifyTestMode,
    createCheckout: mnf.createCheckout,
    verifyTransaction: mnf.verifyTransaction,
    bankCodeFor: mnf.bankCodeFor,
    resolveAccount: mnf.resolveAccount,
    transferReference: (base) => base,
    createTransfer: mnf.createTransfer,
    getTransfer: mnf.getTransfer,
    canCheckTransfer: () => true, // by our reference
  },
  demo: {
    label: "Demo (no real money)",
    ready: demo.demoReady,
    payoutsReady: demo.demoReady,
    testMode: demo.demoTestMode,
    createCheckout: demo.createCheckout,
    verifyTransaction: demo.verifyTransaction,
    bankCodeFor: demo.bankCodeFor,
    resolveAccount: demo.resolveAccount,
    transferReference: (base) => base,
    createTransfer: demo.createTransfer,
    getTransfer: demo.getTransfer,
    canCheckTransfer: () => true,
  },
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/** The provider new payments and payouts go through. */
export const activeProvider = () => config.paymentProvider;
const p = (name) => PROVIDERS[name || activeProvider()] ?? PROVIDERS[activeProvider()];

export const providerLabel = (name) => p(name).label;
export const paymentsReady = (name) => p(name).ready();
export const payoutsReady = (name) => p(name).payoutsReady();
export const paymentsTestMode = (name) => p(name).testMode();

/** Starts a checkout with the active provider. Returns { checkoutUrl, provider }. */
export async function createCheckout(args) {
  const out = await p().createCheckout(args);
  return { ...out, provider: activeProvider() };
}
export const verifyTransaction = (provider, args) => p(provider).verifyTransaction(args);

export const bankCodeFor = (bankName) => p().bankCodeFor(bankName);
/** The account name the bank has. `expectedName` is only used by the demo provider, which echoes it back. */
export const resolveAccount = (accountNumber, bankCode, expectedName) => p().resolveAccount(accountNumber, bankCode, expectedName);

export const transferReference = (base) => p().transferReference(base);
export const createTransfer = (args) => p().createTransfer(args);
export const getTransfer = (provider, ref) => p(provider).getTransfer(ref);
export const canCheckTransfer = (w) => p(w.provider || "flutterwave").canCheckTransfer(w);

/** Providers need an email; riders sign in by phone, so use a stable placeholder when they have none. */
export const paymentEmail = flw.paymentEmail;
