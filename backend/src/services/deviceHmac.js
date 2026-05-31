// HMAC helpers — both directions:
//   • signServerCommand(secret, {command_id, action, issued_at})
//       used when the backend issues a lock/unlock command. The Android app
//       re-computes this and refuses to act if it does not match.
//   • verifyDeviceSignature(secret, body, issuedAt, sig)
//       used when validating an incoming /devices/heartbeat. Rejects when the
//       supplied X-Issued-At is more than 10 minutes off server clock so a
//       captured request cannot be replayed indefinitely.

const crypto = require('crypto');

const REPLAY_WINDOW_MS = 10 * 60 * 1000;

function hmacHex(secretHex, message) {
  // Secrets are stored as hex strings; treat them as raw bytes for the HMAC
  // key so the device side (which decodes the same hex) computes the same
  // signature.
  const key = Buffer.from(secretHex, 'hex');
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

function signServerCommand(secret, { command_id, action, issued_at }) {
  return hmacHex(secret, `${command_id}${action}${issued_at}`);
}

function verifyDeviceSignature(secret, rawBody, issuedAt, sig) {
  if (!secret || !rawBody || !issuedAt || !sig) return false;

  const ts = Date.parse(issuedAt);
  if (Number.isNaN(ts)) return false;
  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) return false;

  const expected = hmacHex(secret, `${rawBody}${issuedAt}`);
  // Use timingSafeEqual to avoid leaking compare timing
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { signServerCommand, verifyDeviceSignature, REPLAY_WINDOW_MS };
