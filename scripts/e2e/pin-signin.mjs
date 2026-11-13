// Run with a throwaway database:  npm i --no-save mongodb-memory-server@10 && node scripts/e2e/pin-signin.mjs
// Sign-in with a PIN: first time by code, then PIN on any phone, lockouts, Forgot PIN.
import { MongoMemoryServer } from "mongodb-memory-server";
import assert from "node:assert/strict";

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("caliphate");
process.env.SMS_PROVIDER = "app";
process.env.JWT_SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e";
process.env.DEMO_LOGINS = "08000000001:123456";
process.env.NODE_ENV = "test";
const B = new URL("../../src", import.meta.url).pathname;
const mongoose = (await import("mongoose")).default;
await mongoose.connect(process.env.MONGODB_URI);
const { createApp } = await import(`${B}/app.js`);
const { User, OtpCode } = await import(`${B}/models/index.js`);
await User.init();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const A = { id: "a".repeat(32), name: "Tecno Spark 10 Pro" };
const NEW_PHONE = { id: "b".repeat(32), name: "Infinix Hot 40" };
let ipCounter = 0;
// Each call looks like it comes from its own network, so the per-network limit (tested separately)
// doesn't hide what the PIN rules do.
async function call(method, path, body, { device, token, ip } = {}) {
  const from = ip ?? `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": from, ...(device ? { "x-device-id": device.id, "x-device-name": device.name } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const ok = (name) => console.log("  ✓", name);
const NUM = "08031112222", E164 = "+2348031112222";
const allowNextCode = () => OtpCode.collection.updateMany({ phone: E164 }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
const endPause = () => User.collection.updateOne({ phone: E164 }, { $set: { pinPausedUntil: new Date(Date.now() - 1000) } });

// 1. First time: code, then the app must ask for a PIN
let r = await call("POST", "/auth/otp/request", { phone: NUM }, { device: A });
assert.equal(r.body.delivery, "app"); assert.match(r.body.code, /^\d{6}$/);
r = await call("POST", "/auth/otp/verify", { phone: NUM, code: r.body.code }, { device: A });
assert.equal(r.status, 200); assert.equal(r.body.isNewUser, true); assert.equal(r.body.user.needsPin, true); assert.equal(r.body.user.hasPin, false);
let token = r.body.token; ok("new number: code by notification, then the app asks for a PIN");

// 2. Create the PIN
r = await call("POST", "/me/pin", { pin: "1234" }, { device: A, token });
assert.equal(r.status, 400); assert.match(r.body.message, /easy to guess/); ok("easy PIN (1234) refused");
r = await call("POST", "/me/pin", { pin: "4826" }, { device: A, token });
assert.equal(r.status, 200); assert.equal(r.body.user.hasPin, true); assert.equal(r.body.user.needsPin, false); ok("PIN 4826 saved");
const stored = await User.findOne({ phone: E164 }).lean();
assert.ok(stored.pinHash && !stored.pinHash.includes("4826")); assert.equal(stored.devices[0].name, "Tecno Spark 10 Pro"); ok("PIN stored hashed; phone name remembered");

// 3. Log out + back in, reinstall, or a new phone: asks for the PIN, no code
r = await call("POST", "/auth/otp/request", { phone: NUM }, { device: A });
assert.equal(r.body.delivery, "pin"); assert.equal(r.body.code, undefined); ok("same phone (logged out / reinstalled): asks for the PIN");
r = await call("POST", "/auth/otp/request", { phone: NUM }, { device: NEW_PHONE });
assert.equal(r.body.delivery, "pin"); assert.equal(r.body.phoneName, "Tecno Spark 10 Pro"); ok("new phone: asks for the PIN, says it was set up on a Tecno Spark 10 Pro");
r = await call("POST", "/auth/pin/verify", { phone: NUM, pin: "4826" }, { device: NEW_PHONE });
assert.equal(r.status, 200); assert.equal(r.body.isNewUser, false); assert.ok(r.body.token); ok("right PIN signs in on the new phone");

// 4. Wrong PINs: tries left, then a 30-minute pause
for (const left of [4, 3, 2, 1]) {
  r = await call("POST", "/auth/pin/verify", { phone: NUM, pin: "1111" }, { device: NEW_PHONE });
  assert.equal(r.status, 400); assert.match(r.body.message, new RegExp(`${left} tr(y|ies) left`));
}
ok("wrong PIN: 4, 3, 2, 1 tries left");
r = await call("POST", "/auth/pin/verify", { phone: NUM, pin: "1111" }, { device: NEW_PHONE });
assert.equal(r.status, 429); assert.equal(r.body.code, "pin_paused"); assert.match(r.body.message, /30 minutes/); ok("5th wrong: paused for 30 minutes");
r = await call("POST", "/auth/pin/verify", { phone: NUM, pin: "4826" }, { device: NEW_PHONE });
assert.equal(r.status, 429); assert.equal(r.body.code, "pin_paused"); ok("even the right PIN waits during the pause");
await endPause();
r = await call("POST", "/auth/pin/verify", { phone: NUM, pin: "4826" }, { device: NEW_PHONE });
assert.equal(r.status, 200); assert.equal((await User.findOne({ phone: E164 })).pinFails, 0); ok("after the pause the right PIN works and the count resets");

// 5. 10 wrong in a row: locked until Forgot PIN
for (let i = 0; i < 10; i++) { await call("POST", "/auth/pin/verify", { phone: NUM, pin: "1111" }, { device: NEW_PHONE }); if (i === 4) await endPause(); }
r = await call("POST", "/auth/pin/verify", { phone: NUM, pin: "4826" }, { device: NEW_PHONE });
assert.equal(r.status, 429); assert.equal(r.body.code, "pin_locked"); ok("10 wrong in a row: locked, even for the right PIN");

// 6. Forgot PIN on a NEW phone: support confirms first
r = await call("POST", "/auth/otp/request", { phone: NUM, forgotPin: true }, { device: { id: "c".repeat(32), name: "Samsung A15" } });
assert.equal(r.body.delivery, "support"); assert.equal(r.body.code, undefined); assert.equal(r.body.phoneName, "Tecno Spark 10 Pro"); ok("forgot PIN on a phone never used: call support (no code shown)");

// 7. Forgot PIN on a phone they've used: code by notification, then a new PIN
await allowNextCode();
r = await call("POST", "/auth/otp/request", { phone: NUM, forgotPin: true }, { device: A });
assert.equal(r.body.delivery, "app"); assert.match(r.body.code, /^\d{6}$/);
r = await call("POST", "/auth/otp/verify", { phone: NUM, code: r.body.code }, { device: A });
assert.equal(r.status, 200); assert.equal(r.body.user.hasPin, false); assert.equal(r.body.user.needsPin, true);
let u = await User.findOne({ phone: E164 }); assert.equal(u.pinLocked, false); assert.equal(u.pinFails, 0);
token = r.body.token; ok("forgot PIN on their own phone: code, old PIN cleared and unlocked");
r = await call("POST", "/me/pin", { pin: "7391" }, { device: A, token });
assert.equal(r.status, 200); ok("new PIN set");
r = await call("POST", "/auth/pin/verify", { phone: NUM, pin: "7391" }, { device: NEW_PHONE });
assert.equal(r.status, 200); ok("signs in with the new PIN");

// 8. Changing the PIN needs the current one
r = await call("POST", "/me/pin", { pin: "5062", currentPin: "0000" }, { device: A, token });
assert.equal(r.status, 400); assert.match(r.body.message, /current PIN/);
r = await call("POST", "/me/pin", { pin: "5062", currentPin: "7391" }, { device: A, token });
assert.equal(r.status, 200); ok("change PIN: needs the current PIN");

// 9. Many guesses sent at once are all counted
await User.collection.updateOne({ phone: E164 }, { $set: { pinFails: 0 } });
const burst = await Promise.all(Array.from({ length: 30 }, () => call("POST", "/auth/pin/verify", { phone: NUM, pin: "9182" }, { device: NEW_PHONE })));
const wrongChecked = burst.filter((x) => x.body.code === "wrong_pin").length;
assert.ok(wrongChecked <= 10, `at most 10 guesses may be checked, got ${wrongChecked}`);
u = await User.findOne({ phone: E164 });
console.log("    burst replies:", JSON.stringify(burst.reduce((m, x) => ((m[x.body?.code ?? x.status] = (m[x.body?.code ?? x.status] ?? 0) + 1), m), {})));
const checked = burst.filter((x) => x.body.code === "wrong_pin" || x.body.code === "pin_paused" || x.body.code === "pin_locked").length;
assert.equal(burst.filter((x) => x.status === 200).length, 0); assert.ok(u.pinFails >= 10 || u.pinPausedUntil);
console.log(`    (30 guesses at once: ${burst.filter((x) => x.body.code === "wrong_pin").length} checked, the rest refused; fails counted ${u.pinFails})`);
ok("30 guesses at once from 30 networks: at most 10 checked, then locked; none get in");

// 9b. The per-network limit on its own: one network, 40 attempts
const oneNet = await Promise.all(Array.from({ length: 40 }, () => call("POST", "/auth/pin/verify", { phone: "08035550000", pin: "1111" }, { ip: "10.200.0.1" })));
assert.ok(oneNet.filter((x) => x.body.code === "too_many_requests").length >= 10); ok("one network: refused after 30 attempts in 10 minutes");

// 10. Older app (no phone ID) and demo numbers still use codes
await User.collection.updateOne({ phone: E164 }, { $set: { pinFails: 0, pinLocked: false }, $unset: { pinPausedUntil: 1 } });
await allowNextCode();
r = await call("POST", "/auth/otp/request", { phone: NUM });
assert.equal(r.body.delivery, "log"); ok("older app: code in the server log, as before");
r = await call("POST", "/auth/otp/request", { phone: "08000000001" }, { device: A });
assert.equal(r.body.code, "123456");
r = await call("POST", "/auth/otp/verify", { phone: "08000000001", code: "123456" }, { device: A });
assert.equal(r.status, 200); assert.equal(r.body.user.needsPin, false); ok("demo number: fixed code, never asked for a PIN");

// 11. Deleting the account clears the PIN; the number can sign up fresh
r = await call("DELETE", "/me", null, { device: A, token });
assert.equal(r.status, 200);
await OtpCode.deleteMany({});
r = await call("POST", "/auth/otp/request", { phone: NUM }, { device: NEW_PHONE });
assert.equal(r.body.delivery, "app"); ok("deleted account: same number starts again with a code");

server.close(); await mongoose.disconnect(); await mongo.stop();
console.log("\nAll PIN sign-in checks passed.");
