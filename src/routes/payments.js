// The payment providers tell us about payments in two ways:
//   POST /payments/monnify/webhook       (server to server, signed with "monnify-signature")
//   GET  /payments/monnify/return        (the person's browser comes back here after paying)
//   POST /payments/flutterwave/webhook  (server to server, with the secret hash in "verif-hash")
//   GET  /payments/flutterwave/return
//   GET  /payments/demo/checkout?ref=     (PAYMENT_PROVIDER=demo only: a pretend payment page, no real money)
//   POST /payments/demo/pay  { ref, action: "pay" | "cancel" }
// Everything is re-checked with the provider before applying anything.
import { Router, raw, urlencoded } from "express";
import { config } from "../config.js";
import { markDemoPaid } from "../lib/demoPay.js";
import { activeProvider } from "../lib/paymentProvider.js";
import { Payment } from "../models/index.js";
import { log } from "../lib/log.js";
import { validWebhookHash } from "../lib/flutterwave.js";
import { validWebhookSignature } from "../lib/monnify.js";
import { onTransferWebhook } from "../services/driverMoney.js";
import { settlePayment } from "../services/payments.js";

export const paymentsRouter = Router();

paymentsRouter.post("/flutterwave/webhook", raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  if (!validWebhookHash(req.headers["verif-hash"])) return res.status(401).end();
  res.sendStatus(200); // answer straight away; the work continues below
  try {
    const body = JSON.parse((Buffer.isBuffer(req.body) ? req.body : Buffer.from("")).toString("utf8"));
    const event = body?.event ?? body?.["event.type"];
    const data = body?.data ?? {};
    if (event === "charge.completed" && data.tx_ref) await settlePayment(data.tx_ref, data.id != null ? String(data.id) : undefined);
    else if (event === "transfer.completed" && data.reference) await onTransferWebhook(data.reference);
  } catch (err) {
    log.error("flutterwave webhook failed", { err: err.message });
  }
});

paymentsRouter.post("/monnify/webhook", raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!validWebhookSignature(body, req.headers["monnify-signature"])) {
    log.error("monnify webhook with a bad signature");
    return res.status(401).end();
  }
  res.sendStatus(200); // answer straight away; the work continues below
  try {
    const { eventType, eventData = {} } = JSON.parse(body.toString("utf8"));
    if (eventType === "SUCCESSFUL_TRANSACTION" && eventData.paymentReference) await settlePayment(eventData.paymentReference);
    else if (/_DISBURSEMENT$/.test(eventType ?? "") && eventData.reference) await onTransferWebhook(eventData.reference);
  } catch (err) {
    log.error("monnify webhook failed", { err: err.message });
  }
});

