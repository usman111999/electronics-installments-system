# How to get the live URL you can test

End state after these 4 steps: you open a URL in any browser, log in as
super_admin, scan a QR with a real Android phone, lock + unlock it from the
dashboard. Total time: **~45 min**, almost entirely waiting for builds.

---

## Step 1 — Deploy backend + frontend (Render Blueprint) · ~15 min

Render's Blueprint flow can't be fully automated because the GitHub OAuth
step is browser-only. You only do this once.

1. https://render.com → **Get Started for Free** → **Continue with GitHub** →
   approve Render's access to `usman111999/electronics-installments-system`.
2. Dashboard → **New +** → **Blueprint** → select the repo →
   **Apply Blueprint**. Render parses `render.yaml` and shows an env-var form.
3. Paste the following:

| Service | Key | Value |
|---|---|---|
| eis-backend | `SUPABASE_URL` | `https://koldxkjvbifsszuhjrll.supabase.co` |
| eis-backend | `SUPABASE_ANON_KEY` | the anon JWT from your local `backend/.env` |
| eis-backend | `SUPABASE_SERVICE_KEY` | the service_role JWT from your local `backend/.env` |
| eis-backend | `FCM_SERVICE_ACCOUNT_JSON` | the entire JSON contents of your local `backend/firebase-service-account.json` |
| eis-backend | `PUBLIC_API_BASE_URL` | leave blank — fill in step 4 below |
| eis-backend | `FRONTEND_URL` | leave blank — fill in step 4 below |
| eis-backend | `ANDROID_APK_DOWNLOAD_URL` | leave blank for now (we'll set this in step 3) |
| eis-backend | `ANDROID_APK_SIGNATURE_CHECKSUM` | leave blank for now |
| eis-frontend | `VITE_SUPABASE_URL` | same as backend's `SUPABASE_URL` |
| eis-frontend | `VITE_SUPABASE_ANON_KEY` | same as backend's anon JWT |
| eis-frontend | `VITE_API_BASE_URL` | leave blank — fill in step 4 |

4. Apply → Render builds both. Once both show "Live", **note their URLs**, e.g.:
   - Backend:  `https://eis-backend.onrender.com`
   - Frontend: `https://eis-frontend.onrender.com`

   Go back into each service's Environment tab and fill in the URLs you left blank:
   - Backend `PUBLIC_API_BASE_URL` = backend URL
   - Backend `FRONTEND_URL`         = frontend URL
   - Frontend `VITE_API_BASE_URL`   = backend URL + `/api`

   Save each → auto-redeploys.

5. Supabase Dashboard → Authentication → URL Configuration → set
   **Site URL** + add to **Redirect URLs**: `https://eis-frontend.onrender.com`

You can now log in at the frontend URL with `super@eis.local` / `Super@123456`
and use everything except phone lock/unlock (no APK yet).

---

## Step 2 — Set up UptimeRobot (free, keeps backend awake) · ~5 min

Without this the backend sleeps after 15 min idle and `node-cron` jobs
(auto-lock, WhatsApp reminders) silently stop firing.

1. https://uptimerobot.com → register → **+ New Monitor**
2. Type **HTTP(s)**, URL `https://eis-backend.onrender.com/api/health`,
   interval **5 minutes**, timeout 30s.
3. Save. Done.

---

## Step 3 — Get the APK built · ~10 min, mostly waiting

The GitHub Actions workflow `.github/workflows/android-build.yml` builds
the APK on every push to `android-app/`. You only need to add **one** secret.

### One-time secret setup

1. Download `google-services.json` from Firebase Console:
   - https://console.firebase.google.com → your `electronics-installments` project
   - ⚙ → **Project settings** → **Your apps** → "Add app" → Android
   - Package name: `com.eis.devicelock`  · App nickname: `EIS Device Lock`
   - Skip the SHA-1 (not needed for FCM)
   - Click **Register app** → **Download google-services.json**

2. Base64-encode it on your Mac:
   ```sh
   base64 -i ~/Downloads/google-services.json | pbcopy
   ```
   The contents are now in your clipboard.

3. https://github.com/usman111999/electronics-installments-system/settings/secrets/actions
   → **New repository secret**
   - Name: `GOOGLE_SERVICES_JSON`
   - Value: paste (Cmd+V)
   - Save

### Trigger the build

Either: push any small change to `android-app/` (e.g. edit a comment), OR:
- https://github.com/usman111999/electronics-installments-system/actions
- Pick **Build Android APK** → **Run workflow** → **main** → Run

Wait ~5 min for the build to finish. Click the run → scroll to **Artifacts**
→ download `eis-device-lock-debug-<sha>.zip` → unzip → `app-debug.apk`.

That's the APK you can sideload on a test phone via `adb install app-debug.apk`
or by hosting and downloading directly.

**For Setup-Wizard QR provisioning (which auto-installs on factory reset)
you need a SIGNED RELEASE APK, not the debug build.** See "Optional — signed
release APK" at the bottom of this doc.

---

## Step 4 — Test the system end-to-end · ~10 min

With backend deployed (Step 1), keep-alive active (Step 2), and debug APK
ready (Step 3):

1. Take a spare Android test phone, factory reset it.
2. `adb install app-debug.apk` (or download the APK on the phone)
3. Manually launch the app — it'll show the status screen.
4. From your Render frontend: log in as super_admin → go to **Orders** →
   pick an order → **Enroll device** → modal shows the QR.
5. On the phone, in the app, you can build a "scan QR" path… or for a
   debug build, the simplest is to manually call the enrollment endpoint
   from the phone (the debug APK supports both paths).
6. Once enrolled, go to **Super Admin → Phones** → click **Lock** on the row.
   Phone should lock within 5 seconds.
7. Click **Unlock** → phone returns to normal.
8. Reboot phone → it stays in whatever lock state it was in.

If all of that works, **the system is fully validated**.

---

## Optional — signed release APK (needed for QR provisioning at customer's Setup Wizard)

The "tap 6 times on Welcome screen" provisioning path verifies the APK's
signing cert against the checksum embedded in the QR. Debug-signed APKs
won't pass that check — you need a release build signed with your own
keystore.

### Generate a keystore (one time, on your Mac)
```sh
keytool -genkeypair -v -keystore eis-release.keystore \
  -alias eis -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass <STRONG_PASSWORD> -keypass <STRONG_PASSWORD> \
  -dname "CN=EIS Device Lock, OU=Sales, O=Your Shop, C=PK"
```
**Save the keystore + passwords somewhere safe.** Losing them means losing
the ability to push updates to existing installs.

### Add 4 more GitHub secrets
```sh
base64 -i eis-release.keystore | pbcopy
```
Then at https://github.com/usman111999/electronics-installments-system/settings/secrets/actions:
- `ANDROID_KEYSTORE_BASE64` = (paste)
- `ANDROID_KEYSTORE_PASSWORD` = your password
- `ANDROID_KEY_ALIAS` = `eis`
- `ANDROID_KEY_PASSWORD` = your password

### Tag a release
```sh
cd /Users/usman/Desktop/electronics\ instalments\ system
git tag v1.0.0
git -c user.email="u.devtime@gmail.com" -c user.name="usman111999" push origin v1.0.0
```
The workflow now also produces `app-release.apk`, attaches it to a GitHub
Release at https://github.com/usman111999/electronics-installments-system/releases,
and prints the signing-cert checksum in the run output.

### Wire the URL + checksum into the backend
1. Copy the release APK's download URL (right-click "Save link as" on the
   asset in the Release page).
