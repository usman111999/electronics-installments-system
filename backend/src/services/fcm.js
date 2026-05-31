// FCM HTTP v1 sender using a Google service-account.
//
// Required env (one of):
//   FCM_SERVICE_ACCOUNT_JSON_PATH=./firebase-service-account.json
//   FCM_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
//
// Optional:
//   FCM_PROJECT_ID — overrides the project_id from the service account.
//
// When the service account is not configured, sendCommand() logs and returns
// {noop:true} so the rest of the stack works in dev without Firebase.

const fs = require('fs');

let cachedAccessToken = null;
let cachedTokenExpiry = 0;
let cachedServiceAccount = null;

function loadServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;

  const rawJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  const path = process.env.FCM_SERVICE_ACCOUNT_JSON_PATH;

  if (rawJson && rawJson.trim().length) {
    try { cachedServiceAccount = JSON.parse(rawJson); return cachedServiceAccount; }
    catch (e) { console.error('[fcm] FCM_SERVICE_ACCOUNT_JSON env did not parse:', e.message); return null; }
  }
  if (path && fs.existsSync(path)) {
    try { cachedServiceAccount = JSON.parse(fs.readFileSync(path, 'utf8')); return cachedServiceAccount; }
    catch (e) { console.error('[fcm] could not read service account from', path, e.message); return null; }
  }
  return null;
}

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedTokenExpiry - 60_000) return cachedAccessToken;

  const sa = loadServiceAccount();
  if (!sa) return null;

  let GoogleAuth;
  try { ({ GoogleAuth } = require('google-auth-library')); }
  catch {
    console.error('[fcm] google-auth-library not installed — run `npm install google-auth-library` in backend/');
    return null;
  }

  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token || tokenResp;
  cachedAccessToken = token;
  // Default lifetime is 1h — be conservative
  cachedTokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

/**
 * Send an FCM data message to a device.
 * @param {object} args
 * @param {string} args.fcm_token  — registration token of the target device
 * @param {object} args.payload    — flat data dict; values are coerced to string per the FCM v1 spec
 * @returns {Promise<{ok:true, name:string} | {noop:true} | {ok:false, error:string, status?:number}>}
 */
async function sendCommand({ fcm_token, payload }) {
  const sa = loadServiceAccount();
  const projectId = process.env.FCM_PROJECT_ID || sa?.project_id;

  if (!sa || !projectId || process.env.DEVICE_LOCK_PROVIDER === 'none') {
    console.log('[fcm:noop] target=', fcm_token?.slice(0, 16) + '…',
      'payload=', JSON.stringify(payload));
    return { noop: true };
  }

  if (!fcm_token) return { ok: false, error: 'fcm_token missing' };

  const accessToken = await getAccessToken();
  if (!accessToken) return { ok: false, error: 'fcm access token unavailable' };

  // FCM data values MUST be strings
  const data = {};
  for (const [k, v] of Object.entries(payload || {})) {
    data[k] = v == null ? '' : String(v);
  }

  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const body = {
    message: {
      token: fcm_token,
      data,
      android: { priority: 'high' },
    },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    console.error('[fcm] send failed', r.status, text.slice(0, 500));
    return { ok: false, status: r.status, error: text.slice(0, 500) };
  }
  const json = await r.json().catch(() => ({}));
  return { ok: true, name: json.name };
}

module.exports = { sendCommand };
