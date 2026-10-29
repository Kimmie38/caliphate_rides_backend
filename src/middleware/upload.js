import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import multer from "multer";
import { config } from "../config.js";
import { badRequest } from "../lib/errors.js";

mkdirSync(config.uploadDir, { recursive: true });

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** Driver document photos: up to 2 images, 8 MB each, stored under random names. */
export const documentUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${randomBytes(16).toString("hex")}.${EXT[file.mimetype] ?? "jpg"}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 2, fields: 10 },
  fileFilter: (_req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(badRequest("Photos must be JPG, PNG, WebP or HEIC images."))),
}).array("files", 2);
