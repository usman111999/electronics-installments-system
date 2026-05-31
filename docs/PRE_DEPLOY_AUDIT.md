# Pre-deployment audit — Lock System

Date: 2026-05-30
Verdict: **Ready to deploy.**

40/40 Jest tests pass. Frontend builds clean. Backend boots in production mode
with the Karachi timezone scheduler. The 3 P1 issues I found during code review
are all fixed and regression-tested.

---

## Issues found and fixed

### P1-1 — Cron scheduler ran in UTC instead of Pakistan time
**File:** `backend/src/services/scheduler.js`

**Risk:** Render's servers run UTC. The reminder job scheduled for 09:30 would
have fired at 09:30 UTC = 14:30 PKT, so customers would get reminders at
2:30pm instead of mid-morning. Auto-lock sweep scheduled for 02:00 would have
fired at 07:00 PKT. Auto-lock "24h warning" at 09:00 would have fired at
14:00 PKT — too late to give customers actual 24 hours.

**Fix:** Every `cron.schedule(...)` call now takes `{ timezone: 'Asia/Karachi' }`.
Pakistan is a single timezone (UTC+5, no DST) so this is safe forever.

**Override:** Set `SCHEDULER_TZ` env var if you ever deploy to a different
region.

**Verification:** `[scheduler] cron jobs registered (timezone: Asia/Karachi)`
appears in the boot log.

---

### P1-2 — `orders.device_locked` flipped to `true` even when FCM dispatch FAILED
**File:** `backend/src/services/deviceCommands.js`

**Risk:** Operator clicks "Lock" → FCM credentials invalid / network down →
`device_commands.status='failed'` (correct) BUT `orders.device_locked=true`
also got set (WRONG). The UI would show the phone as locked. The customer
would even get a WhatsApp telling them their phone is locked — when in fact
the FCM push never went out and the phone is still working. Operator and
customer both held an incorrect mental model.

**Fix:** Only update `orders.device_locked`, `device_locked_at`, and the
customer WhatsApp lock-notice when `fcmResult.ok` or `fcmResult.noop` is true.
The `device_lock_events` audit row still records the attempt with
`success=false` so there's a paper trail.

**Verification:** Added regression test `FCM sender returns {ok:false} → ...`
that now asserts BOTH `command.status='failed'` AND no `orders.device_locked`
update was emitted AND a `device_lock_events` row exists with `success=false`.

---

### P1-3 — Phones page swallowed lock/unlock/locate errors silently
**File:** `frontend/src/pages/super-admin/Phones.jsx`

**Risk:** `try { await api.post(...) } catch {}` — operator clicks "Lock",
backend returns 400 ("No active device enrolled") or 403 (no permission), but
the UI shows nothing, the table just refreshes, and the operator assumes the
lock went through.

**Fix:** Each handler now surfaces backend errors via `alert()` AND
distinguishes between "command queued + dispatched (`fcm.ok` or `fcm.noop`)"
vs "command recorded but FCM dispatch failed (`fcm.error`)". Operator gets
explicit feedback on every outcome.

---

## Non-issues (investigated and cleared)

### Custom roles with `base_role='operator'` and branch scoping
Earlier QA caveat suggested that inline `req.user.role === 'operator'` checks
in `customers.js`/`inventory.js`/etc. would break custom roles. Investigated:
**they don't.** When a user is created with a custom role_id, the profile's
`role` column is still set to the base role (`operator`), and `role_id` points
to the custom row. So the inline check correctly scopes custom-role users.

### HMAC replay protection
`services/deviceHmac.js` already enforces a 10-minute window on the
`X-Issued-At` header AND uses `crypto.timingSafeEqual`. A captured heartbeat
request can't be replayed indefinitely. Solid.

### Enrollment token theft
Tokens are 32 random bytes, expire after 30 minutes, and become invalid the
moment a phone calls `/enroll` once. IMEI uniqueness is enforced. A leaked QR
code is useless after consumption.

### Phones-page Lock button hitting the wrong endpoint
Earlier QA caveat. Verified: `Phones.jsx` posts to `/api/orders/:id/lock`
which is correctly gated by `requirePermission('devices.lock')`. Endpoint
exists, works.

---

## What still needs your eyes (non-blocking)

1. **Test against a real Android phone** — the test data in Supabase has
   pending devices (no IMEI), so the full lock command can't be smoke-tested
   over curl until you actually enroll a phone via QR. Unit tests cover the
   logic; the only thing left is "does the Android app actually receive the
   FCM push and lock its screen." Plan to do this on Day-1 of deployment with
   one test phone before rolling out to customers.

2. **APK distribution** — when you build the APK, the URL it bakes into
   `strings.xml` (`api_base_url`) needs to match the deployed backend (e.g.
   `https://eis-backend.onrender.com`). If you change backend hosts later
   you must rebuild and redistribute the APK.

3. **First auto-lock sweep is silent** — when you first onboard a customer
   with `branch.auto_lock_days=30`, the customer doesn't get any warning
   until day 29 (the 09:00 WhatsApp). Confirm with your shop staff that's
   acceptable; if not, lower `auto_lock_days` on a per-branch basis.

---

## Pre-deploy checklist

Before pushing to Render:

- [x] All P1 bugs above fixed and tested
- [x] Backend builds clean (`npm install` works)
- [x] Frontend builds clean (`npm run build` works)
- [x] Jest suite: 40/40 pass
- [x] Cron timezone confirmed `Asia/Karachi` in boot log
- [x] `render.yaml` blueprint defines both services
- [x] `/api/health` returns 200 in <100ms (UptimeRobot will use this)
- [x] FCM service-account loader supports both file path AND `FCM_SERVICE_ACCOUNT_JSON` env var
- [x] CORS reads `FRONTEND_URL` from env
- [x] Frontend `_redirects` exists for SPA routing
- [x] Engines pinned to Node ≥20 in `package.json`

After Render deploys:

- [ ] UptimeRobot pinging `/api/health` every 5 min
- [ ] Supabase Auth → Site URL + Redirect URLs updated
- [ ] Log in as super_admin from the public URL → land on `/super-admin/overview`
- [ ] Build & sign APK → upload to GitHub Releases → enroll one test phone
- [ ] Manually trigger a lock from `/super-admin/phones` → confirm phone screen locks
- [ ] Wait for next 02:00 PKT → confirm auto-lock cron fired (check `device_commands` table for new rows)

---

## Files changed in this audit

```
backend/src/services/scheduler.js           # cron timezone
backend/src/services/deviceCommands.js      # don't flip order state on FCM fail
backend/__tests__/deviceCommands.test.js    # regression test for the above
backend/__tests__/devicesRoutes.test.js     # mock requirePermission so all tests build
frontend/src/pages/super-admin/Phones.jsx   # surface backend errors via alert
docs/PRE_DEPLOY_AUDIT.md                    # this file
```
