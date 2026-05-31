# Render Deployment Guide — Electronics Installments System

Free-tier deploy of **backend + frontend** on Render, with the cold-start
problem solved by an UptimeRobot keep-alive ping.

Total time: **~1 hour** (most of it waiting for first builds).
Total cost: **$0/month**.

---

## Architecture after deploy

```
                              ┌─────────────────────────────────┐
UptimeRobot (free)            │ Render Web Service (free)       │
     │                        │  eis-backend.onrender.com       │
     │ HTTP GET /api/health   │  - Express API                  │
     ├──── every 5 min ──────►│  - node-cron scheduler          │
     │                        │  - Firebase Admin SDK (FCM)     │
     │                        └────────────┬────────────────────┘
     │                                     │
     │                                     ▼
┌──────────────────────────┐     ┌──────────────────────────────┐
│ Render Static Site (free)│     │ Supabase (Postgres + Auth)    │
│ eis-frontend.onrender.com│     │ koldxkjvbifsszuhjrll          │
│  - React SPA             │     └──────────────────────────────┘
└──────────────────────────┘     ┌──────────────────────────────┐
                                 │ Firebase Cloud Messaging      │
                                 │ electronics-installments      │
                                 └──────────┬───────────────────┘
                                            │ FCM push (lock/unlock)
                                            ▼
                                 ┌──────────────────────────────┐
                                 │ Customer phones (Android APK)│
                                 │ APK hosted on GitHub Releases│
                                 └──────────────────────────────┘
```

---

## Prereqs

- The repo is pushed to GitHub (private is fine).
- You have:
  - Supabase URL + anon + service_role keys
  - Firebase service-account JSON (already at `backend/firebase-service-account.json` — copy its contents)

---

## Step 1 — One-click Blueprint deploy (5 min)

This repo contains `render.yaml` at root. Render reads it and provisions both
services in one shot.

1. Go to **https://dashboard.render.com**, sign in with GitHub.
2. **New +** → **Blueprint** → connect your GitHub repo.
3. Render parses `render.yaml` and shows a form listing every env var marked
   `sync: false`. Fill in:

   **Backend (`eis-backend`):**
   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | `https://koldxkjvbifsszuhjrll.supabase.co` |
   | `SUPABASE_ANON_KEY` | (paste anon JWT) |
   | `SUPABASE_SERVICE_KEY` | (paste service_role JWT) |
   | `FCM_SERVICE_ACCOUNT_JSON` | **(paste the entire firebase-service-account.json contents — single line OK)** |
   | `FRONTEND_URL` | leave blank for now (set after Step 2) |
   | `PUBLIC_API_BASE_URL` | leave blank for now (set after this finishes) |

   **Frontend (`eis-frontend`):**
   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://koldxkjvbifsszuhjrll.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | (paste anon JWT) |
   | `VITE_API_BASE_URL` | leave blank for now (set after Step 2) |

4. Click **Apply**. Render builds both services in parallel (~5–10 min first time).

5. When the backend finishes, note its URL (e.g. `https://eis-backend.onrender.com`).
   When the frontend finishes, note its URL (e.g. `https://eis-frontend.onrender.com`).

---

## Step 2 — Wire the URLs together (2 min)

1. **Backend** → Environment tab → fill in the two values left blank:
   - `FRONTEND_URL` = `https://eis-frontend.onrender.com`
   - `PUBLIC_API_BASE_URL` = `https://eis-backend.onrender.com`
   - Save → it auto-redeploys (~1 min).

2. **Frontend** → Environment tab:
   - `VITE_API_BASE_URL` = `https://eis-backend.onrender.com/api`
   - Save → manual redeploy (Vite needs the env var at build time).

3. Wait for both services to show **"Live"** in the dashboard.

---

## Step 3 — Supabase configuration (2 min)

Supabase needs to whitelist your new frontend URL so its Auth flows work:

1. Supabase Dashboard → your project → **Authentication** → **URL Configuration**:
   - **Site URL:** `https://eis-frontend.onrender.com`
   - **Redirect URLs:** add `https://eis-frontend.onrender.com/*`
2. Save.

---

## Step 4 — UptimeRobot keep-alive (5 min)

This is what keeps your backend awake on the free tier so the `node-cron`
scheduler (auto-lock, WhatsApp reminders) fires reliably.

1. Sign up at **https://uptimerobot.com** (free).
2. Click **"+ New Monitor"**:
   | Field | Value |
   |---|---|
   | Monitor Type | `HTTP(s)` |
   | Friendly Name | `EIS backend keep-alive` |
   | URL | `https://eis-backend.onrender.com/api/health` |
   | Monitoring Interval | `5 minutes` |
   | Monitor Timeout | `30 seconds` |
3. Pick yourself as the alert contact (so you get notified if the backend dies).
4. Click **Create Monitor**.

Within 5 min the first ping fires. From then on your backend stays warm 24/7.

**Verify it's working** (after 24 hours):
- UptimeRobot dashboard → click your monitor → response time stays under 500 ms
  (versus ~30 sec if it had been cold-starting)
- Render dashboard → backend service → **Metrics** → CPU/Memory shows a
  steady baseline, not a sawtooth pattern of sleep+wake.

---

## Step 5 — Test the deployment (5 min)

