# Free sign-in: WhatsApp and email

Riders and drivers sign in without paid SMS:

- **WhatsApp:** the app shows a short code and opens WhatsApp with it typed in. The person taps Send to the Caliphate Rides WhatsApp number, and the app signs them in. We only *receive* messages, and receiving is free on WhatsApp's official API (Cloud API).
- **Email:** a 6-digit code by email, sent free through Brevo (300 emails a day) or Resend (100 a day).

People who sign in by email add their phone number once, with WhatsApp, before they book or drive, because riders and drivers call each other at pickup. Demo numbers (`DEMO_LOGINS`) and SMS (Termii, if you ever turn it on) still work.

Meta and Brevo change their screens from time to time. If a button has moved, look for the same words nearby.

---

## Part 1: WhatsApp (Meta)

You need a phone number for Caliphate Rides that is **not** on the WhatsApp or WhatsApp Business app (a new SIM is easiest). Meta texts or calls it once with a code.

1. Go to **developers.facebook.com**, log in with Facebook, and choose **My Apps → Create app**.
   - Use case: **Connect with customers through WhatsApp**.
   - Create or pick a **business portfolio** named Caliphate Rides.
2. In the app, open **WhatsApp → API Setup**.
   - Meta gives you a free **test number** straight away. You can use it to try everything below today.
   - For your own number: **Add phone number**, display name **Caliphate Rides**, then verify it with the code Meta sends. The display name is reviewed by Meta (usually within a day or two).
3. Copy these (from **API Setup**):
   - **Phone number ID**: goes in `WHATSAPP_PHONE_NUMBER_ID`
   - **The phone number itself**, digits only with country code (e.g. `2348012345678`): goes in `WHATSAPP_NUMBER`
4. **App settings → Basic → App secret → Show**: goes in `WHATSAPP_APP_SECRET`.
5. Make up a **verify token**: any phrase, for example `caliphate-wa-2026`. Goes in `WHATSAPP_VERIFY_TOKEN`.
6. Put the four values in the server's `.env` (below) and redeploy **before** the next step, so the server can answer Meta's check.
7. **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://api.caliphaterides.com.ng/whatsapp/webhook`
   - Verify token: the same phrase as step 5
   - **Verify and save**. Then under **Webhook fields**, **Subscribe** to **messages**.
8. **Go live:** in the app's top bar, switch **App mode** from Development to **Live**. Meta asks for a privacy policy link first (a simple page on caliphaterides.com.ng is enough).
9. If Meta asks for a **payment method** on the WhatsApp account, you can add one: sign-in only receives messages, which Meta doesn't charge for. Leave `WHATSAPP_REPLY` off (the default) and nothing is sent from your number.

Server `.env`:

```
WHATSAPP_NUMBER=2348012345678
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_APP_SECRET=the-app-secret
WHATSAPP_VERIFY_TOKEN=caliphate-wa-2026
```

**Test it:** in the app tap **Continue with WhatsApp**, then **Open WhatsApp**, press Send, and go back to the app. It signs in within a few seconds. If it doesn't: `docker logs caliphate-api 2>&1 | grep -i whatsapp`.
- "bad signature": `WHATSAPP_APP_SECRET` is wrong.
- Nothing at all: the webhook isn't subscribed to **messages**, or the app is still in Development mode.

Optional: `WHATSAPP_REPLY=true` plus `WHATSAPP_ACCESS_TOKEN` (a permanent token from a System User in Meta Business settings) sends "Confirmed, go back to the app" in WhatsApp. Since 1 October 2026 Meta allows 1,000 such replies a month per number for free, then charges, so keep it off unless you want it.

---

## Part 2: Email (Brevo, free)

1. Sign up at **brevo.com** (free plan). Brevo may review a new account before it can send; that can take a day.
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain**: `caliphaterides.com.ng`.
   - Brevo shows a few DNS records (TXT and CNAME). Add each in **Cloudflare → DNS** exactly as shown, with the proxy **off** (grey cloud).
   - Back in Brevo, **Authenticate**. This keeps codes out of spam.
3. **Senders → Add a sender**: name **Caliphate Rides**, email `no-reply@caliphaterides.com.ng`.
4. **SMTP & API → API keys → Generate a new API key**. Copy it.

Server `.env`:

```
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-...
EMAIL_FROM=no-reply@caliphaterides.com.ng
EMAIL_FROM_NAME=Caliphate Rides
```

**Resend instead of Brevo:** sign up at resend.com, add and verify the domain the same way, create an API key, then `EMAIL_PROVIDER=resend` and `RESEND_API_KEY=re_...`.

**Test it:** tap **Continue with email**, enter your address, and type the code from the email (check Spam the first time and mark it "Not spam").

Until Brevo is set up, leave `EMAIL_PROVIDER=console`: email codes are written to the server log, which is handy for testing:

```
docker logs caliphate-api 2>&1 | grep "email code" | tail -3
```

---

## Keep people signed in longer

Each code you don't need is one less step for riders. In `.env`:

```
JWT_DAYS=180
```

People then sign in once and stay signed in for six months on that phone.

## After changing `.env`

```
cd /opt/caliphate_rides_backend
./scripts/vps-deploy.sh
docker logs caliphate-api 2>&1 | tail -20
```

The app shows **Continue with WhatsApp** only when WhatsApp is set up on the server, and **Continue with email** when email is.
