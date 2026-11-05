# Moving the backend and admin website onto your VPS

After this, the API runs on your Contabo server next to the routing server:

| Address | What |
|---|---|
| `https://api.caliphaterides.com.ng` | the backend the app talks to |
| `https://admin.caliphaterides.com.ng` | the admin website (same backend, opens the sign-in) |

The database stays on **MongoDB Atlas**, so every account, driver, ride and setting you already have
carries over. Nothing is copied. About 30 minutes.

---

## 1. Put the latest code on GitHub

Upload everything in **caliphate-backend.zip** to the `caliphate_rides_backend` repository
(replacing the old files), and commit. It includes `scripts/vps-deploy.sh` and this guide.

## 2. Add the two addresses in Cloudflare

Cloudflare → `caliphaterides.com.ng` → **DNS → Records → Add record**, twice:

| Type | Name | IPv4 address | Proxy status |
|---|---|---|---|
| A | `api` | `161.97.151.166` | **DNS only** (grey cloud) |
| A | `admin` | `161.97.151.166` | **DNS only** (grey cloud) |

## 3. Let the server read your private repository

Do this once. On the VPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/caliphate_backend -N "" -C "caliphate-vps"
cat ~/.ssh/caliphate_backend.pub
```

Copy the line it prints (starts with `ssh-ed25519`). On GitHub: `caliphate_rides_backend` →
**Settings → Deploy keys → Add deploy key** → Title `Contabo VPS`, paste the key, leave
**Allow write access** unticked → **Add key**.

Back on the VPS:

```bash
cat >> ~/.ssh/config <<'CFG'
Host github-backend
  HostName github.com
  User git
  IdentityFile ~/.ssh/caliphate_backend
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
git clone git@github-backend:Kimmie38/caliphate_rides_backend.git /opt/caliphate_rides_backend
```

If it asks *"Are you sure you want to continue connecting"*, type `yes`.

## 4. Create the settings file

```bash
cd /opt/caliphate_rides_backend
nano .env
```

Paste this, then fill in the values marked `…`. Most of them can be copied from Render → your
backend → **Environment** (click the eye icon to show a value).

```
NODE_ENV=production
PUBLIC_URL=https://api.caliphaterides.com.ng
MONGODB_URI=…                 (same as on Render)
JWT_SECRET=…                  (same as on Render keeps everyone signed in; a new one just means signing in again)
SMS_PROVIDER=console
ALLOW_CONSOLE_SMS=true
STORAGE=mongo
SERVICE_AREA=anywhere         (only while testing outside Sokoto; delete this line for launch)
ROUTING_URL=http://caliphate-routing:5000
KEEP_ROUTING_AWAKE=false
FLW_SECRET_KEY=…              (same as on Render, if set)
FLW_WEBHOOK_HASH=…            (same as on Render, if set)
```

- Delete the notes in brackets: every line must be just `NAME=value`, with no spaces around `=`
  and no quotes.
- `ROUTING_URL` uses the routing server's inside address: same server, so no internet round trip.
- `STORAGE=mongo` keeps driver document photos in the database, so photos uploaded on Render still open.
- No new admin is needed: your admin account is already in the database.

Save: **Ctrl+O**, **Enter**, **Ctrl+X**. Then make it readable only by you:

```bash
chmod 600 .env
```

## 5. Build and start it

```bash
chmod +x scripts/vps-deploy.sh
./scripts/vps-deploy.sh
```

The first build takes 1–3 minutes. It ends with:

```
The API is running:
{"ok":true,"db":"connected"}
```

If it shows `It didn't start` and some log lines instead, send them to Claude.

## 6. Give it its two addresses (Nginx Proxy Manager)

`http://161.97.151.166:81` → **Hosts → Proxy Hosts → Add Proxy Host**:

**Details**

| Field | Value |
|---|---|
| Domain Names | `api.caliphaterides.com.ng` **and** `admin.caliphaterides.com.ng` (type each, press Enter) |
| Scheme | `http` |
| Forward Hostname / IP | `caliphate-api` |
| Forward Port | `4000` |
| Block Common Exploits | on |
| **Websockets Support** | **on** (live ride tracking needs it) |

**SSL**: Request a new certificate, **Force SSL** and **HTTP/2** on, your email, I Agree → **Save**.

## 7. Check it

- `https://api.caliphaterides.com.ng/health` shows `{"ok":true,"db":"connected"}`
- `https://admin.caliphaterides.com.ng` opens the admin sign-in. Sign in as before.

## 8. Switch everything over

1. **App**: in `.env` and `eas.json`, `EXPO_PUBLIC_API_URL=https://api.caliphaterides.com.ng`
   (already done in the latest app zip), then `npx expo start -c`.
2. **Flutterwave** (if set up): Settings → Webhooks → URL
   `https://api.caliphaterides.com.ng/payments/flutterwave/webhook`.
3. **Render**: once the app works on the new address, open the backend service →
   **Settings → Suspend Web Service**. Delete it a few days later when you're sure. You can also
   suspend the Render routing service if you made one.

---

## Updating later

After uploading new code to GitHub:

```bash
cd /opt/caliphate_rides_backend
./scripts/vps-deploy.sh
```

It pulls the new code, rebuilds and restarts (about a minute of downtime).

## Useful commands

| What | Command |
|---|---|
| Is it running? | `docker ps --filter name=caliphate-api` |
| Recent logs | `docker logs caliphate-api --tail 50` |
| Watch logs live (Ctrl+C to stop) | `docker logs -f caliphate-api` |
| Find a sign-in code (SMS off) | `docker logs caliphate-api 2>&1 \| grep "code is" \| tail -3` |
| Restart | `docker restart caliphate-api` |
| Change a setting | `nano .env`, then `./scripts/vps-deploy.sh` |
