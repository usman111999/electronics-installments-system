// Device enrollment, heartbeat, status, locations + auto-lock sweep endpoints.
// Spec: docs/DEVICE_LOCK_PROTOCOL.md sections 3, 5, 7, 8.

const express = require('express');
const crypto = require('crypto');
const dayjs = require('dayjs');
const rateLimit = require('express-rate-limit');

const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch } = require('../middleware/auth');
const { verifyDeviceSignature } = require('../services/deviceHmac');
const { issueCommand } = require('../services/deviceCommands');
const { sendWhatsApp } = require('../services/whatsapp');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

// Per-device rate limit on the heartbeat endpoint (spec §10: 60/min/device).
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^HMAC\s+([^:]+):/);
    return m ? m[1] : (req.ip || 'unknown');
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// Enrollment: operator clicks "Enroll device" → server mints a token + secret,
// returns the QR payload from spec §3. Device row sits in 'pending' until the
// phone calls /enroll with the token.
// ---------------------------------------------------------------------------
router.post('/enrollment-tokens', authenticate, requirePermission('devices.enroll'), async (req, res) => {
  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders').select('id, branch_id, customer_id, order_no').eq('id', order_id).single();
  if (orderErr || !order) return res.status(404).json({ error: 'Order not found' });

  if (req.user.role === 'operator' && order.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Order is not in your branch' });
  }

  const enrollment_token = crypto.randomBytes(32).toString('hex');
  const device_secret = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { data: device, error: devErr } = await supabaseAdmin
    .from('devices')
    .insert({
      order_id: order.id,
      branch_id: order.branch_id,
      device_secret,
      enrollment_token,
      enrollment_token_expires_at: expires_at,
      status: 'pending',
    })
    .select()
    .single();
  if (devErr) return res.status(500).json({ error: devErr.message });

  // Robustly construct the API base. PUBLIC_API_BASE_URL may or may not end
  // with /api — we normalise so the QR `url` always points at .../api/devices/enroll
  // exactly, regardless of how the operator filled in the env var. Defaulting
  // to req host is only useful in dev — production must set PUBLIC_API_BASE_URL.
  const rawBase = process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const baseNoSlash = rawBase.replace(/\/$/, '');
  // Strip a trailing /api so we can always append /api/devices/enroll once.
  const hostOnly = baseNoSlash.replace(/\/api$/, '');
  const enrollUrl = `${hostOnly}/api/devices/enroll`;

  // Branch phone is shown on the lock screen. Fetch it now so we can stash it
  // in the QR bundle and the device persists it during ProvisioningReceiver.
  let branchPhone = null;
  try {
    const { data: br } = await supabaseAdmin
      .from('branches').select('phone').eq('id', order.branch_id).maybeSingle();
    branchPhone = br?.phone || null;
  } catch { /* non-fatal */ }

  // Inner bundle — read by ProvisioningReceiver / EnrollActivity on the device.
  const qr_payload = {
    v: 1,
    url: enrollUrl,
    token: enrollment_token,
    secret: device_secret,
    branch: order.branch_id,
    order: order.id,
    branchPhone,
  };

  // Outer payload — what the Android Setup Wizard actually expects when the
  // operator scans the QR during the "tap 6 times" flow. Without these wrapper
  // keys the wizard cannot find the APK and Device Owner provisioning fails.
  // The two optional fields below come from build-time env vars set by ops
  // once the signed APK is uploaded to its public URL.
  const apkUrl = process.env.ANDROID_APK_DOWNLOAD_URL || null;
  const apkChecksum = process.env.ANDROID_APK_SIGNATURE_CHECKSUM || null;
  const provisioning_qr = {
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME':
      'com.eis.devicelock/.admin.EisDeviceAdminReceiver',
    ...(apkUrl ? { 'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': apkUrl } : {}),
    ...(apkChecksum ? { 'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': apkChecksum } : {}),
    'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': false,
    'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': qr_payload,
  };

  // If APK info isn't set, log a warning so ops sees it the first time the
  // endpoint is hit on a fresh deploy. The bundle still works for in-shop
  // pre-installed APKs (operator launches enrollment manually), so we don't
  // hard-fail.
  if (!apkUrl || !apkChecksum) {
    console.warn(
      '[devices] ANDROID_APK_DOWNLOAD_URL or ANDROID_APK_SIGNATURE_CHECKSUM not set — ' +
      'returned QR will only work for pre-installed APK flows. Set both env vars ' +
      'before customer-facing rollouts so Setup Wizard can install the APK from QR.',
    );
  }

  await logActivity({
    userId: req.user.id, branchId: order.branch_id,
    action: 'device_enrollment_token_issued',
    entityType: 'order', entityId: order.id,
    details: { device_id: device.id, expires_at, apk_url_present: !!apkUrl }, req,
  });

  res.status(201).json({
    device_id: device.id,
    token: enrollment_token,
    secret: device_secret,
    expires_at,
    qr_payload,         // inner bundle (legacy field, kept for back-compat)
    provisioning_qr,    // full Android Setup Wizard payload — use this for the QR
  });
});

