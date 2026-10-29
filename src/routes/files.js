// Driver document photos, only through the signed links the API hands out (see lib/files.js).
//   GET /files/:name?exp=&sig=
import { Router } from "express";
import { forbidden, notFound } from "../lib/errors.js";
import { safeFileName, validFileSignature } from "../lib/files.js";
import { sendStored } from "../lib/storage.js";

export const filesRouter = Router();

filesRouter.get("/:name", async (req, res, next) => {
  const { name } = req.params;
  if (!safeFileName(name)) throw notFound("File not found.");
  if (!validFileSignature(name, req.query.exp, req.query.sig)) throw forbidden("This link has expired. Reload the page to get a new one.", "link_expired");
  res.setHeader("Cache-Control", "private, max-age=600");
  await sendStored(name, res, next, () => notFound("File not found."));
});
