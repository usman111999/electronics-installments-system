# EIS Device Lock — Android client

Customer-facing Android application that runs as a **Device Owner** on
phones financed via the Electronics Instalments System (EIS). It enforces
lock/unlock commands issued from the operator web UI, reports periodic
heartbeats with GPS location, battery and SIM ICCID, and survives reboot.

The wire protocol is defined in
[`../docs/DEVICE_LOCK_PROTOCOL.md`](../docs/DEVICE_LOCK_PROTOCOL.md) — this
app implements it; the backend in `../backend/` consumes it.

---

## 1. Prerequisites

- Android Studio Hedgehog (2023.1) or later
- JDK 17 (Android Studio bundles one)
- A Firebase project with **Cloud Messaging** enabled
- Backend reachable over HTTPS (or `http://10.0.2.2` for emulator)

## 2. Firebase setup

1. Open <https://console.firebase.google.com> → create or reuse a project.
2. Add an Android app with the exact package name `com.eis.devicelock`.
3. Download `google-services.json` and put it at `app/google-services.json`.
   A stub `app/google-services.json.example` is checked in so you can see
   the shape the file should have.
4. From **Project settings → Cloud Messaging** copy the *server key* into
   the backend's `FCM_SERVER_KEY` env var (or use the newer V1 service
   account JSON — see backend docs).

## 3. Build

```sh
cd android-app
./gradlew assembleRelease        # produces app/build/outputs/apk/release/app-release.apk
./gradlew test                   # JVM unit tests
```

To sign the APK for production, configure a `keystore.properties` file
(not checked in) with `storeFile`, `storePassword`, `keyAlias`,
`keyPassword`, then add a `signingConfigs` block to `app/build.gradle.kts`.

## 4. Host the APK

The Android Device-Owner provisioning flow downloads the APK over HTTP(S)
during the QR-scan step. Host the signed APK somewhere reachable by the
customer's phone — e.g. on the backend server itself at
`https://your-backend.example/static/EisDeviceLock.apk`.

You also need the SHA-256 checksum (Base64-URL-safe, no padding) of the
APK; the operator web UI embeds it in the QR code so Android verifies the
binary before installing it. Compute it with:

```sh
openssl dgst -binary -sha256 app-release.apk | openssl base64 | tr '+/' '-_' | tr -d '='
```

## 5. Provisioning at the shop counter

1. **Factory-reset the phone** (Settings → Reset, or via recovery).
2. On the Welcome / "Hi there" screen, **6-tap an empty area** until the
   QR-scanner opens.
3. Operator clicks **"Enroll device"** on the order page in the web UI;
   the screen shows a QR.
4. Phone scans the QR. Android downloads the APK, installs it as Device
   Owner, then triggers `ACTION_PROVISIONING_SUCCESSFUL` → our
   `ProvisioningReceiver` runs.
5. `EnrollActivity` calls `POST /api/devices/enroll`, persists `device_id`
   + `device_secret`, applies baseline restrictions, schedules heartbeats,
   then shows the customer-facing status screen.

End-to-end this takes roughly 3-5 minutes once the phone is on Wi-Fi.

## 6. Testing in an emulator

Real DPC provisioning needs a fresh device. For development you can promote
the app to Device Owner via `adb`:

```sh
# Boot a fresh AVD with no Google account configured.
adb install app-debug.apk
adb shell dpm set-device-owner com.eis.devicelock/.admin.EisDeviceAdminReceiver
```

If you see `java.lang.IllegalStateException: Not allowed to set the device
owner because there are already several users on the device`, the AVD has
been signed into a Google account — start a fresh one without sign-in.

Once Device Owner, manually launch `EnrollActivity` with the provisioning
extras to simulate a real QR scan:

```sh
adb shell am start \
  -a com.eis.devicelock.ENROLL \
  -n com.eis.devicelock/.enroll.EnrollActivity
```

…having first pushed the four secrets into EncryptedSharedPreferences via
the operator backend (or via a debug helper Activity).

## 7. Known limitations

- **Custom firmware flashing**: A user with PC tools (Odin / Mi-Flash /
  fastboot) can flash a stock ROM and erase the Device Owner state. The
  protocol detects this as "lost contact >14 days" — see spec section 11.
- **Battery-saver OEMs**: On Xiaomi/Vivo/Oppo ROMs, the heartbeat worker
  can be killed by aggressive battery savers. We mitigate by setting
  ourselves as Device Owner (which exempts us from most savers) but you
  may still need to whitelist EisDeviceLock in the OEM's "Background
  apps" list as a setup step.
- **SYSTEM_ALERT_WINDOW**: Android 12+ restricts overlay permission for
  newly-installed apps. We grant it to ourselves via `setPermissionGrantState`
  at enrollment, but a small set of OEMs still refuse. In that case
  `LockActivity` alone is enough — the overlay is a fallback.
- **IMEI on dual-SIM devices**: The IMEI we read on enrollment is the
  slot-0 IMEI. Both SIM-tray events are still observed by `SimChangeReceiver`.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `BIND_DEVICE_ADMIN required` on boot | Manifest receiver missing permission | Confirm `EisDeviceAdminReceiver` declares `android:permission="android.permission.BIND_DEVICE_ADMIN"` |
| Heartbeat never fires | App not yet enrolled, no `device_id` stored | Re-scan the QR; check logcat for `Heartbeat skipped — not enrolled` |
| Lock screen flashes then disappears | Not Device Owner, `setLockTaskPackages` failed | Verify `dpm get-device-owner` (adb) returns our package |
| FCM message ignored | HMAC mismatch — backend secret out of sync | Compare `device_secret` row in `devices` table with stored secret on phone |

## 9. License

Internal product, no public license.
