// All settings come from environment variables (see .env.example).
// A .env file in the project folder is loaded automatically when present.
import { CITIES } from "./data/cities.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);

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
  /**
   * Sign in with WhatsApp (free): the person sends a code from the app to our WhatsApp Business number,
   * and Meta tells us through the webhook. We only receive messages, so nothing is charged.
   * See WHATSAPP-EMAIL.md for setting it up.
   */
  whatsapp: {
    number: str("WHATSAPP_NUMBER").replace(/\D/g, ""), // the business number people message, e.g. 2348012345678
    phoneNumberId: str("WHATSAPP_PHONE_NUMBER_ID"), // from Meta: only messages to this number count
    appSecret: str("WHATSAPP_APP_SECRET"), // checks that webhook calls really come from Meta
    verifyToken: str("WHATSAPP_VERIFY_TOKEN"), // any phrase you choose; typed into Meta's webhook setup too
    accessToken: str("WHATSAPP_ACCESS_TOKEN"), // only needed if WHATSAPP_REPLY=true
    reply: str("WHATSAPP_REPLY") === "true", // send "You're signed in" back (Meta may charge for replies over its free monthly allowance)
    graphVersion: str("WHATSAPP_GRAPH_VERSION", "v23.0"),
  },
  /** Sign in with an emailed code (free on Brevo's or Resend's free plan). */
  email: {
    provider: str("EMAIL_PROVIDER", "console"), // console (codes in the server log), brevo or resend
    brevoKey: str("BREVO_API_KEY"),
    resendKey: str("RESEND_API_KEY"),
    from: str("EMAIL_FROM", "no-reply@caliphaterides.com.ng"),
    fromName: str("EMAIL_FROM_NAME", "Caliphate Rides"),
  },
  /**
   * Fixed sign-in codes for demo accounts, so a presentation doesn't depend on SMS:
   * DEMO_LOGINS=08000000001:123456,08000000002:123456  (phone:code, comma separated). Remove after the demo.
   */
  demoLogins: str("DEMO_LOGINS").split(",").map((pair) => pair.split(":").map((x) => x.trim())).filter(([p, c]) => p && /^\d{6}$/.test(c ?? "")),

  /**
   * Which provider takes new payments and sends payouts: "monnify", "flutterwave", or "demo"
   * (a pretend payment page and instant payouts, so the app can be shown before a gateway is live).
   * Left empty: Monnify when its keys are set, otherwise Flutterwave.
   */
  paymentProvider: (() => {
    const v = str("PAYMENT_PROVIDER").toLowerCase();
    if (v === "monnify" || v === "flutterwave" || v === "demo") return v; // demo: no real money, for presentations
    return str("MONNIFY_API_KEY") ? "monnify" : "flutterwave";
  })(),

  monnify: {
    apiKey: str("MONNIFY_API_KEY"),
    secretKey: str("MONNIFY_SECRET_KEY"),
    contractCode: str("MONNIFY_CONTRACT_CODE"),
    /** The Monnify wallet account number payouts are sent from (Monnify dashboard → Wallet). */
    walletAccount: str("MONNIFY_WALLET_ACCOUNT"),
    /** Optional: normally worked out from the key (MK_TEST_ → sandbox, otherwise live). */
    baseUrl: str("MONNIFY_BASE_URL").replace(/\/$/, ""),
  },

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
  /**
   * Where pickups may be. Empty (the default): the cities in src/data/cities.js (Sokoto, Kano, Kaduna,
   * Abuja, Jos). "anywhere" = no limit (for testing elsewhere). Or your own boxes, each
   * west,south,east,north, separated by ";".
   */
  serviceAreas: serviceAreasFrom(str("SERVICE_AREA")),

  matching: {
    radiusM: num("MATCH_RADIUS_M", 7000),
    offerSeconds: num("OFFER_SECONDS", 20),
    timeoutSeconds: num("MATCH_TIMEOUT_SECONDS", 90),
  },

  uploadDir: resolve(process.cwd(), str("UPLOAD_DIR", "./uploads")),
  /** Where document photos are kept: "mongo" (inside the database) or "disk" (UPLOAD_DIR). */
  storage: str("STORAGE", "mongo") === "disk" ? "disk" : "mongo",

  /** The map (vector tiles + label fonts). Our own Sokoto tile server, or OpenFreeMap until it's running. */
  map: {
    tilesUrl: str("MAP_TILES_URL", "https://tiles.openfreemap.org/planet").replace(/\/$/, ""),
    glyphsUrl: str("MAP_GLYPHS_URL", "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"),
  },

  admin: {
    email: str("ADMIN_EMAIL"), password: str("ADMIN_PASSWORD"), name: str("ADMIN_NAME", "Caliphate Admin"),
    /** Map style for the dashboard's place editor. Default: the app's own style, drawn from MAP_TILES_URL. */
    mapStyleUrl: str("ADMIN_MAP_STYLE_URL", "/map-style.json"),
  },
};

