// All settings come from environment variables (see .env.example).
// .env.local and .env files in the project folder are loaded automatically when present
// (.env.local first, so its values win; variables already set in the environment win over both).
import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const name of [".env.local", ".env"]) {
  const envFile = resolve(process.cwd(), name);
  if (existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);
}

const str = (name, fallback = "") => (process.env[name] ?? "").trim() || fallback;
const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] !== undefined ? v : fallback;
};

export const config = {
  env: str("NODE_ENV", "development"),
  port: num("PORT", 4000),
  // On Render, RENDER_EXTERNAL_URL (e.g. https://caliphate-api.onrender.com) is set automatically.
  publicUrl: str("PUBLIC_URL", str("RENDER_EXTERNAL_URL", "http://localhost:4000")).replace(/\/$/, ""),
  // Web pages on other addresses allowed to call the API. The dashboard is served by the API itself and
  // the mobile app doesn't need this, so by default only the API's own address is allowed in production.
  corsOrigins: str("CORS_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),

  mongoUri: str("MONGODB_URI", "mongodb://127.0.0.1:27017/caliphate"),

  jwtSecret: str("JWT_SECRET", ""),
  jwtDays: num("JWT_DAYS", 30),

  sms: {
    provider: str("SMS_PROVIDER", "console"),
    /** Testing a deployed server without an SMS account: codes are written to the server log instead. */
    allowConsoleInProduction: str("ALLOW_CONSOLE_SMS") === "true",
    termiiKey: str("TERMII_API_KEY"),
    termiiBaseUrl: str("TERMII_BASE_URL").replace(/\/$/, ""),
    termiiSender: str("TERMII_SENDER_ID", "Caliphate"),
    termiiChannel: str("TERMII_CHANNEL", "dnd"),
  },
  testLogin: { phone: str("TEST_PHONE"), code: str("TEST_CODE") },

  flutterwave: {
    secretKey: str("FLW_SECRET_KEY"),
    /** The "secret hash" you set under Settings → Webhooks; Flutterwave sends it back with each webhook. */
    webhookHash: str("FLW_WEBHOOK_HASH"),
    emailDomain: str("PAYMENT_FALLBACK_EMAIL_DOMAIN", "riders.caliphaterides.ng"),
    logoUrl: str("FLW_LOGO_URL"),
  },

  routingUrl: str("ROUTING_URL", "https://router.project-osrm.org").replace(/\/$/, ""),
  /** Used when ROUTING_URL can't route a trip (e.g. outside Sokoto while testing). "none" = estimate instead. */
  routingFallbackUrl: /^none$/i.test(str("ROUTING_FALLBACK_URL")) ? "" : str("ROUTING_FALLBACK_URL", "https://router.project-osrm.org").replace(/\/$/, ""),
  /** Ping the routing server every 10 minutes so a free-plan server doesn't fall asleep. Off for the public demo server. */
  keepRoutingAwake: str("KEEP_ROUTING_AWAKE", "true") === "true" && !/router\.project-osrm\.org/.test(str("ROUTING_URL", "https://router.project-osrm.org")),
  /** Pickups must be inside this box (west,south,east,north). "anywhere" = no limit (for testing elsewhere). */
  serviceArea: /^(anywhere|none|off)$/i.test(str("SERVICE_AREA")) ? null : parseBox(str("SERVICE_AREA", "5.10,12.85,5.35,13.15")),

  matching: {
    radiusM: num("MATCH_RADIUS_M", 7000),
    offerSeconds: num("OFFER_SECONDS", 20),
    timeoutSeconds: num("MATCH_TIMEOUT_SECONDS", 90),
  },

  uploadDir: resolve(process.cwd(), str("UPLOAD_DIR", "./uploads")),
  /** Where document photos are kept: "mongo" (inside the database) or "disk" (UPLOAD_DIR). */
  storage: str("STORAGE", "mongo") === "disk" ? "disk" : "mongo",

  admin: {
    email: str("ADMIN_EMAIL"), password: str("ADMIN_PASSWORD"), name: str("ADMIN_NAME", "Caliphate Admin"),
    /** Map style for the dashboard's place editor (MapLibre style JSON). Use your own map server before launch. */
    mapStyleUrl: str("ADMIN_MAP_STYLE_URL", "https://tiles.openfreemap.org/styles/liberty"),
  },
};

function parseBox(s) {
  if (!s) return null;
  const n = s.split(",").map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? { west: n[0], south: n[1], east: n[2], north: n[3] } : null;
}

export const isProd = config.env === "production";
if (!config.corsOrigins.length) config.corsOrigins = isProd ? [config.publicUrl] : ["*"];

/** Stops the server from starting with settings that would be unsafe in production. */
export function checkConfig() {
  const problems = [];
  if (!config.jwtSecret || config.jwtSecret === "change-me-to-a-long-random-string") {
    if (isProd) problems.push("JWT_SECRET must be set to a long random string (on Render: Environment → JWT_SECRET → Generate).");
    else config.jwtSecret = "dev-only-secret-do-not-use-in-production";
  }
  if (isProd && config.jwtSecret.length < 32) problems.push("JWT_SECRET should be at least 32 characters.");
  if (isProd && config.sms.provider === "console" && !config.sms.allowConsoleInProduction) {
    problems.push("SMS_PROVIDER is 'console': riders would never receive their sign-in codes. Set up Termii, or set ALLOW_CONSOLE_SMS=true while testing (codes then appear in the server log).");
  }
  if (isProd && config.flutterwave.secretKey && !config.flutterwave.webhookHash) problems.push("FLW_WEBHOOK_HASH must be set (the same secret hash as in Flutterwave → Settings → Webhooks) so payments can be confirmed.");
  if (isProd && config.corsOrigins.includes("*")) problems.push("CORS_ORIGINS is *. Delete CORS_ORIGINS (it isn't needed: the dashboard is served by the API itself).");
  if (isProd && /localhost|127\.0\.0\.1/.test(config.publicUrl)) problems.push(`PUBLIC_URL is ${config.publicUrl}. Delete PUBLIC_URL on Render (it then uses your onrender.com address), or set it to your real https address.`);
  if (isProd && /localhost|127\.0\.0\.1/.test(config.mongoUri)) problems.push("MONGODB_URI points at this computer (127.0.0.1). Paste your Atlas connection string (mongodb+srv://…).");
  if (!config.mongoUri.startsWith("mongodb")) problems.push("MONGODB_URI must be a MongoDB connection string (mongodb+srv://… from Atlas).");
  if (problems.length) throw new Error(`Settings need attention:\n- ${problems.join("\n- ")}`);
}
