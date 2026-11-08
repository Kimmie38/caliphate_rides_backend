// A full copy of Caliphate Rides' data in one ZIP file, and putting it back.
//
// The ZIP holds:
//   README.txt              what's inside and how to restore it
//   manifest.json           when it was made, and how many records / photos it holds
//   data/<collection>.jsonl every record, one per line (MongoDB Extended JSON: ids and dates kept exactly)
//   spreadsheets/<collection>.csv  the same records as spreadsheets (open in Excel / Google Sheets)
//   photos/<file>           every driver document photo
//   data/_photos.jsonl      the photos' details (type, upload date)
//
// The JSON files are what you'd move to another server or database; the spreadsheets are for reading.
// Sign-in codes (short-lived) aren't included.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import mongoose from "mongoose";
import { config } from "../config.js";
import { log } from "../lib/log.js";
import { ZipReader, ZipWriter } from "../lib/zip.js";
import * as models from "../models/index.js";

const { EJSON } = mongoose.mongo.BSON;
export const BACKUP_FORMAT = "caliphate-rides-backup";
const SKIP = new Set(["otpcodes"]); // sign-in codes: expire in minutes, not worth keeping
const PHOTO_BUCKET = "documents";

const db = () => mongoose.connection.db;
const bucket = () => new mongoose.mongo.GridFSBucket(db(), { bucketName: PHOTO_BUCKET });

/** The collections a backup covers (everything except sign-in codes and the photo store's internals). */
export async function backupCollections() {
  const all = await db().listCollections({}, { nameOnly: true }).toArray();
  return all.map((c) => c.name).filter((n) => !n.startsWith("system.") && !n.startsWith(`${PHOTO_BUCKET}.`) && !SKIP.has(n)).sort();
}

