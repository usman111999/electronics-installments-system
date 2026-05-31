// Pluggable device-lock provider abstraction.
// Real-world providers used in Pakistan / regional installment markets:
//   - payjoy: PayJoy SDK + their lock API
//   - knox:   Samsung Knox Guard (Android, Samsung devices)
//   - mdm:    generic MDM webhook (e.g. Mobilock, Hexnode, ScaleFusion, custom)
//   - none:   no real provider — logs to console (dev / staging default)

const PROVIDER = (process.env.DEVICE_LOCK_PROVIDER || 'none').toLowerCase();

async function callMdmWebhook(action, { imei, orderId, reason }) {
  const url = process.env.MDM_WEBHOOK_URL;
  const token = process.env.MDM_WEBHOOK_TOKEN;
  if (!url) throw new Error('MDM_WEBHOOK_URL not set');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, imei, orderId, reason }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`MDM webhook ${r.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { ok: true, raw: text }; }
}

async function callPayJoy(action, { imei, orderId, reason }) {
  const token = process.env.PAYJOY_API_TOKEN;
  const merchantId = process.env.PAYJOY_MERCHANT_ID;
  if (!token || !merchantId) throw new Error('PayJoy env not configured');
  // PayJoy's API requires merchant onboarding; this is the canonical shape.
  const r = await fetch(`https://api.payjoy.com/v1/merchants/${merchantId}/devices/${imei}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, externalRef: orderId }),
  });
  if (!r.ok) throw new Error(`PayJoy ${r.status}: ${await r.text()}`);
  return r.json();
}

async function callKnox(action, { imei, orderId, reason }) {
  const token = process.env.KNOX_API_TOKEN;
  const tenantId = process.env.KNOX_TENANT_ID;
  if (!token || !tenantId) throw new Error('Knox env not configured');
  const r = await fetch(`https://eu-kg-api.samsungknox.com/kg/v1/tenants/${tenantId}/devices/${imei}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, reference: orderId }),
  });
  if (!r.ok) throw new Error(`Knox ${r.status}: ${await r.text()}`);
  return r.json();
}

async function dispatch(action, payload) {
  if (!['lock', 'unlock'].includes(action)) throw new Error('invalid action');
  if (!payload.imei) throw new Error('IMEI is required to perform device lock action');

  if (PROVIDER === 'payjoy') return callPayJoy(action, payload);
  if (PROVIDER === 'knox') return callKnox(action, payload);
  if (PROVIDER === 'mdm') return callMdmWebhook(action, payload);

  console.log(`[device-lock:noop] ${action} IMEI=${payload.imei} order=${payload.orderId} reason="${payload.reason || ''}"`);
  return { noop: true, provider: 'none' };
}

module.exports = {
  PROVIDER,
  lockDevice: (p) => dispatch('lock', p),
  unlockDevice: (p) => dispatch('unlock', p),
};
