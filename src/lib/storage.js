// Where driver document photos are kept.
//   STORAGE=mongo (default): inside MongoDB (GridFS, "documents" bucket). Works on hosts whose disk is
//                            wiped on restart, like Render's free plan. Atlas M0 gives 512 MB in total.
//   STORAGE=disk:            in UPLOAD_DIR on the server's own disk. Use on a VPS with a lasting disk.
// Uploads always land in UPLOAD_DIR first (multer); with mongo they're moved into the database.
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import mongoose from "mongoose";
import { config } from "../config.js";

const useMongo = () => config.storage === "mongo";
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "documents" });

/** Moves freshly uploaded files to their lasting home. */
export async function storeUploads(files) {
  if (!useMongo()) return;
  for (const f of files) {
    await pipeline(createReadStream(f.path), bucket().openUploadStream(f.filename, { metadata: { contentType: f.mimetype } }));
    await unlink(f.path).catch(() => {});
  }
}

/** Undoes storeUploads (and removes any local copies) when the upload as a whole fails. */
export async function discardUploads(files) {
  await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
  if (!useMongo() || !files.length) return;
  const b = bucket();
  const stored = await b.find({ filename: { $in: files.map((f) => f.filename) } }).toArray();
  await Promise.all(stored.map((s) => b.delete(s._id).catch(() => {})));
}

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

/** Sends a stored file. Calls `missing()` when it doesn't exist. */
export async function sendStored(name, res, next, missing) {
  if (!useMongo()) {
    return res.sendFile(name, { root: config.uploadDir, dotfiles: "deny" }, (err) => {
      if (!err) return;
      if (err.code === "ENOENT" || err.status === 404) return next(missing());
      next(err);
    });
  }
  const b = bucket();
  const [file] = await b.find({ filename: name }).limit(1).toArray();
  if (!file) return next(missing());
  res.setHeader("Content-Type", file.metadata?.contentType ?? TYPES[name.split(".").pop()] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(file.length));
  await pipeline(b.openDownloadStream(file._id), res);
}
