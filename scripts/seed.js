// Fills a new database with what the app needs on day one (same as the server does when it starts).
// Safe to run again: it only adds what's missing. Run:  npm run seed
import mongoose from "mongoose";
import { checkConfig, config } from "../src/config.js";
import { ensureDefaults } from "../src/services/bootstrap.js";

checkConfig();
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
console.log(`Connected to ${mongoose.connection.name}`);
await ensureDefaults({ say: (m) => console.log(m) });
await mongoose.disconnect();
console.log("Done.");