2. Copy the checksum printed in the workflow log (or from the Release body
   the workflow auto-fills).
3. Render → eis-backend → Environment:
   - `ANDROID_APK_DOWNLOAD_URL`       = APK URL from step 1
   - `ANDROID_APK_SIGNATURE_CHECKSUM` = checksum from step 2
   - Save → redeploys
4. Now the QR codes generated from `/super-admin/phones → Enroll device`
   include the full Android Setup-Wizard provisioning payload, so a factory
   reset phone scanning the QR at the "tap 6 times" screen will download
   and install the signed APK automatically.

---

## TL;DR

| You need to do | Required? | Time |
|---|---|---|
| Render Blueprint deploy (Step 1) | ✅ Yes | 15 min |
| UptimeRobot keep-alive (Step 2) | ✅ Yes (otherwise cron breaks) | 5 min |
| `GOOGLE_SERVICES_JSON` GitHub secret + workflow trigger (Step 3) | ✅ Yes (for any phone testing) | 10 min |
| End-to-end phone test (Step 4) | ✅ Yes (to validate) | 10 min |
| Release keystore + signed APK (Optional) | Only if you want QR-provisioning to install the APK during Android Setup Wizard | 15 min |

What I CAN'T do for you:
- The Render → GitHub OAuth click (browser-only, your account)
- The Firebase Console → Add Android app step (interactive, your account)
- Generating the release keystore (you should own the private key)