/** Every stored photo: { name, contentType, uploadDate, length, from: "mongo" | "disk" }. */
async function listPhotos() {
  const photos = new Map();
  const files = await bucket().find({}).toArray().catch(() => []);
  for (const f of files) photos.set(f.filename, { name: f.filename, contentType: f.metadata?.contentType, uploadDate: f.uploadDate, length: f.length, from: "mongo", id: f._id });
  const names = await readdir(config.uploadDir).catch(() => []);
  for (const n of names) {
    if (n.startsWith(".") || photos.has(n)) continue;
    const s = await stat(join(config.uploadDir, n)).catch(() => null);
    if (s?.isFile()) photos.set(n, { name: n, uploadDate: s.mtime, length: s.size, from: "disk" });
  }
  return [...photos.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What a backup would hold right now (for the admin page). */
export async function backupSummary() {
  const names = await backupCollections();
  const collections = {};
  for (const n of names) collections[n] = await db().collection(n).estimatedDocumentCount();
  const photos = await listPhotos();
  return { collections, records: Object.values(collections).reduce((a, b) => a + b, 0), photos: photos.length, photoBytes: photos.reduce((a, p) => a + (p.length || 0), 0) };
}

// ---------- making a backup ----------

/** Batches cursor documents into ~256 KB strings of JSON lines. */
async function* jsonLines(cursor, counter) {
  let buf = "";
  for await (const doc of cursor) {
    buf += EJSON.stringify(doc, { relaxed: true }) + "\n";
    counter.n++;
    if (buf.length > 256_000) { yield buf; buf = ""; }
  }
  if (buf) yield buf;
}

const csvCell = (v) => {
  if (v === undefined || v === null) return "";
  let s;
  if (v instanceof Date) s = v.toISOString();
  else if (v?._bsontype === "ObjectId") s = v.toHexString();
  else if (typeof v === "object") s = EJSON.stringify(v, { relaxed: true });
  else s = String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s;
};

/** The same records as a spreadsheet: one column per top-level field (nested ones as JSON). */
async function* csvLines(coll) {
  const keys = new Set();
  for await (const doc of coll.find({}, { projection: {} })) {
    for (const k of Object.keys(doc)) if (keys.size < 300) keys.add(k);
  }
  const cols = [...keys];
  let buf = "﻿" + cols.map(csvCell).join(",") + "\r\n"; // BOM so Excel reads ₦ and Hausa names correctly
  for await (const doc of coll.find({}).sort({ _id: 1 })) {
    buf += cols.map((k) => csvCell(doc[k])).join(",") + "\r\n";
    if (buf.length > 256_000) { yield buf; buf = ""; }
  }
  if (buf) yield buf;
}

const README = (m) => `CALIPHATE RIDES: FULL BACKUP
Made ${m.createdAt}${m.createdBy ? ` by ${m.createdBy}` : ""}.
${m.records} records in ${Object.keys(m.collections).length} collections${m.includesPhotos ? `, ${m.photos} driver document photos` : " (photos not included)"}.

KEEP THIS FILE PRIVATE. It holds riders' and drivers' phone numbers, ID documents and bank details.

WHAT'S INSIDE
  data/            every record, one per line (MongoDB Extended JSON). This is the copy to move
                   to another server or database: ids and dates are kept exactly.
  spreadsheets/    the same records as .csv files. Open them in Excel or Google Sheets.
  photos/          driver document photos (licences, IDs, vehicle papers, proof of address...).
  manifest.json    counts, to check a restore is complete.

THE MAIN COLLECTIONS
  users            riders (and drivers' rider accounts): phone, name, wallet balance
  drivers          driver applications, documents list, vehicle, owner details, bank, balance
  rides            every trip: pickup, destination, fare, commission, payment
  wallettransactions  rider wallet history
  driverledgers    driver balance history (earnings, commission, withdrawals)
  payments         online payments (top-ups, card rides, drivers paying commission)
  withdrawals      driver payouts to banks
  places           places on the map added by admins
  configs          fares, commission and limits
  admins           admin accounts (passwords are stored scrambled, not readable)

PUTTING IT BACK (same app, any server)
  1. Set up the backend on the new server with an empty database (see DEPLOY-VPS.md).
  2. Copy this file to the server, then run from the backend folder:
       ./scripts/vps-restore.sh /path/to/this-file.zip
     It replaces the database's contents with this backup, photos included.

MOVING TO ANOTHER DATABASE
  MongoDB anywhere (Atlas, another server): load each file with
       mongoimport --uri "mongodb://..." --collection rides --file data/rides.jsonl
  MySQL / Postgres / anything else: load the .csv files as tables (nested fields are JSON text),
  or read the .jsonl files with any programming language: one JSON record per line.
`;

/**
 * Streams a full backup ZIP into `out`. Returns the manifest.
 * photos: false leaves the document photos out (a much smaller file).
 */
export async function writeBackup(out, { photos = true, by } = {}) {
  const zip = new ZipWriter(out);
  const manifest = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), createdBy: by, database: mongoose.connection.name, collections: {}, records: 0, includesPhotos: photos, photos: 0 };

  for (const name of await backupCollections()) {
    const coll = db().collection(name);
    const counter = { n: 0 };
    await zip.add(`data/${name}.jsonl`, jsonLines(coll.find({}).sort({ _id: 1 }), counter));
    manifest.collections[name] = counter.n;
    manifest.records += counter.n;
    await zip.add(`spreadsheets/${name}.csv`, csvLines(coll));
  }

  if (photos) {
    const list = await listPhotos();
    let meta = "";
    for (const p of list) {
      const source = p.from === "mongo" ? bucket().openDownloadStream(p.id) : createReadStream(join(config.uploadDir, p.name));
      try {
        await zip.add(`photos/${p.name}`, source, { compress: false, date: p.uploadDate ? new Date(p.uploadDate) : new Date() });
        meta += JSON.stringify({ name: p.name, contentType: p.contentType, uploadDate: p.uploadDate }) + "\n";
        manifest.photos++;
      } catch (err) {
        log.error("backup: photo skipped", { name: p.name, err: err.message });
      }
    }
    await zip.add("data/_photos.jsonl", meta);
  }

  await zip.add("manifest.json", JSON.stringify(manifest, null, 2));
  await zip.add("README.txt", README(manifest));
  await zip.finish();
  log.info("backup made", { by, records: manifest.records, photos: manifest.photos });
  return manifest;
}

