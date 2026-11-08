// Makes a full backup ZIP (all records + driver document photos). See src/services/backup.js.
//   node scripts/backup-export.js backup.zip              everything
//   node scripts/backup-export.js backup.zip --no-photos  records only (small)
//   node scripts/backup-export.js -                       write the ZIP to stdout (used by vps-full-backup.sh)
import { createWriteStream } from "node:fs";
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { writeBackup } from "../src/services/backup.js";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? `caliphate-backup-${new Date().toISOString().slice(0, 10)}.zip`;
const photos = !args.includes("--no-photos");
const say = (m) => process.stderr.write(m + "\n");

await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
const out = target === "-" ? process.stdout : createWriteStream(target);
const manifest = await writeBackup(out, { photos, by: "command line" });
if (out !== process.stdout) await new Promise((ok, fail) => { out.end(ok); out.on("error", fail); });
say(`Backup made: ${manifest.records} records in ${Object.keys(manifest.collections).length} collections, ${manifest.photos} photos${target === "-" ? "" : ` → ${target}`}`);
await mongoose.disconnect();
