// Run with a throwaway database:  npm i --no-save mongodb-memory-server@10 && node scripts/e2e/signin-delete.mjs
import { MongoMemoryServer } from "mongodb-memory-server";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("caliphate"); process.env.JWT_SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e"; process.env.NODE_ENV = "test";
const B = new URL("../../src", import.meta.url).pathname;
const mongoose = (await import("mongoose")).default;
await mongoose.connect(process.env.MONGODB_URI);
const { User, Driver } = await import(`${B}/models/index.js`);
const { deleteAccount } = await import(`${B}/services/deleteAccount.js`);
const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "documents" });
for (const name of ["licence-1.jpg", "licence-0.jpg", "photo.jpg", "someone-else.jpg"]) await pipeline(Readable.from([Buffer.from("x")]), bucket.openUploadStream(name));
const user = await User.create({ phone: "+2348030000000", name: "Musa" });
await Driver.create({ user: user._id, status: "approved", documents: new Map([
  ["licence", { kind: "licence", current: { files: ["licence-1.jpg"] }, history: [{ files: ["licence-0.jpg"] }] }],
  ["selfie", { kind: "selfie", current: { files: ["photo.jpg"] } }],
]) });
await deleteAccount(user);
const left = (await bucket.find({}).toArray()).map((f) => f.filename);
assert.deepEqual(left, ["someone-else.jpg"]);
console.log("  ✓ the driver's document photos (current and older versions) are erased; other people's stay");
await mongoose.disconnect(); await mongo.stop();