1. Open `https://eis-frontend.onrender.com` in a browser.
2. Log in as **Super Admin**: `super@eis.local` / `Super@123456`
3. You should land on `/super-admin/overview` with the KPI dashboard.
4. Navigate to `/super-admin/phones` — should show the 4 existing test devices.
5. Open browser DevTools → Network tab → all `/api/...` calls should hit
   `eis-backend.onrender.com` and return 200.

If something 401s or 403s, double-check that the frontend's
`VITE_API_BASE_URL` matches the backend URL exactly (including `/api` suffix).

---

## Step 6 — Build & ship the Android APK (30 min, one-time)

The Android app does NOT need the backend URL baked in at build time — that
gets pushed into the phone at enrollment via the QR's `url` field, which the
backend builds from `PUBLIC_API_BASE_URL`. So the APK is environment-agnostic.

1. Open `/Users/usman/Desktop/electronics instalments system/android-app/` in
   Android Studio.
2. Drop your `google-services.json` (downloaded from Firebase Console →
   Project Settings → Your apps → Android app) into `android-app/app/`.
3. **Build → Generate Signed Bundle / APK** → APK → create a new keystore
   (save the keystore file + password securely — you need them for future updates).
4. Build the **release** variant → produces `app/release/app-release.apk`.
5. Push the APK to **GitHub Releases**:
   - GitHub → your repo → **Releases** → "Draft a new release"
   - Tag: `v1.0.0`
   - Title: "First production build"
   - Drag-drop `app-release.apk` into the asset area
   - Publish release → note the public download URL, e.g.
     `https://github.com/USER/REPO/releases/download/v1.0.0/app-release.apk`
6. **Compute the APK signing cert checksum** — the Android Setup Wizard
   refuses to install the APK from the QR unless it matches this value:
   ```sh
   keytool -list -printcert -jarfile app-release.apk \
     | grep -E '^\s+SHA256:' | head -n1 \
     | awk '{print $2}' | tr -d ':' | xxd -r -p \
     | openssl base64 | tr '+/' '-_' | tr -d '=\n'
   ```
   Output looks like `Lk2vC7Z…rE9Xz` (~43 chars, no padding).
7. **Tell the backend about it** — go to Render → eis-backend → Environment:
   - `ANDROID_APK_DOWNLOAD_URL` = the GitHub Releases URL from step 5
   - `ANDROID_APK_SIGNATURE_CHECKSUM` = the value from step 6
   Save → backend auto-redeploys.
8. The next QR you generate from `/super-admin/phones → Enroll device` now
   contains the full Android-provisioning payload. Setup Wizard scans →
   downloads APK → verifies checksum → installs as Device Owner → calls
   `/api/devices/enroll`.

---

## What to expect on the free tier

| Behaviour | Free | Starter ($7/mo) |
|---|---|---|
| Backend cold start (no UptimeRobot) | ~30–50 sec after 15 min idle | Never |
| Backend cold start (with UptimeRobot) | Never | Never |
| Static site cold start | Never | Never |
| Build minutes per month | 500 (plenty) | Unlimited |
| Bandwidth | 100 GB/month | 100 GB/month |
| Custom domains + HTTPS | Yes | Yes |
| Suspends if monthly free quota exceeded | Yes | No |

For your scale (one electronics shop, a few hundred customer phones max,
a handful of admin users), the free tier is more than enough.

---

## Common issues & fixes

| Symptom | Fix |
|---|---|
| Login returns 401 immediately | Frontend `VITE_API_BASE_URL` does not match backend URL. Check it includes `/api`. |
| Login works but every other request 401s | Backend's `SUPABASE_SERVICE_KEY` is wrong. The token validation uses it. |
| `/api/super-admin/phones` returns 500 | `09_rbac.sql` migration not applied. Re-run via `npm run db:apply` (needs `SUPABASE_ACCESS_TOKEN` env). |
| CORS error in browser console | Set `FRONTEND_URL` env on backend exactly to the static site's URL (no trailing slash). |
| FCM push not arriving on a phone | Check backend logs — `[fcm:noop]` means `FCM_SERVICE_ACCOUNT_JSON` wasn't pasted. `[fcm] send failed 404 …UNREGISTERED` means the phone's FCM token expired (re-enroll). |
| Auto-lock cron not firing at 09:30 | UptimeRobot not set up; backend slept through 09:30. Confirm UptimeRobot is pinging. |
| Render build fails: "Cannot find module …" | First deploy missed a dep. Trigger a manual redeploy. |

---

## Going beyond free

When you outgrow free:

1. **Backend → Starter ($7/mo):** no cold start ever, no UptimeRobot needed,
   2x more CPU/RAM. Worth it once you cross ~200 enrolled phones.
2. **Custom domain:** Render gives free HTTPS for any domain you point at it.
   Buy a domain ($10/yr) → add CNAME → done.
3. **Database upgrade:** Supabase free tier has 500 MB storage + 8 GB egress.
   You'll likely hit the egress limit before the storage limit because phones
   pull product images. Upgrade Supabase to Pro ($25/mo) only when needed.

---

## File reference

| File | Purpose |
|---|---|
| `/render.yaml` | The Blueprint Render reads on first deploy |
| `/frontend/public/_redirects` | SPA routing for the static site |
| `/backend/src/server.js` | Health endpoint at `/api/health` (used by UptimeRobot) |
| `/backend/firebase-service-account.json` | Local dev only — pasted into env var for production |
| `/docs/SUPER_ADMIN_DELIVERY.md` | What the system does + credentials |
| `/docs/DEVICE_LOCK_DELIVERY.md` | How the phone lock side works |
