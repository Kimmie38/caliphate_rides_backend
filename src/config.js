// All settings come from environment variables (see .env.example).
// Local .env files are loaded automatically when present; shell variables keep precedence.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (typeof process.loadEnvFile === "function") {
  for (const name of [".env", ".env.local"]) {
    const envFile = resolve(process.cwd(), name);
    if (existsSync(envFile)) process.loadEnvFile(envFile);
  }
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
  /** Pickups must be inside this box (west,south,east,north). Empty = anywhere. */
  serviceArea: parseBox(str("SERVICE_AREA", "5.10,12.85,5.35,13.15")),

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
    if (isProd) problems.push("JWT_SECRET must be set to a long random string.");
    else config.jwtSecret = "dev-only-secret-do-not-use-in-production";
  }
  if (isProd && config.jwtSecret.length < 32) problems.push("JWT_SECRET should be at least 32 characters.");
  if (isProd && config.sms.provider === "console" && !config.sms.allowConsoleInProduction) {
    problems.push("SMS_PROVIDER is 'console': riders would never receive their sign-in codes. Set up Termii, or set ALLOW_CONSOLE_SMS=true while testing (codes then appear in the server log).");
  }
  if (isProd && config.flutterwave.secretKey && !config.flutterwave.webhookHash) problems.push("FLW_WEBHOOK_HASH must be set so Flutterwave payments can be confirmed.");
  if (isProd && config.corsOrigins.includes("*")) problems.push("CORS_ORIGINS should list your admin dashboard's address, not *.");
  if (!config.mongoUri.startsWith("mongodb")) problems.push("MONGODB_URI must be a MongoDB connection string (mongodb+srv://… from Atlas).");
  if (problems.length) throw new Error(`Settings need attention:\n- ${problems.join("\n- ")}`);
}
