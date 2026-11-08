# Moving the backend and admin website onto your VPS

After this, the API runs on your Contabo server next to the routing server:

| Address | What |
|---|---|
| `https://api.caliphaterides.com.ng` | the backend the app talks to |
| `https://admin.caliphaterides.com.ng` | the admin website (same backend, opens the sign-in) |

The database moves onto the VPS too (MongoDB in Docker: free, private, limited only by your disk),
and everything already in Atlas is copied across: accounts, drivers, rides, places, settings, admins
and driver photos. About 45 minutes.

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

**Already cloned `/opt/caliphate_rides_backend` with the plain `https://github.com/...` address?
Skip to step 4.** This step is only needed once you make the repository private.

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

## 4. Start the database on the VPS and copy your data from Atlas

```bash
cd /opt/caliphate_rides_backend
git pull
chmod +x scripts/*.sh
./scripts/vps-mongo-setup.sh
```

It ends with **"MongoDB is running."** and a line starting `MONGODB_URI=mongodb://caliphate:…`.
**Copy that whole line**: it goes into `.env` in the next step. (The password is also saved in
`/root/caliphate-mongo.env` if you need it again.)

Copy your data from Atlas. Use the Atlas address from Render's `MONGODB_URI`, inside **single quotes**:

```bash
./scripts/vps-mongo-import.sh 'mongodb+srv://caliphate:YOURPASSWORD@caliphate.xxxxx.mongodb.net/caliphate?retryWrites=true&w=majority'
```

It finishes with a list of collections and how many records each has (`users`, `drivers`, `rides`,
`places`, `admins`…).

Turn on the nightly backup (03:00, keeps 7 days in `/opt/caliphate-backups`):

```bash
./scripts/vps-mongo-backup.sh --install-cron
./scripts/vps-mongo-backup.sh
```

## 5. Create the settings file

```bash
cd /opt/caliphate_rides_backend
nano .env
```

Paste this, then fill in the values marked `…`. Most of them can be copied from Render → your
backend → **Environment** (click the eye icon to show a value).

```
NODE_ENV=production
PUBLIC_URL=https://api.caliphaterides.com.ng
MONGODB_URI=…                 (the line vps-mongo-setup.sh printed in step 4)
JWT_SECRET=…                  (same as on Render keeps everyone signed in; a new one just means signing in again)
SMS_PROVIDER=console
ALLOW_CONSOLE_SMS=true
STORAGE=mongo
SERVICE_AREA=anywhere         (only while testing outside Sokoto; delete this line for launch)
ROUTING_URL=http://caliphate-routing:5000
KEEP_ROUTING_AWAKE=false
PAYMENT_PROVIDER=monnify
MONNIFY_API_KEY=…             (Monnify dashboard → Developers; see MONNIFY.md)
MONNIFY_SECRET_KEY=…
MONNIFY_CONTRACT_CODE=…
MONNIFY_WALLET_ACCOUNT=…      (your Monnify wallet account number, for driver payouts)
MAP_TILES_URL=https://tiles.caliphaterides.com.ng/sokoto
MAP_GLYPHS_URL=https://tiles.caliphaterides.com.ng/font/{fontstack}/{range}
```

- Delete the notes in brackets: every line must be just `NAME=value`, with no spaces around `=`
  and no quotes.
- `ROUTING_URL` uses the routing server's inside address: same server, so no internet round trip.
- `MAP_TILES_URL` / `MAP_GLYPHS_URL` draw the admin's map from our own Sokoto tile server
  (`caliphate_rides_map` → `scripts/vps-tiles.sh`). Until that's running, leave these two lines out.
- `STORAGE=mongo` keeps driver document photos in the database, so photos uploaded on Render still open.
- No new admin is needed: your admin account is already in the database.

Save: **Ctrl+O**, **Enter**, **Ctrl+X**. Then make it readable only by you:

```bash
chmod 600 .env
```

## 6. Build and start it

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


## 7. Give it its two addresses (Nginx Proxy Manager)

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

## 8. Check it

- `https://api.caliphaterides.com.ng/health` shows `{"ok":true,"db":"connected"}`
- `https://admin.caliphaterides.com.ng` opens the admin sign-in. Sign in as before.

## 9. Switch everything over

1. **App**: in `.env` and `eas.json`, `EXPO_PUBLIC_API_URL=https://api.caliphaterides.com.ng`
   (already done in the latest app zip), then `npx expo start -c`.
2. **Monnify**: Developers → Webhook URLs → transaction completion and disbursement both
   `https://api.caliphaterides.com.ng/payments/monnify/webhook` (see MONNIFY.md).
3. **Render**: once the app works on the new address, open the backend service →
   **Settings → Suspend Web Service**. Delete it a few days later when you're sure. You can also
   suspend the Render routing service if you made one.
4. **Atlas**: anything created on Render after step 4 (new sign-ups, rides) isn't copied. If there was
   some, run the import again just before switching. Once you're happy, the Atlas cluster can be
   deleted.

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
| Back up the database now | `./scripts/vps-mongo-backup.sh` |
| Full backup ZIP now (records + photos) | `./scripts/vps-full-backup.sh` |
| Put a full backup back | `./scripts/vps-restore.sh /path/to/backup.zip` |
| List backups | `ls -lh /opt/caliphate-backups` |
| Database size | `docker exec caliphate-mongo du -sh /data/db` |

## Backups and moving

There are two kinds of backup:

| | What | Where |
|---|---|---|
| **Nightly** (automatic, 03:00) | the database, for quick repairs | `/opt/caliphate-backups/caliphate-….archive.gz`, last 7 days |
| **Full backup ZIP** | every record + spreadsheets + driver photos, in one file you can open anywhere | admin website → **Backup** → *Download full backup* |

**Download the full backup ZIP every week** and keep it off the server: your computer, a USB drive or
Google Drive. If the VPS ever disappears, that file is everything.

The same ZIP from the server itself: `./scripts/vps-full-backup.sh` (saved in `/opt/caliphate-backups`;
copy it to your PC with the `scp` line it prints).

**Moving to a new server:** set up the new one with steps 1–8 above, but skip the Atlas import
(`vps-mongo-import.sh`). Copy your latest full backup ZIP there (`scp backup.zip root@NEW-IP:/root/`),
then:

```bash
cd /opt/caliphate_rides_backend
./scripts/vps-restore.sh /root/backup.zip
```

It asks you to type `RESTORE`, saves a safety copy of whatever was there, then puts every record and
photo back. Point the DNS records (`api`, `admin`) at the new IP and you're moved.

**Moving to a different database:** the ZIP's `data/` folder has every record as JSON (one per line)
and `spreadsheets/` has them as CSV. The README inside the ZIP explains each file.
