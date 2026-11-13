// Run with a throwaway database:  npm i --no-save mongodb-memory-server@10 && node scripts/e2e/signin-delete.mjs
// End-to-end: phone codes shown in the app (SMS_PROVIDER=app), phones an account has used, and deleting an account.
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
const { User, Driver, Ride } = await import(`${B}/models/index.js`);
const { OtpCode } = await import(`${B}/models/index.js`);
await User.init(); // build indexes
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const PHONE_A = "a".repeat(24), PHONE_B = "b".repeat(24);
async function call(method, path, body, { device, token } = {}) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(device ? { "x-device-id": device } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const ok = (name) => console.log("  ✓", name);
const allowNextCode = async (phone) => OtpCode.collection.updateMany({ phone }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });

// 1. methods
let r = await call("GET", "/auth/methods");
assert.equal(r.body.phoneCode, "app"); ok("server says codes are shown in the app");

// 2. new number on phone A gets the code in the reply
r = await call("POST", "/auth/otp/request", { phone: "08031112222" }, { device: PHONE_A });
assert.equal(r.status, 200); assert.equal(r.body.delivery, "app"); assert.match(r.body.code, /^\d{6}$/); ok("new number: code returned to the app");
const code1 = r.body.code;

// 3. wrong code, then right code
r = await call("POST", "/auth/otp/verify", { phone: "08031112222", code: code1 === "000000" ? "111111" : "000000" }, { device: PHONE_A });
assert.equal(r.status, 400); ok("wrong code refused");
r = await call("POST", "/auth/otp/verify", { phone: "08031112222", code: code1 }, { device: PHONE_A });
assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.isNewUser, true); ok("right code signs in (new account)");
const tokenA = r.body.token;
let u = await User.findOne({ phone: "+2348031112222" });
assert.equal(u.phoneCheckedBy, "app"); ok("account marked: phone checked in the app only");

// 4. signed-in request remembers phone A
r = await call("GET", "/me", null, { device: PHONE_A, token: tokenA });
assert.equal(r.status, 200);
u = await User.findOne({ phone: "+2348031112222" });
assert.deepEqual(u.devices.map((d) => d.id), [PHONE_A]); ok("phone A remembered for this account");

// 5. someone else's phone B asks for that number's code: not shown, goes to support
await allowNextCode("+2348031112222");
r = await call("POST", "/auth/otp/request", { phone: "08031112222" }, { device: PHONE_B });
assert.equal(r.body.delivery, "support"); assert.equal(r.body.code, undefined); ok("other phone: no code shown, told to call support");
// support reads the code to the real owner (from the log) -> stronger check
const otp = await OtpCode.findOne({ phone: "+2348031112222" }).sort({ createdAt: -1 });
assert.equal(otp.via, "support");

// 6. phone A again gets it in the app
await allowNextCode("+2348031112222");
r = await call("POST", "/auth/otp/request", { phone: "08031112222" }, { device: PHONE_A });
assert.equal(r.body.delivery, "app"); ok("own phone: code shown again");

// 7. old app (no phone ID): code goes to the log, not the reply
await allowNextCode("+2348031112222");
r = await call("POST", "/auth/otp/request", { phone: "08031112222" });
console.log("    (reply:", r.status, JSON.stringify(r.body), ")"); assert.equal(r.body.delivery, "log"); assert.equal(r.body.code, undefined); ok("old app: code only in the server log");

// 8. too-quick second request is refused
r = await call("POST", "/auth/otp/request", { phone: "08031112222" }, { device: PHONE_A });
assert.equal(r.status, 429); ok("asking again within 45 s is refused");

// 9. demo number still works with its fixed code
r = await call("POST", "/auth/otp/request", { phone: "08000000001" }, { device: PHONE_B });
assert.equal(r.body.code, "123456");
r = await call("POST", "/auth/otp/verify", { phone: "08000000001", code: "123456" }, { device: PHONE_B });
assert.equal(r.status, 200); ok("demo number signs in with its fixed code");

// 10. delete: blocked while a ride is live
const rider = await User.findOne({ phone: "+2348031112222" });
const ride = await Ride.collection.insertOne({ rider: rider._id, status: "accepted", createdAt: new Date() });
r = await call("DELETE", "/me", null, { device: PHONE_A, token: tokenA });
assert.equal(r.status, 409); assert.equal(r.body.code, "ride_active"); ok("can't delete during a ride");
await Ride.collection.updateOne({ _id: ride.insertedId }, { $set: { status: "completed" } });

// 11. driver with money to withdraw can't delete yet
const driver = await Driver.create({ user: rider._id, status: "approved", balance: 2500, personal: { fullName: "Musa Bello", nin: "12345678901", address: "12 Gidan Igwai" }, bank: { bankName: "GTBank", accountNumber: "0123456789", accountName: "Musa Bello" } });
r = await call("DELETE", "/me", null, { device: PHONE_A, token: tokenA });
assert.equal(r.status, 409); assert.equal(r.body.code, "balance_left"); assert.match(r.body.message, /₦2,500/); ok("driver must withdraw ₦2,500 first");
driver.balance = 0; await driver.save();

// 12. delete works
r = await call("DELETE", "/me", null, { device: PHONE_A, token: tokenA });
assert.equal(r.status, 200); assert.equal(r.body.deleted, true); ok("account deleted");
u = await User.findById(rider._id).lean();
assert.equal(u.phone, undefined); assert.equal(u.name, ""); assert.ok(u.deletedAt); assert.deepEqual(u.devices, []); ok("phone, name and phones removed");
const d = await Driver.findById(driver._id).lean();
assert.equal(d.status, "deleted"); assert.equal(d.personal.nin, ""); assert.equal(d.personal.address, ""); assert.equal(d.bank.accountNumber, "");
assert.equal(d.personal.fullName, "Musa Bello"); ok("driver ID number, address and bank removed; name kept for past trips");
assert.equal(await Ride.countDocuments({ rider: rider._id }), 1); ok("past trips kept");

// 13. old token no longer works
r = await call("GET", "/me", null, { device: PHONE_A, token: tokenA });
assert.equal(r.status, 401); ok("signed out everywhere");

// 14. same number signs up fresh, even on phone B
await OtpCode.deleteMany({});
r = await call("POST", "/auth/otp/request", { phone: "08031112222" }, { device: PHONE_B });
assert.equal(r.body.delivery, "app");
r = await call("POST", "/auth/otp/verify", { phone: "08031112222", code: r.body.code }, { device: PHONE_B });
assert.equal(r.status, 200); assert.equal(r.body.isNewUser, true); ok("same number can sign up again as a new account");

server.close(); await mongoose.disconnect(); await mongo.stop();
console.log("\nAll end-to-end checks passed.");
