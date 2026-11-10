// Meta's WhatsApp webhook. Set it up in Meta for Developers → your app → WhatsApp → Configuration:
//   Callback URL:  https://api.caliphaterides.com.ng/whatsapp/webhook
//   Verify token:  the same phrase as WHATSAPP_VERIFY_TOKEN
//   Subscribe to:  messages
//   GET  /whatsapp/webhook   Meta checks the URL once (hub.challenge)
//   POST /whatsapp/webhook   incoming messages; a sign-in code marks that WhatsApp check confirmed
import { Router, raw } from "express";
import { config } from "../config.js";
import { log } from "../lib/log.js";
import { codesIn, messagesIn, reply, validSignature } from "../lib/whatsapp.js";
import { WhatsAppCheck } from "../models/index.js";

export const whatsappRouter = Router();

whatsappRouter.get("/webhook", (req, res) => {
  const ok = req.query["hub.mode"] === "subscribe" && config.whatsapp.verifyToken && req.query["hub.verify_token"] === config.whatsapp.verifyToken;
  if (!ok) return res.status(403).send("Forbidden");
  res.type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
});

whatsappRouter.post("/webhook", raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!validSignature(body, req.get("x-hub-signature-256"))) {
    log.warn("WhatsApp webhook: bad signature, ignored");
    return res.sendStatus(401);
  }
  // Answer Meta straight away (it retries slow webhooks), then handle the messages.
  res.sendStatus(200);
  let payload;
  try { payload = JSON.parse(body.toString("utf8")); } catch { return; }
  for (const m of messagesIn(payload)) {
    const codes = codesIn(m.text);
    if (!codes.length) continue;
    try {
      const check = await WhatsAppCheck.findOneAndUpdate(
        { code: { $in: codes }, status: "pending", expiresAt: { $gt: new Date() } },
        { $set: { status: "confirmed", phone: m.from, confirmedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!check) continue;
      log.info("WhatsApp check confirmed", { purpose: check.purpose });
      await reply(m.from, "✅ Confirmed. Go back to the Caliphate Rides app. / An tabbatar. Koma manhajar Caliphate Rides.");
    } catch (err) {
      log.error("WhatsApp webhook failed", { err: err.message });
    }
  }
});
