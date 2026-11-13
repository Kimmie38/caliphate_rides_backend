// Run with a throwaway database:  npm i --no-save mongodb-memory-server@10 && node scripts/e2e/flutterwave.mjs
// The whole Flutterwave flow against a stand-in for api.flutterwave.com/v3 that answers like the real one:
// top-up checkout, webhook, re-check, wallet credit, return page back to the app, fakes, and a payout.
import { MongoMemoryServer } from "mongodb-memory-server";
import assert from "node:assert/strict";

const mongo = await MongoMemoryServer.create();
Object.assign(process.env, {
  MONGODB_URI: mongo.getUri("caliphate"), NODE_ENV: "test", SMS_PROVIDER: "app",
  JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e", DEMO_LOGINS: "08000000001:123456,08000000002:123456",
  PAYMENT_PROVIDER: "flutterwave", FLW_SECRET_KEY: "FLWSECK_TEST-0123456789abcdef-X", FLW_WEBHOOK_HASH: "my-webhook-hash-123",
  PUBLIC_URL: "https://api.caliphaterides.com.ng",
});

// ---- Stand-in for Flutterwave
const realFetch = globalThis.fetch;
const fw = { checkouts: [], transfers: [], payments: new Map() }; // tx_ref -> what "Flutterwave" says about it
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  if (!url.startsWith("https://api.flutterwave.com/v3")) return realFetch(input, init);
  assert.equal(init.headers?.Authorization, "Bearer FLWSECK_TEST-0123456789abcdef-X", "sends the secret key");
  const path = url.slice("https://api.flutterwave.com/v3".length);
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (path === "/payments" && init.method === "POST") {
    fw.checkouts.push(body);
    return json(200, { status: "success", message: "Hosted Link", data: { link: `https://checkout.flutterwave.com/v3/hosted/pay/${body.tx_ref.slice(-8)}` } });
  }
  let m = path.match(/^\/transactions\/verify_by_reference\?tx_ref=(.+)$/) ?? path.match(/^\/transactions\/(\d+)\/verify$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    const p = fw.payments.get(key) ?? [...fw.payments.values()].find((x) => String(x.id) === key);
    if (!p) return json(400, { status: "error", message: "No transaction was found for this id" });
    return json(200, { status: "success", data: { id: p.id, tx_ref: p.tx_ref, status: p.status, amount: p.amount, currency: p.currency ?? "NGN", payment_type: "card", created_at: new Date().toISOString() } });
  }
  if (path === "/banks/NG") return json(200, { status: "success", data: [{ code: "058", name: "Guaranty Trust Bank" }, { code: "044", name: "Access Bank" }] });
  if (path === "/accounts/resolve") return json(200, { status: "success", data: { account_number: body.account_number, account_name: "ABUBAKAR SANI MUSA" } });
  if (path === "/transfers" && init.method === "POST") {
    const t = { id: 9000 + fw.transfers.length, status: "NEW", reference: body.reference, amount: body.amount, fee: 10.75, complete_message: "" };
    fw.transfers.push({ ...t, body });
    return json(200, { status: "success", data: t });
  }
  m = path.match(/^\/transfers\/(\d+)$/);
  if (m) { const t = fw.transfers.find((x) => String(x.id) === m[1]); return json(200, { status: "success", data: { ...t, status: t.final ?? "PENDING" } }); }
  return json(404, { status: "error", message: `stand-in has no ${path}` });
};

