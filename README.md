# Caliphate Rides: backend

The server behind the Caliphate Rides app: sign-in by SMS code, fares, finding a driver, live
tracking, payments (cash, transfer, wallet, card through Flutterwave), commission and driver payouts,
driver sign-up with an official record, and the web admin dashboard (served by this same server at
`/dashboard`).

Built with **Node.js** (Express, Socket.IO) and **MongoDB** (Mongoose). Node 20.19 or newer.

```
src/
  server.js        starts everything (database, API, live updates, matching)
  app.js           routes and error handling
  config.js        settings from .env
  routes/          the API, one file per area (auth, rides, wallet, drivers, driver trips, admin…)
  services/        rides, matching, live updates, payments, pricing
  models/          MongoDB collections
  lib/             small helpers (fares, phone numbers, tokens, driver rules, Flutterwave, SMS…)
public/dashboard/  the admin website (plain HTML/JS, no build step)
scripts/seed.js    optional: the same first-time setup the server does on start
test/              unit tests (npm test)
```

## 1. Run it on your computer

1. Install [Node.js 22](https://nodejs.org).
2. Get a database. The easiest is **MongoDB Atlas** (free, nothing to install):
   - Sign up at [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas/register) → create a **free M0** cluster (pick a region close to Nigeria, e.g. Frankfurt or Johannesburg if offered).
   - **Database Access** → add a user with a password.
   - **Network Access** → add `0.0.0.0/0` (allow from anywhere; your server's address can change).
   - **Connect → Drivers** → copy the connection string. Put `/caliphate` before the `?` so the database is named, e.g.
     `mongodb+srv://caliphate:PASSWORD@cluster0.abcd.mongodb.net/caliphate?retryWrites=true&w=majority`
3. In this folder:
   ```bash
   cp .env.example .env        # or use .env.local; then paste MONGODB_URI and set ADMIN_EMAIL / ADMIN_PASSWORD
   npm install
   npm run dev                 # API on http://localhost:4000 (sets up fares, places and the first admin)
   ```
4. Open http://localhost:4000/health. You should see `{"ok":true,"db":"connected"}`.
5. Open http://localhost:4000/dashboard and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

While `SMS_PROVIDER=console`, sign-in codes are printed in the terminal instead of sent by SMS,
so you can sign in from the app without an SMS account.

## 2. Point the app at it

In the app folder (`caliphate-rides`), in `.env`:

```
EXPO_PUBLIC_USE_MOCK=false
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000     # your computer's Wi-Fi address while testing
```

Your phone can't reach `localhost` on your computer, so use the computer's local IP address (on
Windows run `ipconfig`, on Mac `ipconfig getifaddr en0`), with the phone on the same Wi-Fi. After
deploying, use the public address instead (e.g. `https://caliphate-api.onrender.com`), and add
`EXPO_PUBLIC_USE_MOCK` and `EXPO_PUBLIC_API_URL` to the `base` env in `eas.json` for app builds.

To check that the app and the server agree on every route and live event:

```bash
npm run check-contract            # expects the app in ../caliphate-rides
```

## 3. Put it online

### Option A: Render (free to start) + MongoDB Atlas

Full step-by-step guide: **[DEPLOY-RENDER.md](DEPLOY-RENDER.md)**. In short:

1. Create a free Atlas M0 cluster (AWS, Frankfurt), a database user, and allow `0.0.0.0/0`.
2. Put this folder in its own GitHub repository (`package.json` at the top level).
3. Render → **New → Web Service** → the repo. Build `npm install --omit=dev`, start `node src/server.js`,
   Free plan, Frankfurt, health check `/health`.
4. Environment: `NODE_ENV=production`, `JWT_SECRET` (Generate), `MONGODB_URI`, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `SMS_PROVIDER=console`, `ALLOW_CONSOLE_SMS=true`, `STORAGE=mongo`.

On first start the server sets itself up (fares, Sokoto places, the first admin), so there's nothing
to run by hand. Render sets `RENDER_EXTERNAL_URL` itself, which the server uses as its public address.

The free plan **sleeps after 15 minutes without traffic**, and the first request then takes about a
minute. That's fine for testing. For real riders and drivers, either move to Render's Starter plan
(about $7 a month), or use option B. Document photos are stored in MongoDB (`STORAGE=mongo`),
because Render's free disk is wiped on every restart.

### Option B: your own server (Oracle Cloud free VM, or any VPS)

A small always-on Linux server runs both the API and MongoDB for free with Oracle's Always Free
tier, or for a few dollars a month elsewhere.

```bash
# on the server, with Docker installed
git clone <your repo> caliphate-backend && cd caliphate-backend
cp .env.example .env          # NODE_ENV=production, PUBLIC_URL, JWT_SECRET, Termii, Flutterwave…
docker compose up -d          # API + MongoDB
# the server sets up fares, places and the first admin on its first start
```

Put HTTPS in front of it (Caddy is simplest: `caliphate-api.yourdomain.ng { reverse_proxy localhost:4000 }`).
The map server kit's Caddy can serve both.

### Production settings the server insists on

With `NODE_ENV=production` the server refuses to start unless:
- `JWT_SECRET` is a long random string (Render can generate one),
- `MONGODB_URI` is set,
- `SMS_PROVIDER=termii`, or `ALLOW_CONSOLE_SMS=true` while testing (codes then go to the server log),
- `FLW_WEBHOOK_HASH` is set whenever `FLW_SECRET_KEY` is.

## 4. SMS sign-in codes (Termii)

1. Sign up at [termii.com](https://termii.com), fund the account.
2. Request a **sender ID** (e.g. `Caliphate`) and ask support to enable the **DND route**, so codes
   reach numbers on Do-Not-Disturb (most Nigerian numbers).
3. Copy your API key and base URL from the dashboard into `TERMII_API_KEY` and `TERMII_BASE_URL`.

For app-store reviewers, `TEST_PHONE` and `TEST_CODE` give one fixed login that needs no SMS.

## 5. Payments and payouts (Flutterwave)

1. Sign up at [flutterwave.com](https://flutterwave.com) and finish the business verification (KYC).
   Live payments and, especially, payouts to drivers' banks only work on a fully approved account.
2. **Settings → API Keys**: put the secret key in `FLW_SECRET_KEY` (`FLWSECK_TEST-…` while testing,
   `FLWSECK-…` for launch).
3. **Settings → Webhooks**: set the URL to `https://YOUR-API/payments/flutterwave/webhook`, make up a
   long random **secret hash**, enter it there and in `FLW_WEBHOOK_HASH`. Tick the events for
   charges and transfers.
4. **For driver withdrawals** (Settings → Security / Transfers):
   - turn on **Transfer via API**;
   - **whitelist your server's IP addresses**: Flutterwave refuses transfer calls from any other IP.
     On Render they're under your service → **Connect → Outbound** (static per region); on a VPS it's
     the server's public IP;
   - keep money in your **Flutterwave NGN balance**. Payouts are paid from it, so it must cover what
     drivers can withdraw (the dashboard's Money page shows that total).

What happens:
- **Card payments, wallet top-ups and drivers paying what they owe** open Flutterwave's checkout page.
  When it's done, Flutterwave tells the server (webhook) and the rider's browser comes back to
  `/payments/flutterwave/return`. Either way, the server asks Flutterwave to confirm the payment
  (status, amount, currency) before applying it, and applies each payment once.
- **Cash and transfer** rides are confirmed by the driver in the app. **Wallet** rides are charged when
  the trip ends.
- **Withdrawals**: the driver taps Withdraw; the amount comes off their balance straight away and is
  sent to their bank account (checked with the bank first: the name on the account must match the
  driver, or an admin accepts it). If the bank refuses it, the money goes back on their balance. If
  Flutterwave doesn't answer at all, the payout is marked **needs checking** and an admin settles it
  from the Money page after looking it up in the Flutterwave dashboard, so nothing is paid twice.
  Caliphate Rides pays the transfer fee.

## 6. Fares, commission and how drivers are paid

The admin sets everything on the dashboard's **Fares & commission** page, with − / + buttons and a
live preview, separately for keke and car:

    fare = base fare + (road km × price per km), rounded to the nearest ₦50, never below the minimum
    driver gets = fare − commission          commission = fare × commission %

Start values: ₦500 per km, no base fare, ₦500 minimum, **15% commission**. Each trip keeps the prices
and commission it was booked with.

How the commission is collected, through one balance per driver:
- Every finished trip takes the commission **off** the driver's balance.
- Card and wallet trips are paid to Caliphate Rides, so the full fare is **added** to the balance when
  the payment is confirmed. Net: the driver gets fare − commission, which they withdraw to their bank.
- Cash and transfer trips are paid straight to the driver, so only the commission comes off and the
  balance can go **below zero** (the driver owes). Later card and wallet trips pay it back
  automatically, or the driver pays it in the app (Flutterwave).
- A driver who owes more than the limit (₦5,000 to start) isn't offered trips and can't go online until
  they pay. The limit and the smallest withdrawal (₦1,000) are on the same page.

Every movement is kept in the driver's ledger (shown in the app's Earnings tab and on the dashboard),
and admins can correct a balance with a reason.

## 7. How a ride works

1. The app asks for a quote. The server works out the road distance (OSRM) and the fare (section 6).
   The app's price is never trusted.
2. The rider books. The server offers the trip to the **nearest free, approved, online driver** of
   that vehicle type within 7 km. Each driver has 20 seconds to accept; if they decline or don't
   answer, the next driver is asked. After 90 seconds with no one, the rider is told no drivers are free.
3. Live updates go over Socket.IO: the rider sees the ride status and the driver's position;
   the driver gets requests, cancellations and "paid" notices.
4. Drivers can only go online when approved, and when their licence, vehicle licence, insurance
   (and roadworthiness for cars) are approved and not expired.

Matching timers and rate limits live in the server's memory, so run **one** instance. That handles a
city comfortably; if you ever need several, move them to Redis first.

## 8. The admin dashboard

Open **`https://YOUR-API/dashboard`** and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` (created on first start). Pages:

- **Overview**: today's fares, commission, rides, online drivers, and what needs attention.
- **Fares & commission**: section 6. Changes apply to new trips as soon as they're saved, and each
  change is recorded in the history.
- **Map places**: click anywhere on the map to drop a pin for a place the map doesn't know (a junction,
  a shop, an estate), name it and choose its type. It shows up in the app's search and as a label on
  the app's map (the app loads `GET /places` when it opens). Drag a pin to move it, hide it, or delete it.
- **Drivers**: applications to review, every document with its photos, approve / ask for changes /
  reject / put on hold, the bank account check, the balance and its ledger.
- **Money & payouts**: commission earned, what drivers owe, what's owed to drivers, and every
  withdrawal, with the tools to settle one that needs checking.
- **Rides**, **Riders** (block / unblock), and **Admins** (owner only: add or remove admins).

The dashboard is plain HTML and JavaScript in `public/dashboard`, served by the API itself, so there's
nothing extra to deploy.

Drivers fill in their application in the app; each one gets a record number like
`CR-DRV-2026-000001`, and every document keeps its full history of uploads and reviews. Document
photos are private and only reachable through links that expire after an hour.

## API at a glance

| Who | Endpoints |
|---|---|
| Everyone | `GET /health`, `GET /config/pricing`, `GET /places`, `GET /places/popular` |
| Sign-in | `POST /auth/otp/request`, `POST /auth/otp/verify`, `GET/PATCH /me` |
| Riders | `POST /rides/quote`, `POST /rides`, `GET /rides/current`, `GET /rides/history`, `POST /rides/:id/cancel`, `POST /rides/:id/rate`, `PATCH /rides/:id/payment`, `POST /rides/:id/pay`, `GET /wallet`, `POST /wallet/topup` |
| Driver sign-up | `GET/PUT /drivers/me/application`, `POST /drivers/me/documents`, `POST /drivers/me/application/submit` |
| Driving | `GET /driver/rides/current`, `POST /driver/rides/:id/accept`, `…/decline`, `…/arrived`, `…/start`, `…/complete`, `…/payment-received`, `GET /driver/earnings` |
| Driver money | `GET /driver/wallet`, `POST /driver/withdrawals`, `POST /driver/wallet/pay`, `POST /driver/bank/verify` |
| Flutterwave | `POST /payments/flutterwave/webhook`, `GET /payments/flutterwave/return` |
| Admin | `/admin/*` (above) |

Live events (Socket.IO, connect with `auth: { token }`):
app → server `ride:subscribe`, `ride:unsubscribe`, `driver:online`, `driver:position`;
server → app `ride:updated`, `driver:position`, `ride:request`, `ride:cancelled`, `ride:paid`, `driver:error`,
`driver:balance`, `driver:withdrawal`.

Errors come back as `{ "code": "...", "message": "..." }`, with a message the app can show as written.

## Tests

```bash
npm test
```
