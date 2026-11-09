// Starts everything: settings check, MongoDB, the HTTP API, live updates and ride matching.
import { createServer } from "node:http";
import mongoose from "mongoose";
import { checkConfig, config } from "./config.js";
import { log } from "./lib/log.js";
import { createApp } from "./app.js";
import { activeProvider, paymentsReady, paymentsTestMode, payoutsReady, providerLabel } from "./lib/paymentProvider.js";
import { keepRoutingAwake } from "./lib/routing.js";
import { initRealtime } from "./services/realtime.js";
import { ensureDefaults } from "./services/bootstrap.js";
import { recoverMatching } from "./services/matching.js";
import { reconcileWithdrawals } from "./services/driverMoney.js";
import "./services/presence.js"; // registers the live-connection handlers

async function main() {
  checkConfig();
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  log.info("connected to MongoDB", { db: mongoose.connection.name });
  await ensureDefaults();
  if (config.sms.provider === "console") log.info("SMS codes are written to this log (SMS_PROVIDER=console), not sent to phones.");
  if (activeProvider() === "demo") log.info("PAYMENT_PROVIDER=demo: card payments, top-ups and payouts are pretend (no real money). Switch to monnify before real riders use the app.");
  if (config.demoLogins.length) log.info(`DEMO_LOGINS: ${config.demoLogins.length} demo number(s) sign in with a fixed code. Remove DEMO_LOGINS after the demo.`);
  const pay = providerLabel();
  if (!paymentsReady()) log.info(`${pay} not connected (its keys are empty): card payments, top-ups and payouts are off.`);
  else {
    const notes = [paymentsTestMode() ? "TEST mode: no real money" : "LIVE"];
    if (!payoutsReady()) notes.push("payouts off until MONNIFY_WALLET_ACCOUNT is set");
    if (activeProvider() === "flutterwave" && !config.flutterwave.webhookHash) notes.push("FLW_WEBHOOK_HASH is missing so payments are only confirmed when people return to the app");
    log.info(`Payments: ${pay} connected (${notes.join("; ")}).`);
  }

  const server = createServer(createApp());
  const io = initRealtime(server);
  await recoverMatching();
  if (config.keepRoutingAwake) keepRoutingAwake(); // our own routing server on a free plan
  // Payouts the bank hasn't confirmed yet get checked with the provider every 5 minutes.
  setInterval(() => reconcileWithdrawals().catch((err) => log.error("payout check failed", { err: err.message })), 5 * 60_000).unref();

  await new Promise((ok) => server.listen(config.port, ok));
  log.info("Caliphate Rides API running", { port: config.port, url: config.publicUrl, env: config.env });

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    io.close();
    server.close();
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

process.on("unhandledRejection", (err) => log.error("unhandled rejection", { err: err?.message, stack: err?.stack }));

/** Plain-language hints for the usual first-deploy mistakes. */
function startHint(err) {
  const m = `${err?.name ?? ""} ${err?.message ?? ""}`;
  if (/bad auth|authentication failed/i.test(m)) return "MongoDB rejected the username or password in MONGODB_URI. Check them in Atlas → Database Access (special characters in the password must be URL-encoded, e.g. @ as %40).";
  if (/ENOTFOUND|querySrv|ESERVFAIL/i.test(m)) return "The MongoDB address in MONGODB_URI couldn't be found. Copy the connection string again from Atlas → Connect → Drivers.";
  if (/ServerSelection|timed out|ETIMEDOUT/i.test(m)) return "Couldn't reach MongoDB. In Atlas → Network Access, add 0.0.0.0/0 (allow access from anywhere).";
  return undefined;
}

main().catch((err) => {
  log.error("failed to start", { err: err.message, hint: startHint(err) });
  process.exit(1);
});
