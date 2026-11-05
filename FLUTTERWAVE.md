# Connecting Flutterwave (live payments)

The backend is already built for Flutterwave: card payments for rides, wallet top-ups, drivers paying
the commission they owe, bank account checks and driver withdrawals. What's left is on your
Flutterwave account and on Render.

## 1. Get your business approved (Flutterwave asks for this before live keys work)

In **https://app.flutterwave.com** → **Settings → Business / Compliance**, complete every section:

**As a starter (unregistered) business:**
- BVN and NIN of the owner, and a clear ID (NIN slip, driver's licence or international passport)
- Residential address with proof (your electricity meter number)
- A website or social media page for Caliphate Rides (an Instagram or Facebook page works)
- A short description of the business and estimated monthly sales
- Your **settlement bank account** (where Flutterwave pays your money)

**As a registered business (needed for the full set of features, including paying drivers):**
- CAC certificate (business name or Certificate of Incorporation; for a limited company also the
  Memorandum and Articles of Association)
- The same ID, BVN/NIN and proof of address for the owner/directors
- An operating licence if your business is regulated

Submit, then wait for Flutterwave's email that the business is approved (usually 1–3 working days).
If it's slow, write to Flutterwave support from the dashboard.

## 2. Get the live secret key

1. Switch the dashboard to **Live mode**.
2. **Settings → Developers → API Keys**. Copy the **Secret key**: it starts with **`FLWSECK-`** (no `TEST`).
   - If there's a **"V3 API keys"** section, use the secret key from there.
   - If you only see a **Client ID** and **Client Secret**, tell Claude: the backend needs an addition
     for Flutterwave's newer "v4" keys.
3. Keep it secret: it only goes into Render. Never into the app, a chat or a screenshot.

## 3. Webhook (Live mode has its own settings)

Make up a **secret hash**: 30+ random letters and numbers. Then **Settings → Developers → Webhooks**
(in Live mode):

| Field | Value |
|---|---|
| URL | `https://caliphate-api.onrender.com/payments/flutterwave/webhook` (your API address) |
| Secret hash | the value you made up |

Tick: **JSON format**, **webhook retries**, **failed transactions**, **v3 webhooks** (if shown) and the
**transfer** webhooks. Save.

## 4. Add the keys on Render

Render → **caliphate-api** → **Environment**:

| Key | Value |
|---|---|
| `FLW_SECRET_KEY` | the live `FLWSECK-…` key |
| `FLW_WEBHOOK_HASH` | the secret hash (exactly the same as in Flutterwave) |
| `FLW_LOGO_URL` | optional: an https link to your logo, shown on the payment page |

Save. Render restarts the API. **Logs** should say `Flutterwave connected (LIVE).`
The admin dashboard no longer shows "Flutterwave isn't connected".

## 5. Check it with a small real payment

1. In the app: **Wallet → Add ₦1,000** and pay with your own card (or bank transfer / USSD).
2. You land on "Payment received". Back in the app the wallet shows ₦1,000.
3. In Flutterwave → **Transactions** you see it as successful.
4. The ₦1,000 stays in your test rider's wallet and can pay for a ride. To get it back instead:
   Flutterwave → Transactions → the payment → **Refund** (the wallet balance then isn't real money,
   so don't spend it).

## 6. Driver withdrawals

1. **Settings → Developers** (or **Security**): turn on **Transfer via API**.
2. **IP whitelisting**: Flutterwave only accepts payout requests from addresses you list. On Render →
   caliphate-api → **Connect** (top right) → **Outbound**: add every IP address shown to Flutterwave's
   whitelist.
3. **Fund your NGN balance**: payouts are paid from your Flutterwave balance. Keep enough there to
   cover what drivers can withdraw (the dashboard's **Money & payouts** page shows "Owed to drivers").
   By default Flutterwave sends your earnings to your settlement bank; you can keep some in the balance
   or top it up in Flutterwave → **Balances**.
4. Test with a real driver account: the bank check shows the name on the driver's account; then the
   driver withdraws ₦1,000 from Earnings. It arrives in minutes.

## Good to know

- **Fees**: Flutterwave takes its fee from each payment (see flutterwave.com/ng/pricing). A ₦1,000
  top-up adds ₦1,000 to the wallet and you receive ₦1,000 minus the fee. Transfer fees for driver
  payouts are also paid by you.
- **Render's free plan sleeping doesn't lose payments**: Flutterwave retries its webhook, the rider's
  return page confirms the payment, and opening the Wallet re-checks any pending top-up.
- **Never trust a payment without the server**: the backend always re-checks every payment with
  Flutterwave (status, amount, currency) before giving any money, and applies each payment once.

## If something doesn't work

| Problem | Fix |
|---|---|
| App says "Online payments aren't set up yet" | `FLW_SECRET_KEY` isn't set on Render, or the API hasn't restarted. |
| "The payment service couldn't do that" | Render Logs show `flutterwave refused` with Flutterwave's reason. Usually the account isn't approved yet, or a test key is mixed with live mode. |
| Payment succeeded but the wallet didn't update | Webhook URL or secret hash doesn't match. Opening the Wallet again re-checks it. |
| Withdrawal "needs checking" | Turn on Transfer via API and whitelist all of Render's outbound IPs. Then settle it on the dashboard's Money page. |

## Testing without real money (optional)

Everything above works the same in **Test mode** with the `FLWSECK_TEST-…` key. Test card:
`5531 8866 5214 2950`, expiry `09/32`, CVV `564`, PIN `3310`, OTP `12345`. Test bank for withdrawals:
Access Bank `0690000031`.
