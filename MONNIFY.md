# Payments with Monnify

The backend works with **Monnify** or **Flutterwave**. One setting picks which one handles new
payments and payouts:

```
PAYMENT_PROVIDER=monnify      (or flutterwave)
```

Payments and payouts started with one provider are always checked with that same provider, so you
can switch at any time. Nothing in the app needs changing: riders and drivers just see a secure
payment page.

What Monnify does for Caliphate Rides:

| | How |
|---|---|
| Wallet top-ups, card ride payments, drivers paying commission | Monnify checkout page: card, bank transfer or USSD |
| Checking a driver's bank account name | Monnify account validation |
| Driver withdrawals | Transfer from your **Monnify wallet** to the driver's bank |

Fees (Monnify's pricing page, VAT not included): 1.5% per payment, capped at ₦2,000. Payouts cost
₦10 under ₦10,000, ₦20 under ₦50,000, ₦40 above that.

---

## 1. Try it in the sandbox first (no real money)

1. Sign up at **app.monnify.com**. A sandbox (test) account is ready straight away.
2. **Developers → API Keys & Contracts.** Copy the **API Key** (`MK_TEST_…`), **Secret Key** and
   **Contract Code**.
3. **Developers → Webhook URLs.** Set:
   - Transaction completion: `https://api.caliphaterides.com.ng/payments/monnify/webhook`
   - Disbursement: `https://api.caliphaterides.com.ng/payments/monnify/webhook`

   Click **Save**.
4. Find your **wallet account number**, under **Disbursements** or **Wallet** in the dashboard
   (a 10-digit number). Payouts are sent from it.

On the VPS, add these lines to `/opt/caliphate_rides_backend/.env` (`nano .env`):

```
PAYMENT_PROVIDER=monnify
MONNIFY_API_KEY=MK_TEST_…
MONNIFY_SECRET_KEY=…
MONNIFY_CONTRACT_CODE=…
MONNIFY_WALLET_ACCOUNT=…
```

Then restart with `./scripts/vps-deploy.sh`. The log should say
`Payments: Monnify connected (TEST mode: no real money)`. Check with:

```bash
docker logs caliphate-api 2>&1 | grep Payments
```

The admin website shows a **"Monnify is in TEST mode"** notice while you're in the sandbox.

Test it: top up the wallet in the app. On the checkout page, pick **Pay with transfer** or use one of
the sandbox test cards Monnify lists in its docs. The wallet balance updates in a few seconds.

## 2. Go live

1. **Activate your account** in the Monnify dashboard (Compliance). Monnify asks for your CAC
   documents, the directors' BVN and ID, and a business bank account in the company's name.
2. Once approved, switch the dashboard to **Live** and copy the live **API Key** (`MK_PROD_…`),
   **Secret Key** and **Contract Code**. The live contract code is different from the sandbox one.
3. Set the same two **webhook URLs** in the live dashboard, and **Save**.
4. **Email Monnify support** (support@monnify.com) from your registered email:

   > Hello, please (1) enable disbursements on our account, (2) disable OTP for API disbursements,
   > and (3) whitelist our server IP **161.97.151.166** for disbursements. Business: Caliphate Rides.
   > Contract code: …

   Without (1) and (2), driver withdrawals stop and wait for an OTP (see below). Without (3), Monnify
   refuses payouts from the server.
5. **Settings → Contract Setup:** keep settlement to **Wallet**. Payments then land in your Monnify
   wallet, and driver withdrawals are paid from it.
6. Put the live values in `.env` and run `./scripts/vps-deploy.sh`. The log should say
   `Payments: Monnify connected (LIVE)`.

## Keeping payouts flowing

- Driver withdrawals come out of the **Monnify wallet**. The admin website's **Money** page tells
  you how much drivers can withdraw in total ("Owed to drivers"). Keep at least that much in the wallet.
- If the wallet runs out, the withdrawal fails and the money goes straight back to the driver's
  balance in the app. They can try again later.
- **"Monnify is waiting for an OTP"** on a payout in the admin's Money page means OTP is still on for
  API transfers. Approve that transfer in the Monnify dashboard (Disbursements), and ask Monnify to
  turn OTP off (step 4 above). Once it goes through, the payout updates by itself, or press **Check**.
- **"No answer from Monnify"** means the request may or may not have reached Monnify. Find the
  reference in Monnify → Disbursements, then mark it **paid** or **failed** in the admin's Money page.

## Switching back to Flutterwave

Set `PAYMENT_PROVIDER=flutterwave` (with the `FLW_…` settings) and run `./scripts/vps-deploy.sh`.
See FLUTTERWAVE.md.

## Good to know

- **Never share the Secret Key** in chat, email or GitHub. If it leaks, regenerate it in the Monnify
  dashboard and update `.env`.
- Driver bank accounts checked earlier through Flutterwave are re-checked with Monnify on their next
  withdrawal, automatically. Some digital banks (Kuda, OPay, PalmPay, Moniepoint) use different codes
  at each provider.
- Every payment is confirmed by asking Monnify directly before any wallet is credited, so a fake
  webhook or a closed browser tab can't credit or lose money.
