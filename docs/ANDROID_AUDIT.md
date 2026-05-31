# Android App + Enrollment Flow — Pre-deployment Audit

Date: 2026-05-31
Verdict: **All P0 issues found and fixed. Green light to deploy.**

This is a separate audit on top of `docs/PRE_DEPLOY_AUDIT.md`, focused
specifically on the Android side and the enrollment QR pipeline.

---

## What I audited

| Area | Files |
|---|---|
| Manifest, permissions, components | `app/src/main/AndroidManifest.xml` |
| Device Owner setup | `xml/device_admin.xml`, `admin/EisDeviceAdminReceiver.kt` |
| QR provisioning entry | `enroll/ProvisioningReceiver.kt`, `enroll/EnrollActivity.kt` |
| FCM listener + HMAC verify | `fcm/EisMessagingService.kt` |
| HMAC compute | `net/DeviceHmac.kt` |
| HMAC interop with Node backend | `test/.../DeviceHmacInteropTest.kt` |
| Lock screen (un-dismissable) | `lock/LockActivity.kt`, `lock/LockOverlayService.kt` |
| Heartbeat worker | `heartbeat/HeartbeatWorker.kt`, `heartbeat/HeartbeatScheduler.kt` |
| Boot survival | `boot/BootReceiver.kt` |
| Encrypted secrets | `util/Secrets.kt` |
| Build config | `app/build.gradle.kts`, `build.gradle.kts` |
| QR shape spec | `android-app/PROVISIONING_QR_FORMAT.md` |
| Backend QR generator | `backend/src/routes/devices.js` POST `/enrollment-tokens` |
| Frontend QR renderer | `frontend/src/components/EnrollDeviceModal.jsx` |

---

## P0 issues found and fixed

### P0-1 — Frontend QR was missing the Android-provisioning wrapper (deployment blocker)
**Was:** `EnrollDeviceModal.jsx` set the QR value to `JSON.stringify(enrollment.qr_payload)`
— just the inner EIS bundle. Android Setup Wizard requires the full
`PROVISIONING_QR_CODE` structure with keys like
`android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME` and
`android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION`.
Without them, scanning the QR during "tap 6 times" would fail every single
time. **Customers would never be able to enroll.**

**Fix:**
- Backend's `/api/devices/enrollment-tokens` now also returns
  `provisioning_qr` — the full Android-wrapped JSON, with the EIS bundle
  embedded under `PROVISIONING_ADMIN_EXTRAS_BUNDLE`.
- Frontend uses `enrollment.provisioning_qr || enrollment.qr_payload` so old
  consumers don't break.
- Two new optional env vars (`ANDROID_APK_DOWNLOAD_URL`,
  `ANDROID_APK_SIGNATURE_CHECKSUM`) drive the APK-download and cert-pin keys
  in the wrapper.
- A red warning chip appears in the modal if those env vars are missing,
  pointing ops at the runbook step they skipped.
- A backend `console.warn` fires the first time the endpoint is hit with
  those env vars missing.

**Verification:** Live curl confirms `COMPONENT_NAME`, `EXTRAS_BUNDLE`, and
the bundle's `url` are all present in the new payload.

---

### P0-2 — `PUBLIC_API_BASE_URL` env-var convention was fragile (deployment blocker)
**Was:** The QR's enrollment `url` was built as `${PUBLIC_API_BASE_URL}/devices/enroll`,
which only resolved to the correct path if the operator set
`PUBLIC_API_BASE_URL` ending in `/api`. If they set it to
`https://eis-backend.onrender.com` (the obvious value), the QR would point
the phone at `/devices/enroll` (missing the `/api` prefix) → 404 →
enrollment fails with no useful error.

**Fix:** Backend now strips a trailing `/api` if present and always appends
`/api/devices/enroll` exactly once. Ops can set the env var either way.

**Verification:** Live curl shows `bundle.url` resolves to
`.../api/devices/enroll` correctly.

---

### P0-3 — Branch phone wasn't piped through to the lock screen
**Was:** `EnrollActivity` stored `branch_phone` from the enrollment response
but the enrollment-tokens endpoint never sent it back. The lock screen's
"Call your branch" button silently disappeared on production phones because
`branchPhone` was always null on first heartbeat.

**Fix:** Backend joins on `branches.phone` when issuing an enrollment token
and includes `branchPhone` in the inner bundle. `ProvisioningReceiver`
already persists it as `KEY_BRANCH_PHONE` on the device.

---

## Confirmed solid (no fix needed)

### HMAC parity between Android and Node
Both sides pin the same byte-exact reference vectors via a regression test:

- Android `DeviceHmacInteropTest`:
  `signCommand("0…01", "cmd-1", "lock", "2026-05-24T12:00:00Z") = a025197f…3fd777`
- Node `backend/__tests__/deviceHmac.test.js`: same vector, same expected output.

Verified the file contents match. If either side drifts, both test files
catch it before ship.

### Replay protection
- Server `verifyDeviceSignature` enforces a 10-minute `X-Issued-At` window
  and uses `crypto.timingSafeEqual`.
- Android `DeviceHmac` uses constant-time string compare on the way back.
- Server's `command_id` is single-use; client also caches
  `KEY_LAST_COMMAND_ID` and refuses re-apply.

