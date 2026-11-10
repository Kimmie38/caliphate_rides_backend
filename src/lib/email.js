// Sends sign-in codes by email. Free on Brevo (300 a day) or Resend (100 a day, 3,000 a month).
// EMAIL_PROVIDER=console writes them to the server log instead (development and testing).
import { config } from "../config.js";
import { log } from "./log.js";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The sign-in code email, in English and Hausa, plain and simple so it isn't flagged as spam. */
export function codeEmail(code, lang = "en") {
  const ha = lang === "ha";
  const subject = ha ? `Lambar shigarka ta Caliphate Rides: ${code}` : `Your Caliphate Rides code: ${code}`;
  const lines = ha
    ? ["Ga lambar shigarka ta Caliphate Rides:", "Tana aiki na minti 10. Kada ka ba kowa ita.", "Idan ba kai ka nema ba, ka yi watsi da wannan sakon."]
    : ["Here is your Caliphate Rides sign-in code:", "It works for 10 minutes. Don't share it with anyone.", "If you didn't ask for it, you can ignore this email."];
  const text = `${lines[0]}\n\n${code}\n\n${lines[1]}\n${lines[2]}\n\nCaliphate Rides`;
  const html = `<!doctype html><html><body style="margin:0;background:#F3F6F4;font-family:Arial,Helvetica,sans-serif;color:#0C1D15">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border-radius:20px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 24px">
<p style="margin:0 0 6px;font-size:14px;font-weight:bold;color:#00704A">Caliphate Rides</p>
<p style="margin:0 0 18px;font-size:16px;line-height:1.5">${esc(lines[0])}</p>
<p style="margin:0 0 18px;font-size:36px;font-weight:bold;letter-spacing:8px">${esc(code)}</p>
<p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#4F6158">${esc(lines[1])}</p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#4F6158">${esc(lines[2])}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendEmail(to, { subject, text, html }) {
  const e = config.email;
  if (e.provider === "console") {
    log.info("Email (not sent: EMAIL_PROVIDER=console)", { to, subject });
    return;
  }
  let res;
  if (e.provider === "brevo") {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": e.brevoKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: e.fromName, email: e.from }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
    });
  } else if (e.provider === "resend") {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${e.fromName} <${e.from}>`, to: [to], subject, text, html }),
    });
  } else {
    throw new Error(`Unknown EMAIL_PROVIDER "${e.provider}"`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.error("email not sent", { provider: e.provider, status: res.status, body: body.slice(0, 300) });
    throw new Error("Email provider rejected the message");
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