function serviceAreasFrom(v) {
  if (/^(anywhere|none|off)$/i.test(v)) return null;
  if (!v) return CITIES.map((c) => ({ ...c.box, name: c.name }));
  const boxes = v.split(";").map((b) => parseBox(b.trim())).filter(Boolean);
  return boxes.length ? boxes : CITIES.map((c) => ({ ...c.box, name: c.name }));
}

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
  const wa = config.whatsapp;
  if (wa.number && (!wa.appSecret || !wa.verifyToken)) problems.push("WHATSAPP_NUMBER is set, so WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN must be set too (see WHATSAPP-EMAIL.md).");
  if (wa.reply && !wa.accessToken) problems.push("WHATSAPP_REPLY=true needs WHATSAPP_ACCESS_TOKEN.");
  if (config.email.provider === "brevo" && !config.email.brevoKey) problems.push("EMAIL_PROVIDER=brevo needs BREVO_API_KEY.");
  if (config.email.provider === "resend" && !config.email.resendKey) problems.push("EMAIL_PROVIDER=resend needs RESEND_API_KEY.");
  if (!["console", "brevo", "resend"].includes(config.email.provider)) problems.push(`EMAIL_PROVIDER must be console, brevo or resend (it's "${config.email.provider}").`);
  // With WhatsApp or email sign-in on, SMS can stay off: codes for the phone sign-in only go to the server log.
  const otherSignIn = !!wa.number || config.email.provider !== "console";
  if (isProd && config.sms.provider === "console" && !config.sms.allowConsoleInProduction && !otherSignIn) {
    problems.push("SMS_PROVIDER is 'console': riders would never receive their sign-in codes. Set up Termii, or set ALLOW_CONSOLE_SMS=true while testing (codes then appear in the server log).");
  }
  if (config.paymentProvider === "monnify" && config.monnify.apiKey && (!config.monnify.secretKey || !config.monnify.contractCode)) {
    problems.push("Monnify needs all three: MONNIFY_API_KEY, MONNIFY_SECRET_KEY and MONNIFY_CONTRACT_CODE (Monnify dashboard → Developers).");
  }
  if (config.paymentProvider === "flutterwave" && isProd && config.flutterwave.secretKey && !config.flutterwave.webhookHash) problems.push("FLW_WEBHOOK_HASH must be set (the same secret hash as in Flutterwave → Settings → Webhooks) so payments can be confirmed.");
  if (isProd && config.corsOrigins.includes("*")) problems.push("CORS_ORIGINS is *. Delete CORS_ORIGINS (it isn't needed: the dashboard is served by the API itself).");
  if (isProd && /localhost|127\.0\.0\.1/.test(config.publicUrl)) problems.push(`PUBLIC_URL is ${config.publicUrl}. Delete PUBLIC_URL on Render (it then uses your onrender.com address), or set it to your real https address.`);
  if (isProd && /localhost|127\.0\.0\.1/.test(config.mongoUri)) problems.push("MONGODB_URI points at this computer (127.0.0.1). Paste your Atlas connection string (mongodb+srv://…).");
  if (!config.mongoUri.startsWith("mongodb")) problems.push("MONGODB_URI must be a MongoDB connection string (mongodb+srv://… from Atlas).");
  if (problems.length) throw new Error(`Settings need attention:\n- ${problems.join("\n- ")}`);
}