// back: the app link that closes the payment sheet and returns to the app. Opened in the app, the
// sheet closes by itself as soon as the page loads; in a normal browser, the button opens the app.
const page = (title, message, back) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#F3F6F4;color:#0C1D15;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.card{background:#fff;border-radius:22px;padding:32px 24px;max-width:360px;box-shadow:0 8px 30px rgba(12,29,21,.08)}h1{color:#00874F;font-size:22px;margin:0 0 8px}p{color:#5E7167;line-height:1.5;margin:0}
a.back{display:block;margin-top:22px;background:#00874F;color:#fff;text-decoration:none;border-radius:16px;padding:15px;font-weight:700}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>${back ? `<a class="back" href="${back}">Back to Caliphate Rides</a>` : ""}</div>
${back ? `<script>setTimeout(function(){location.href=${JSON.stringify(back)}},400)</script>` : ""}</body></html>`;

/** The app link for a finished payment. The app only uses it to close the sheet: it re-checks with the server. */
const backToApp = (status) => `${config.appScheme}://payment?status=${encodeURIComponent(status)}`;

function resultPage(res, status) {
  const back = backToApp(status);
  res.type("html").send(
    status === "success" ? page("Payment received", "Thank you. You can go back to the Caliphate Rides app now.", back)
    : status === "pending" ? page("Payment processing", "If you finished paying, it's being confirmed: go back to the app, it updates as soon as it's through. If you didn't, go back to the app to try again.", back)
    : status === "cancelled" ? page("Payment cancelled", "Nothing was charged. Go back to the app to try again or choose another way to pay.", back)
    : page("Payment not completed", "We couldn't confirm this payment. Go back to the app and try again, or choose another way to pay.", backToApp("failed")),
  );
}

paymentsRouter.get("/monnify/return", async (req, res) => {
  const pick = (v) => (typeof v === "string" ? v : "");
  const reference = pick(req.query.ref) || pick(req.query.paymentReference);
  let status = "unknown";
  try { if (reference) status = await settlePayment(reference); } catch (err) { log.error("monnify return failed", { err: err.message }); }
  resultPage(res, status);
});

paymentsRouter.get("/flutterwave/return", async (req, res) => {
  const reference = typeof req.query.tx_ref === "string" ? req.query.tx_ref : "";
  const transactionId = typeof req.query.transaction_id === "string" ? req.query.transaction_id : undefined;
  let status = req.query.status === "cancelled" ? "cancelled" : "unknown";
  try { if (reference && status !== "cancelled") status = await settlePayment(reference, transactionId); } catch (err) { log.error("flutterwave return failed", { err: err.message }); }
  resultPage(res, status);
});

// ---- Demo payments (PAYMENT_PROVIDER=demo): a pretend checkout so the app can be shown without a gateway.
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const WHAT = { topup: "Wallet top-up", ride: "Trip payment", driver_payment: "Commission payment" };

paymentsRouter.get("/demo/checkout", async (req, res) => {
  const ref = typeof req.query.ref === "string" ? req.query.ref : "";
  const payment = activeProvider() === "demo" && ref ? await Payment.findOne({ reference: ref, provider: "demo" }).lean() : null;
  if (!payment) return res.status(404).type("html").send(page("Payment not found", "Go back to the Caliphate Rides app and try again."));
  if (payment.status === "success") return resultPage(res, "success");
  const amount = `₦${Math.round(payment.amount).toLocaleString("en-NG")}`;
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ${amount}</title><style>body{font-family:system-ui,sans-serif;background:#F3F6F4;color:#0C1D15;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
.card{background:#fff;border-radius:24px;padding:28px 24px;width:100%;max-width:380px;box-shadow:0 8px 30px rgba(12,29,21,.08)}
.tag{display:inline-block;background:#FDF3DC;color:#8A5A00;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600}
h1{font-size:40px;margin:18px 0 4px}p{color:#5E7167;margin:0 0 6px;line-height:1.5}.row{display:flex;justify-content:space-between;border-top:1px solid #E3EAE6;padding:12px 0;font-size:15px}
button{width:100%;border:0;border-radius:16px;padding:16px;font-size:17px;font-weight:700;margin-top:10px;cursor:pointer}
.pay{background:#00874F;color:#fff}.cancel{background:#EEF3F0;color:#0C1D15}</style></head>
<body><form class="card" method="post" action="/payments/demo/pay"><span class="tag">Demo payment · no real money</span>
<h1>${amount}</h1><p>${esc(WHAT[payment.kind] ?? "Payment")} for Caliphate Rides</p>
<div class="row"><span>Reference</span><b>${esc(ref.slice(-10))}</b></div>
<input type="hidden" name="ref" value="${esc(ref)}">
<button class="pay" name="action" value="pay">Pay ${amount}</button>
<button class="cancel" name="action" value="cancel">Cancel</button></form></body></html>`);
});

paymentsRouter.post("/demo/pay", urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
  const ref = typeof req.body?.ref === "string" ? req.body.ref : "";
  if (activeProvider() !== "demo" || !ref) return resultPage(res, "unknown");
  if (req.body.action !== "pay") return resultPage(res, "cancelled");
  const payment = await Payment.findOne({ reference: ref, provider: "demo" });
  if (!payment) return resultPage(res, "unknown");
  markDemoPaid(ref);
  let status = "unknown";
  try { status = await settlePayment(ref); } catch (err) { log.error("demo payment failed", { err: err.message }); }
  resultPage(res, status);
});
