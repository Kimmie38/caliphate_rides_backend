// The Express app: middleware, routes and error handling. server.js adds the database and live updates.
import { fileURLToPath } from "node:url";
import express from "express";
import { HttpError } from "./lib/errors.js";
import { log } from "./lib/log.js";
import { cors, securityHeaders } from "./middleware/http.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { driversRouter } from "./routes/drivers.js";
import { driverTripsRouter } from "./routes/driverTrips.js";
import { filesRouter } from "./routes/files.js";
import { meRouter } from "./routes/me.js";
import { paymentsRouter } from "./routes/payments.js";
import { publicRouter } from "./routes/public.js";
import { ridesRouter } from "./routes/rides.js";
import { walletRouter } from "./routes/wallet.js";

const UPLOAD_ERRORS = {
  LIMIT_FILE_SIZE: "Each photo must be 8 MB or smaller.",
  LIMIT_FILE_COUNT: "Send at most 2 photos.",
  LIMIT_UNEXPECTED_FILE: "Send the photos in the \"files\" field.",
  LIMIT_FIELD_COUNT: "Too many fields in the upload.",
};

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Render / Caddy / Nginx: use the real client IP for rate limits

  app.use(securityHeaders);
  app.use(cors);

  // Payment webhooks read the raw body, so this goes before express.json().
  app.use("/payments", paymentsRouter);

  app.use(express.json({ limit: "200kb" }));

  // The admin dashboard: plain HTML/JS files, no build step. Open /dashboard in a browser.
  const dashboard = fileURLToPath(new URL("../public/dashboard", import.meta.url));
  app.use("/dashboard", express.static(dashboard, { index: "index.html", maxAge: "10m" }));

  app.get("/", (_req, res) => res.json({ name: "Caliphate Rides API", ok: true, dashboard: "/dashboard" }));
  app.use("/", publicRouter);
  app.use("/auth", authRouter);
  app.use("/me", meRouter);
  app.use("/rides", ridesRouter);
  app.use("/wallet", walletRouter);
  app.use("/drivers", driversRouter);
  app.use("/driver", driverTripsRouter);
  app.use("/admin", adminRouter);
  app.use("/files", filesRouter);

  app.use((req, res) => res.status(404).json({ code: "not_found", message: "Not found." }));

  // Every error becomes { code, message } with a message the app can show as written.
  app.use((err, req, res, _next) => {
    let status = 500;
    let code = "server_error";
    let message = "Something went wrong on our side. Please try again.";
    if (err instanceof HttpError) {
      ({ status, message } = err);
      code = err.code ?? "error";
    } else if (err?.name === "MulterError") {
      status = 400;
      code = "bad_upload";
      message = UPLOAD_ERRORS[err.code] ?? "That upload didn't work. Try again.";
    } else if (err?.type === "entity.parse.failed") {
      status = 400;
      code = "bad_json";
      message = "The request wasn't valid JSON.";
    } else if (err?.type === "entity.too.large") {
      status = 413;
      code = "too_large";
      message = "The request is too large.";
    } else if (err?.name === "CastError") {
      status = 404;
      code = "not_found";
      message = "Not found.";
    } else if (err?.name === "ValidationError") {
      status = 400;
      code = "invalid";
      message = Object.values(err.errors ?? {})[0]?.message ?? "Some details aren't valid.";
    } else {
      log.error("unhandled error", { method: req.method, path: req.path, err: err?.message, stack: err?.stack });
    }
    if (res.headersSent) return;
    res.status(status).json({ code, message });
  });

  return app;
}
