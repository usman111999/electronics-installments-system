// WhatsApp provider abstraction
// Pluggable: twilio, meta (cloud api), ultramsg, none (logs only)

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();

async function sendTwilio({ phone, message }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) throw new Error('Twilio env not configured');

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({ From: from, To: `whatsapp:${phone}`, Body: message }).toString();

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) throw new Error('Twilio: ' + (await r.text()));
  return r.json();
}

async function sendMeta({ phone, message }) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error('Meta env not configured');
  const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'text',
      text: { body: message },
    }),
  });
  if (!r.ok) throw new Error('Meta: ' + (await r.text()));
  return r.json();
}

async function sendUltraMsg({ phone, message }) {
  const inst = process.env.ULTRAMSG_INSTANCE_ID;
  const token = process.env.ULTRAMSG_TOKEN;
  if (!inst || !token) throw new Error('UltraMsg env not configured');

  const body = new URLSearchParams({ token, to: phone, body: message }).toString();
  const r = await fetch(`https://api.ultramsg.com/${inst}/messages/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error('UltraMsg: ' + (await r.text()));
  return r.json();
}

async function sendWhatsApp({ phone, message }) {
  if (!phone) throw new Error('phone required');
  if (PROVIDER === 'twilio') return sendTwilio({ phone, message });
  if (PROVIDER === 'meta') return sendMeta({ phone, message });
  if (PROVIDER === 'ultramsg') return sendUltraMsg({ phone, message });
  // none — log only
  console.log(`[whatsapp:noop] → ${phone}\n${message}\n---`);
  return { noop: true };
}

module.exports = { sendWhatsApp, PROVIDER };
