import { config } from "../config.js";
import { tooMany } from "../lib/errors.js";

/** Lets the web admin dashboard call the API from the allowed origins. The mobile app doesn't need CORS. */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  const any = config.corsOrigins.includes("*");
  if (origin && (any || config.corsOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", any ? "*" : origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

/** Basic security headers. */
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

/**
 * Simple in-memory rate limit: at most `max` requests per `windowMs` for each key.
 * (One server instance. With several instances, move this to Redis.)
 */
export function rateLimit({ windowMs, max, key = (req) => req.ip, message = "Too many requests. Wait a moment and try again." }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, _res, next) => {
    const k = key(req);
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, { count: 1, reset: now + windowMs });
    else if (++h.count > max) throw tooMany(message);
    next();
  };
}