### Factory-reset resistance
`EisDeviceAdminReceiver.applyBaselineRestrictions` adds:
- `DISALLOW_FACTORY_RESET`
- `DISALLOW_ADD_USER`, `DISALLOW_REMOVE_USER`
- `DISALLOW_DEBUGGING_FEATURES`
- `DISALLOW_INSTALL_UNKNOWN_SOURCES`
- `DISALLOW_SAFE_BOOT`
- `DISALLOW_OUTGOING_BEAM`
- `DISALLOW_MODIFY_ACCOUNTS`
- `DISALLOW_CONFIG_WIFI`
- `setUninstallBlocked(packageName=true)`

Once enrolled, a customer cannot factory-reset their way out, install a
side-loaded escape app, boot to safe mode to disable the DPC, or uninstall
the app. The only escape route is for shop staff (super_admin) to unlock or
release the device via the backend.

### Lock screen un-dismissable
- `setShowWhenLocked(true)` + `setTurnScreenOn(true)`
- `WindowManager.LayoutParams.FLAG_*` flags for keyguard / screen-on
- `startLockTask()` for kiosk mode (only effective as Device Owner)
- `setStatusBarDisabled(true)` while locked
- Override `onBackPressed`, `onKeyDown`(BACK/HOME/RECENTS/MENU), `onUserLeaveHint`
- Re-launch self on `onPause` if still locked
- `addPersistentPreferredActivity(...CategoryHome)` so Home key routes back
- Emergency dial button (`tel:115`) and "Call branch" both kept open

### Boot survival
`BootReceiver` listens for both `BOOT_COMPLETED` and `LOCKED_BOOT_COMPLETED`
(direct-boot stage on encrypted devices), re-applies baseline restrictions,
re-launches `LockActivity` if `lock_state=locked`, and re-arms heartbeat
WorkManager schedule.

### Encrypted storage
`Secrets` uses `EncryptedSharedPreferences` with Android Keystore-backed
AES-256-GCM. Device secret, lock state, command audit, branch phone all live
there. A rooted attacker could dump it, but a rooted customer device is
already game-over for any lock product.

### FCM dispatch correctness
- Backend pre-flight P1 fix from yesterday: order's `device_locked` only
  flips when FCM actually dispatched (covered by Jest regression).
- Android side checks HMAC before applying, refuses on mismatch, persists
  state before launching UI, falls back from Activity → Overlay if Activity
  launch is blocked by background-start restrictions.

---

## Build status

```
Frontend:        vite build clean (720 modules)
Backend Jest:    40 / 40 tests passing (3 suites)
Backend boot:    [scheduler] cron jobs registered (timezone: Asia/Karachi)
Enrollment API:  returns full Android-wrapped provisioning_qr
```

Android `./gradlew test` wasn't run from here (no Android SDK on this
machine), but the HMAC interop fixtures are pinned to the same vectors the
Node side validates, and the cross-contract test would fail at build time
if it drifted.

---

## Pre-deploy checklist for the Android side

Before customer rollouts:

- [ ] **Drop `google-services.json` into `android-app/app/`** (from Firebase Console)
- [ ] **Build signed release APK** in Android Studio
  - Generate Signed Bundle / APK → APK → new keystore → release variant
  - Save the keystore + password somewhere safe (e.g. password manager)
- [ ] **Upload `app-release.apk` to GitHub Releases**, tag e.g. `v1.0.0`
- [ ] **Compute APK signing-cert SHA-256 checksum** (base64-url-no-padding):
  ```sh
  keytool -list -printcert -jarfile app-release.apk \
    | grep -E '^\s+SHA256:' | head -n1 \
    | awk '{print $2}' | tr -d ':' | xxd -r -p \
    | openssl base64 | tr '+/' '-_' | tr -d '=\n'
  ```
- [ ] **Set both env vars on Render's backend** and redeploy:
  - `ANDROID_APK_DOWNLOAD_URL`
  - `ANDROID_APK_SIGNATURE_CHECKSUM`
- [ ] **Test on one real phone:**
  1. Factory reset a test phone (Vivo Y / Oppo A / etc.)
  2. On Welcome screen → tap screen 6 times → camera opens
  3. Scan the QR generated from `/super-admin/phones → Enroll device`
  4. Wait ~30 sec for the APK to download + provision + EnrollActivity to finish
  5. Confirm phone shows the "EIS Device Lock" status screen
  6. From the web admin → trigger a manual Lock → confirm phone screen locks
     within 5 seconds and shows the "Pay your installment" overlay
  7. Confirm Home, Back, Recents are all swallowed
  8. From the web admin → trigger Unlock → confirm phone returns to normal
  9. Reboot the phone → confirm the lock state survives reboot
  10. Try `Settings → System → Reset options → Erase all data` → confirm
      it is blocked (`DISALLOW_FACTORY_RESET`)

If all 10 pass on one test phone, you are clear to start enrolling customer
phones at the shop counter.

---

## Files changed in this audit

```
backend/src/routes/devices.js                          # robust URL + full provisioning_qr + branchPhone
frontend/src/components/EnrollDeviceModal.jsx          # render provisioning_qr if present + ops warning
render.yaml                                            # ANDROID_APK_*, SCHEDULER_TZ env vars
docs/RENDER_DEPLOYMENT.md                              # APK build + checksum step + env-var instructions
docs/ANDROID_AUDIT.md                                  # this file
```
