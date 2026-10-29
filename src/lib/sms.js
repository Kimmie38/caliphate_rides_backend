// Sends sign-in codes by SMS. "console" prints them in the log (development);
// "termii" sends real messages through Termii (https://termii.com), a Nigerian SMS provider.
import { config } from "../config.js";
import { log } from "./log.js";

export async function sendSms(to, message) {
  const s = config.sms;
  if (s.provider === "console") {
    log.info("SMS (not sent: SMS_PROVIDER=console)", { to, message });
    return;
  }
  if (s.provider !== "termii") throw new Error(`Unknown SMS_PROVIDER "${s.provider}"`);
  if (!s.termiiKey || !s.termiiBaseUrl) throw new Error("TERMII_API_KEY and TERMII_BASE_URL must be set to send SMS.");
  const res = await fetch(`${s.termiiBaseUrl}/api/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: s.termiiKey,
      to: to.replace(/^\+/, ""), // Termii expects 234XXXXXXXXXX
      from: s.termiiSender,
      sms: message,
      type: "plain",
      channel: s.termiiChannel,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.error("Termii send failed", { status: res.status, body: body.slice(0, 300) });
    throw new Error("SMS provider rejected the message");
  }
}
