// Puts a backup ZIP back: REPLACES the database's records (and document photos) with the backup's.
//   node scripts/backup-restore.js backup.zip --yes
//   node scripts/backup-restore.js - --yes < backup.zip     (read the ZIP from stdin; used by vps-restore.sh)
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { restoreBackup } from "../src/services/backup.js";

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith("--"));
if (!source || !args.includes("--yes")) {
  console.error("Usage: node scripts/backup-restore.js BACKUP.zip --yes\nThis REPLACES everything in the database with the backup.");
  process.exit(1);
}
let path = source;
if (source === "-") {
  path = join(tmpdir(), `restore-${process.pid}.zip`);
  await pipeline(process.stdin, createWriteStream(path));
}
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
console.log(`Restoring into database "${mongoose.connection.name}"…`);
try {
  const { manifest, restored } = await restoreBackup(path, { onProgress: (m) => console.log("  " + m) });
  console.log(`Done. Backup from ${manifest.createdAt}: ${Object.values(restored.collections).reduce((a, b) => a + b, 0)} records, ${restored.photos} photos restored.`);
} catch (err) {
  console.error(`Restore failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (source === "-") await unlink(path).catch(() => {});
  await mongoose.disconnect();
}
