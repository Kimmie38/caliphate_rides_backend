// Flutterwave tells us about payments in two ways:
//   POST /payments/flutterwave/webhook  (server to server, with the secret hash in "verif-hash")
//   GET  /payments/flutterwave/return   (the person's browser comes back here after paying)
// Both re-check with Flutterwave before applying anything.
import { Router, raw } from "express";
import { log } from "../lib/log.js";
import { validWebhookHash } from "../lib/flutterwave.js";
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

const page = (title, message) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#F3F6F4;color:#0C1D15;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.card{background:#fff;border-radius:22px;padding:32px 24px;max-width:360px;box-shadow:0 8px 30px rgba(12,29,21,.08)}h1{color:#00874F;font-size:22px;margin:0 0 8px}p{color:#5E7167;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;

paymentsRouter.get("/flutterwave/return", async (req, res) => {
  const reference = typeof req.query.tx_ref === "string" ? req.query.tx_ref : "";
  const transactionId = typeof req.query.transaction_id === "string" ? req.query.transaction_id : undefined;
  let status = req.query.status === "cancelled" ? "cancelled" : "unknown";
  try { if (reference && status !== "cancelled") status = await settlePayment(reference, transactionId); } catch (err) { log.error("flutterwave return failed", { err: err.message }); }
  res.type("html").send(
    status === "success" ? page("Payment received", "Thank you. You can go back to the Caliphate Rides app now.")
    : status === "pending" ? page("Payment processing", "Your payment is still being confirmed. Go back to the app; it updates as soon as it's through.")
    : status === "cancelled" ? page("Payment cancelled", "Nothing was charged. Go back to the app to try again or choose another way to pay.")
    : page("Payment not completed", "We couldn't confirm this payment. Go back to the app and try again, or choose another way to pay."),
  );
});