const B = new URL("../../src", import.meta.url).pathname;
const mongoose = (await import("mongoose")).default;
await mongoose.connect(process.env.MONGODB_URI);
const { createApp } = await import(`${B}/app.js`);
const { User, Payment, Driver, Withdrawal } = await import(`${B}/models/index.js`);
await User.init();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let n = 0;
async function call(method, path, body, { token, headers = {} } = {}) {
  const r = await realFetch(base + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": `10.8.0.${++n % 250}`, "x-device-id": "d".repeat(32), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}
const ok = (s) => console.log("  ✓", s);
const signIn = async (phone) => (await call("POST", "/auth/otp/verify", { phone, code: (await call("POST", "/auth/otp/request", { phone })).body.code ?? "123456" })).body.token;
const webhook = (event, data, hash = "my-webhook-hash-123") => call("POST", "/payments/flutterwave/webhook", JSON.stringify({ event, data }), { headers: { "verif-hash": hash } });
const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

const token = await signIn("08000000001");
await User.updateOne({ phone: "+2348000000001" }, { name: "Aisha Bello" });

// 1. Top-up opens Flutterwave's page with the right details
let r = await call("POST", "/wallet/topup", { amount: 5000 }, { token });
assert.equal(r.status, 200); assert.match(r.body.checkoutUrl, /^https:\/\/checkout\.flutterwave\.com\//);
const c = fw.checkouts.at(-1);
assert.equal(c.amount, 5000); assert.equal(c.currency, "NGN"); assert.equal(c.redirect_url, "https://api.caliphaterides.com.ng/payments/flutterwave/return");
assert.ok(c.customer.email.includes("@")); assert.equal(c.customer.name, "Aisha Bello");
const ref = c.tx_ref; ok(`top-up ₦5,000: Flutterwave page made (${c.customer.email} for the receipt)`);

// 2. A fake webhook (wrong secret hash) is refused
r = await webhook("charge.completed", { id: 111, tx_ref: ref, status: "successful", amount: 5000 }, "wrong-hash");
assert.equal(r.status, 401); ok("webhook with the wrong secret hash: refused");

// 3. Real webhook: re-checked with Flutterwave before crediting
fw.payments.set(ref, { id: 111, tx_ref: ref, status: "successful", amount: 5000 });
r = await webhook("charge.completed", { id: 111, tx_ref: ref, status: "successful", amount: 5000 });
assert.equal(r.status, 200);
assert.ok(await until(async () => (await Payment.findOne({ reference: ref })).status === "success"));
r = await call("GET", "/wallet", undefined, { token });
assert.equal(r.body.balance, 5000); ok("webhook: Flutterwave confirms, wallet credited ₦5,000");

// 4. The same webhook again doesn't credit twice
await webhook("charge.completed", { id: 111, tx_ref: ref, status: "successful", amount: 5000 });
await new Promise((res) => setTimeout(res, 300));
assert.equal((await call("GET", "/wallet", undefined, { token })).body.balance, 5000); ok("same webhook twice: credited once");

// 5. Return page sends the person back into the app
r = await call("GET", `/payments/flutterwave/return?status=successful&tx_ref=${ref}&transaction_id=111`);
assert.match(r.body, /Payment received/); assert.match(r.body, /caliphaterides:\/\/payment\?status=success/); ok("return page: 'Payment received', then back to the app");

// 6. A webhook that lies about the amount: Flutterwave's own answer wins
r = await call("POST", "/wallet/topup", { amount: 20000 }, { token });
const ref2 = fw.checkouts.at(-1).tx_ref;
fw.payments.set(ref2, { id: 222, tx_ref: ref2, status: "successful", amount: 200 }); // only ₦200 really paid
await webhook("charge.completed", { id: 222, tx_ref: ref2, status: "successful", amount: 20000 });
await new Promise((res) => setTimeout(res, 400));
assert.notEqual((await Payment.findOne({ reference: ref2 })).status, "success");
assert.equal((await call("GET", "/wallet", undefined, { token })).body.balance, 5000); ok("paid ₦200 for a ₦20,000 top-up: not credited");

// 7. Cancelled and failed payments: nothing credited, the app is told
r = await call("GET", `/payments/flutterwave/return?status=cancelled&tx_ref=${ref2}`);
assert.match(r.body, /Payment cancelled/); assert.match(r.body, /status=cancelled/);
r = await call("POST", "/wallet/topup", { amount: 3000 }, { token });
const ref3 = fw.checkouts.at(-1).tx_ref;
fw.payments.set(ref3, { id: 333, tx_ref: ref3, status: "failed", amount: 3000 });
r = await call("GET", `/payments/flutterwave/return?status=failed&tx_ref=${ref3}&transaction_id=333`);
assert.match(r.body, /not completed/); assert.match(r.body, /status=failed/);
assert.equal((await Payment.findOne({ reference: ref3 })).status, "failed"); ok("cancelled / failed card: nothing credited, app told");

// 8. Driver withdrawal goes out as a Flutterwave payout (test-mode reference) and completes
const dToken = await signIn("08000000002");
const dUser = await User.findOneAndUpdate({ phone: "+2348000000002" }, { name: "Abubakar Sani Musa" }, { returnDocument: "after" });
await Driver.create({ user: dUser._id, status: "approved", balance: 7000, personal: { fullName: "Abubakar Sani Musa" },
  bank: { bankName: "GTBank", bankCode: "058", accountNumber: "0123456789", accountName: "Abubakar Sani Musa", verifiedName: "ABUBAKAR SANI MUSA", verifiedAt: new Date(), codeFrom: "monnify" } }); // checked with the other provider: Flutterwave re-checks it
r = await call("POST", "/driver/withdrawals", { amount: 5000 }, { token: dToken });
if (r.status !== 201) console.log("    withdrawal reply:", r.status, JSON.stringify(r.body));
assert.equal(r.status, 201); // created
const tr = fw.transfers.at(-1);
assert.equal(tr.body.amount, 5000); assert.equal(tr.body.account_bank, "058"); assert.equal(tr.body.account_number, "0123456789");
assert.match(tr.body.reference, /_PMCKDU_1$/);
const checked = await Driver.findOne({ user: dUser._id }).lean();
assert.equal(checked.bank.codeFrom, "flutterwave"); assert.equal(checked.bank.nameMatches, true);
ok("bank account re-checked with Flutterwave: 'ABUBAKAR SANI MUSA' matches the driver");
ok("withdrawal ₦5,000: Flutterwave payout to GTBank ••6789 (test-mode reference)");
tr.final = "SUCCESSFUL";
await webhook("transfer.completed", { id: tr.id, reference: tr.reference, status: "SUCCESSFUL" });
assert.ok(await until(async () => (await Withdrawal.findOne({}).sort({ createdAt: -1 }))?.status === "successful"));
ok("payout webhook: withdrawal marked paid");

server.close(); await mongoose.disconnect(); await mongo.stop();
console.log("\nAll Flutterwave checks passed.");
