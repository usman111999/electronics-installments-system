# Provisioning QR payload format

The operator web UI generates a QR code that the customer's phone scans
during the Android Setup Wizard (6-tap → camera). The QR's binary content
is JSON, encoded directly as text (no base64).

## Wire shape

The QR encodes a **`PROVISIONING_QR_CODE`** payload as specified by
Android. The relevant keys are:

```json
{
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME":
      "com.eis.devicelock/.admin.EisDeviceAdminReceiver",

  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION":
      "https://backend.example.com/static/EisDeviceLock.apk",

  "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM":
      "<base64-url-no-padding sha256 of the APK signing cert>",

  "android.app.extra.PROVISIONING_WIFI_SSID": "ShopWiFi",
  "android.app.extra.PROVISIONING_WIFI_PASSWORD": "shop1234",
  "android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE": "WPA",

  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
    "v": 1,
    "url": "https://backend.example.com/api/devices/enroll",
    "token": "9f5a8b7c…",          // 32-byte hex enrollment_token
    "secret": "d1e2f3a4…",         // 32-byte hex device_secret
    "branch": "BR-LHR-01",
    "order": "ORD-2026-000123",
    "branchPhone": "+923001234567"
  }
}
```

The custom EIS keys live inside `PROVISIONING_ADMIN_EXTRAS_BUNDLE`:

| Key | Type | Required | Notes |
|---|---|---|---|
| `v` | int | yes | Version of this schema. Currently `1`. |
| `url` | string | yes | Full URL of the enrollment endpoint (e.g. `https://host/api/devices/enroll`). Host is derived from this for heartbeat too. |
| `token` | hex string | yes | Single-use enrollment_token. 30-minute TTL on the server side. |
| `secret` | hex string | yes | Pre-computed device_secret. Stored encrypted on the phone, used for HMAC signing of every device→server request and verification of every server→device command. |
| `branch` | string | yes | Branch identifier shown on the status screen. |
| `order` | string | no | Order identifier this device is bound to. Used only for the audit trail on the server. |
| `branchPhone` | E.164 string | no | Number shown on the lock screen so the customer can call for help. |

## Wi-Fi

The three `PROVISIONING_WIFI_*` keys are optional. If you include them,
the phone joins the shop's Wi-Fi automatically before downloading the APK
— much faster than waiting for the customer to pick a Wi-Fi network
during setup. Use a shop-only SSID that you can rotate periodically.

## Checksum

`PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM` must be the SHA-256 of the
APK's signing certificate, encoded as Base64 URL-safe **without padding**.

Compute it at release time:

```sh
keytool -list -printcert -jarfile EisDeviceLock.apk \
  | grep -E '^\s+SHA256:' | head -n1 \
  | awk '{print $2}' | tr -d ':' | xxd -r -p \
  | openssl base64 | tr '+/' '-_' | tr -d '=\n'
```

The backend stores this checksum in config and emits it in every QR so
the provisioning verifier doesn't reject the install.

## Example end-to-end

The backend's `POST /api/devices/enrollment-tokens` returns a JSON like:

```json
{
  "qr": {
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME":
        "com.eis.devicelock/.admin.EisDeviceAdminReceiver",
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION":
        "https://backend.example.com/static/EisDeviceLock.apk",
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM":
        "g8m…",
    "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
      "v": 1,
      "url": "https://backend.example.com/api/devices/enroll",
      "token": "9f5a8b7c8d6e4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a",
      "secret": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
      "branch": "BR-LHR-01",
      "order": "ORD-2026-000123",
      "branchPhone": "+923001234567"
    }
  },
  "ttl_seconds": 1800
}
```

The web UI feeds `qr` into a QR encoder (e.g. `qrcode-terminal` or
`qrcode.react`) using `JSON.stringify(qr)` as the source. The encoded
text is what the phone scans.