// ---------------------------------------------------------------------------
// /enroll — UNAUTHENTICATED, gated by the one-time enrollment_token.
// Phone POSTs after scanning the QR.
// ---------------------------------------------------------------------------
router.post('/enroll', async (req, res) => {
  const { token, imei, fcm_token, device_model, android_version } = req.body || {};
  if (!token || !imei) return res.status(400).json({ error: 'token and imei required' });

  const { data: device, error } = await supabaseAdmin
    .from('devices').select('*').eq('enrollment_token', token).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!device) return res.status(404).json({ error: 'Invalid enrollment token' });
  if (device.status !== 'pending') return res.status(409).json({ error: 'Token already consumed' });
  if (device.enrollment_token_expires_at && new Date(device.enrollment_token_expires_at) < new Date()) {
    return res.status(410).json({ error: 'Enrollment token expired' });
  }

  // IMEI uniqueness — if another device row already claims this IMEI we
  // reject so the operator can investigate (could be a returned phone).
  const { data: dupe } = await supabaseAdmin
    .from('devices').select('id').eq('imei', imei).neq('id', device.id).maybeSingle();
  if (dupe) return res.status(409).json({ error: 'IMEI already enrolled on another order' });

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabaseAdmin
    .from('devices')
    .update({
      imei,
      fcm_token: fcm_token || null,
      device_model: device_model || null,
      android_version: android_version || null,
      status: 'active',
      last_seen_at: nowIso,
      enrollment_token: null,
      enrollment_token_expires_at: null,
      updated_at: nowIso,
    })
    .eq('id', device.id);
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Mirror IMEI back onto the order so the existing orders.device_imei field
  // stays the source of truth for the UI.
  if (device.order_id) {
    await supabaseAdmin.from('orders').update({ device_imei: imei }).eq('id', device.order_id);
  }

  await logActivity({
    branchId: device.branch_id,
    action: 'device_enrolled',
    entityType: 'device', entityId: device.id,
    details: { imei, device_model, android_version }, req,
  });

  res.json({ ok: true, device_id: device.id });
});