// ---------- restoring a backup ----------

/**
 * Replaces the database's contents with a backup ZIP made by writeBackup. Collections in the backup are
 * emptied and refilled; photos are put back where STORAGE says. Returns what was restored.
 */
export async function restoreBackup(zipPath, { onProgress = () => {} } = {}) {
  const zip = await ZipReader.open(zipPath);
  try {
    const mEntry = zip.find("manifest.json");
    if (!mEntry) throw new Error("This isn't a Caliphate Rides backup (manifest.json is missing).");
    const manifest = JSON.parse((await zip.data(mEntry)).toString("utf8"));
    if (manifest.format !== BACKUP_FORMAT) throw new Error("This isn't a Caliphate Rides backup.");

    const restored = { collections: {}, photos: 0 };
    const dataEntries = zip.entries.filter((e) => /^data\/[^/]+\.jsonl$/.test(e.name) && e.name !== "data/_photos.jsonl");
    for (const e of dataEntries) {
      const name = e.name.slice(5, -6);
      const coll = db().collection(name);
      await coll.drop().catch(() => {}); // "ns not found" when it doesn't exist yet
      await db().createCollection(name).catch(() => {});
      let batch = [];
      let n = 0;
      const lines = createInterface({ input: await zip.stream(e), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        batch.push(EJSON.parse(line, { relaxed: true }));
        if (batch.length >= 1000) { await coll.insertMany(batch, { ordered: false }); n += batch.length; batch = []; }
      }
      if (batch.length) { await coll.insertMany(batch, { ordered: false }); n += batch.length; }
      restored.collections[name] = n;
      onProgress(`${name}: ${n}`);
      if (manifest.collections?.[name] !== undefined && manifest.collections[name] !== n) {
        throw new Error(`${name}: expected ${manifest.collections[name]} records, restored ${n}. The backup file may be damaged.`);
      }
    }

    // Indexes (unique phone numbers, map searches...) as the app defines them.
    for (const m of Object.values(models)) if (m?.createIndexes && m.modelName) await m.createIndexes();

    const photoEntries = zip.entries.filter((e) => e.name.startsWith("photos/") && !e.name.endsWith("/"));
    if (photoEntries.length) {
      const metaEntry = zip.find("data/_photos.jsonl");
      const meta = new Map();
      if (metaEntry) for (const l of (await zip.data(metaEntry)).toString("utf8").split("\n")) if (l.trim()) { const m = JSON.parse(l); meta.set(m.name, m); }
      if (config.storage === "mongo") {
        await db().collection(`${PHOTO_BUCKET}.files`).drop().catch(() => {});
        await db().collection(`${PHOTO_BUCKET}.chunks`).drop().catch(() => {});
      } else {
        await mkdir(config.uploadDir, { recursive: true });
      }
      for (const e of photoEntries) {
        const name = e.name.slice("photos/".length);
        if (name.includes("/") || name.startsWith(".")) continue;
        const input = await zip.stream(e);
        if (config.storage === "mongo") {
          await pipeline(input, bucket().openUploadStream(name, { metadata: { contentType: meta.get(name)?.contentType } }));
        } else {
          const dest = join(config.uploadDir, name);
          await unlink(dest).catch(() => {});
          await pipeline(input, createWriteStream(dest));
        }
        restored.photos++;
        if (restored.photos % 200 === 0) onProgress(`photos: ${restored.photos}`);
      }
      onProgress(`photos: ${restored.photos}`);
    }
    return { manifest, restored };
  } finally {
    await zip.close();
  }
}