// ---------------------------------------------------------------------------
// /heartbeat — HMAC-signed, every ~30 minutes from the device.
// Authorization: HMAC <device_id>:<sig>
// X-Issued-At: <iso8601>
// ---------------------------------------------------------------------------
router.post(
  '/heartbeat',
  heartbeatLimiter,
  async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const m = authHeader.match(/^HMAC\s+([^:]+):(.+)$/);
      if (!m) return res.status(401).json({ error: 'Bad Authorization header' });
      const device_id = m[1];
      const sig = m[2];
      const issuedAt = req.headers['x-issued-at'];
      if (!issuedAt) return res.status(401).json({ error: 'Missing X-Issued-At' });

      // server.js installs a raw-body capture for this path before express.json
      const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';

      const { data: device, error: devErr } = await supabaseAdmin
        .from('devices').select('*').eq('id', device_id).maybeSingle();
      if (devErr) return res.status(500).json({ error: devErr.message });
      if (!device) return res.status(404).json({ error: 'Unknown device' });

      const ok = verifyDeviceSignature(device.device_secret, rawBody, issuedAt, sig);
      if (!ok) return res.status(401).json({ error: 'Bad signature' });

      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; }
      catch { return res.status(400).json({ error: 'Body must be valid JSON' }); }

      const nowIso = new Date().toISOString();
      const prevSim = device.current_sim_serial;
      const update = {
        last_seen_at: nowIso,
        status: 'active',
        updated_at: nowIso,
      };
      if (body.battery_pct != null) update.last_battery = Math.round(Number(body.battery_pct));
      if (body.network_type) update.last_network = body.network_type;
      if (body.sim_serial) update.current_sim_serial = body.sim_serial;
      if (body.fcm_token) update.fcm_token = body.fcm_token;
      if (body.imei && !device.imei) update.imei = body.imei;

      await supabaseAdmin.from('devices').update(update).eq('id', device.id);

      // Append location point if present
      if (body.lat != null && body.lon != null) {
        await supabaseAdmin.from('device_locations').insert({
          device_id: device.id,
          lat: body.lat,
          lon: body.lon,
          accuracy_m: body.accuracy_m != null ? Math.round(Number(body.accuracy_m)) : null,
          recorded_at: nowIso,
          source: 'heartbeat',
        });
      }

      // Ack the most recent in-flight command, if matched
      if (body.last_command_id) {
        const ackStatus = body.last_command_status === 'applied' ? 'ack' : 'failed';
        await supabaseAdmin
          .from('device_commands')
          .update({ status: ackStatus, acked_at: nowIso, error: ackStatus === 'failed' ? 'device reported failed' : null })
          .eq('command_id', body.last_command_id);
      }

      // SIM-change detection → activity log + branch WhatsApp
      if (body.sim_serial && prevSim && body.sim_serial !== prevSim) {
        await logActivity({
          branchId: device.branch_id,
          action: 'sim_change',
          entityType: 'device', entityId: device.id,
          details: { previous: prevSim, current: body.sim_serial }, req,
        });

        try {
          const { data: branch } = await supabaseAdmin
            .from('branches').select('phone, name').eq('id', device.branch_id).single();
          const { data: order } = device.order_id
            ? await supabaseAdmin
                .from('orders')
                .select('order_no, customers(customer_name, phone_1)')
                .eq('id', device.order_id).maybeSingle()
            : { data: null };

          if (branch?.phone) {
            await sendWhatsApp({
              phone: branch.phone,
              message:
`SIM SWAP DETECTED
Branch: ${branch.name}
Order: ${order?.order_no || '-'}
Customer: ${order?.customers?.customer_name || '-'}
Phone: ${order?.customers?.phone_1 || '-'}
IMEI: ${device.imei || '-'}
Previous SIM: ${prevSim}
New SIM: ${body.sim_serial}

Please verify with the customer.`,
            });
          }
        } catch (e) {
          console.warn('[devices/heartbeat] SIM-change WhatsApp failed:', e.message);
        }
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('[devices/heartbeat] error', e);
      res.status(500).json({ error: e.message || 'heartbeat error' });
    }
  },
);

// ---------------------------------------------------------------------------
// Operator list / detail / location history
// ---------------------------------------------------------------------------
router.get('/', authenticate, requirePermission('devices.view'), async (req, res) => {
  let q = supabaseAdmin
    .from('devices')
    .select('*, orders(id, order_no, device_locked, customer_id, customers(customer_name, phone_1, account_no)), branches(id, name)')
    .order('last_seen_at', { ascending: false, nullsFirst: false });

  // Branch scope by default; users with devices.global_view can opt out via ?global=1
  const perms = req.user.permissions || [];
  const wantsGlobal = req.query.global === '1' && (perms.includes('*') || perms.includes('devices.global_view'));
  if (!wantsGlobal) {
    const scope = scopeBranch(req);
    if (scope) q = q.eq('branch_id', scope);
  }
  if (req.query.branch_id && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
    q = q.eq('branch_id', req.query.branch_id);
  }
  if (req.query.status) q = q.eq('status', req.query.status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:imei/status', authenticate, requirePermission('devices.view'), async (req, res) => {
  const { data: device, error } = await supabaseAdmin
    .from('devices')
    .select('*, orders(id, order_no, device_locked, customer_id, customers(customer_name, phone_1, account_no)), branches(id, name, phone)')
    .eq('imei', req.params.imei)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (req.user.role === 'operator' && device.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: lastCommand } = await supabaseAdmin
    .from('device_commands')
    .select('*')
    .eq('device_id', device.id)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestLocation } = await supabaseAdmin
    .from('device_locations')
    .select('lat, lon, accuracy_m, recorded_at')
    .eq('device_id', device.id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  res.json({ device, last_command: lastCommand || null, latest_location: latestLocation || null });
});

router.get('/:imei/locations', authenticate, requirePermission('devices.view'), async (req, res) => {
  const { data: device, error } = await supabaseAdmin
    .from('devices').select('id, branch_id').eq('imei', req.params.imei).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (req.user.role === 'operator' && device.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let q = supabaseAdmin
    .from('device_locations')
    .select('id, lat, lon, accuracy_m, recorded_at, source')
    .eq('device_id', device.id)
    .order('recorded_at', { ascending: true })
    .limit(5000);
  if (req.query.from) q = q.gte('recorded_at', req.query.from);
  if (req.query.to) q = q.lte('recorded_at', req.query.to);

  const { data, error: locErr } = await q;
  if (locErr) return res.status(500).json({ error: locErr.message });
  res.json(data);
});

// Lock event history for a device (used by the Devices detail modal)
router.get('/:imei/events', authenticate, requirePermission('devices.view'), async (req, res) => {
  const { data: device } = await supabaseAdmin
    .from('devices').select('id, order_id, branch_id').eq('imei', req.params.imei).maybeSingle();
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (req.user.role === 'operator' && device.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: events } = await supabaseAdmin
    .from('device_lock_events')
    .select('*, profiles:triggered_by(id, full_name)')
    .eq('order_id', device.order_id)
    .order('created_at', { ascending: false })
    .limit(100);

  const { data: commands } = await supabaseAdmin
    .from('device_commands')
    .select('id, command_id, action, reason, status, issued_at, sent_at, acked_at, error')
    .eq('device_id', device.id)
    .order('issued_at', { ascending: false })
    .limit(100);

  res.json({ events: events || [], commands: commands || [] });
});

// ---------------------------------------------------------------------------
// "Locate now" — fire a `ping` command. The Android side, on receipt, sends
// a fresh heartbeat (which includes lat/lon).
// ---------------------------------------------------------------------------
router.post('/:imei/locate', authenticate, requirePermission('devices.locate'), async (req, res) => {
  const { data: device } = await supabaseAdmin
    .from('devices').select('*, orders(*)').eq('imei', req.params.imei).maybeSingle();
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (req.user.role === 'operator' && device.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!device.order_id || !device.orders) return res.status(400).json({ error: 'Device has no order' });

  try {
    const result = await issueCommand({
      order: device.orders,
      action: 'ping',
      reason: 'operator requested locate',
      issued_by: req.user.id,
      req,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Auto-lock sweep — runs on cron OR can be triggered manually by an admin.
// Spec §8: lock if branch.auto_lock_days is set AND there exists an overdue
// installment on the order older than that many days AND the order isn't
// already locked AND the order has an enrolled device.
// ---------------------------------------------------------------------------
async function runAutoLockSweep({ dryRun = false, issued_by = null } = {}) {
  const today = dayjs();

  const { data: branches, error: brErr } = await supabaseAdmin
    .from('branches')
    .select('id, name, auto_lock_days')
    .not('auto_lock_days', 'is', null);
  if (brErr) throw new Error(brErr.message);

  const result = { branches_checked: 0, candidates: 0, locked: 0, skipped: 0, errors: [] };

  for (const branch of branches || []) {
    result.branches_checked++;
    const threshold = Number(branch.auto_lock_days);
    if (!threshold || threshold < 1) continue;
    const cutoff = today.subtract(threshold, 'day').format('YYYY-MM-DD');

    // Orders in this branch that:
    //  • are not already locked
    //  • are not completed/cancelled
    //  • have at least one installment that is unpaid AND due_date <= cutoff
    const { data: candidateOrders, error: ordErr } = await supabaseAdmin
      .from('orders')
      .select('id, order_no, customer_id, branch_id, device_locked, status, installments(id, due_date, amount_due, amount_paid, status)')
      .eq('branch_id', branch.id)
      .eq('device_locked', false)
      .neq('status', 'completed')
      .neq('status', 'cancelled');
    if (ordErr) { result.errors.push(ordErr.message); continue; }

    for (const order of candidateOrders || []) {
      const overdue = (order.installments || []).some(i => {
        if (i.due_date > cutoff) return false;
        const due = Number(i.amount_due || 0);
        const paid = Number(i.amount_paid || 0);
        return paid < due;
      });
      if (!overdue) continue;

      // Order must have an active device
      const { data: device } = await supabaseAdmin
        .from('devices').select('id').eq('order_id', order.id)
        .in('status', ['active', 'offline']).maybeSingle();
      if (!device) { result.skipped++; continue; }

      result.candidates++;
      if (dryRun) continue;

      try {
        await issueCommand({
          order,
          action: 'lock',
          reason: `Auto-lock: overdue ≥ ${threshold} days`,
          lock_message: `Aap ka installment ${threshold} din se overdue hai. Please contact your branch.`,
          issued_by,
        });
        result.locked++;
      } catch (e) {
        result.errors.push(`order ${order.order_no}: ${e.message}`);
      }
    }
  }
  return result;
}

router.post('/run-auto-lock', authenticate, requirePermission('devices.lock'), async (req, res) => {
  try {
    const summary = await runAutoLockSweep({
      dryRun: req.query.dry === '1',
      issued_by: req.user.id,
    });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.runAutoLockSweep = runAutoLockSweep;
