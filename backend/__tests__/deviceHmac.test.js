// Unit tests for services/deviceHmac.js — the HMAC primitives that both
// directions of the lock protocol depend on.
//
// Cross-contract: the fixtures in this file MUST match the ones used by the
// Android-side test android-app/.../DeviceHmacTest.kt so a signature the JVM
// produces is what Node verifies, and vice versa.

const crypto = require('crypto');
const {
  signServerCommand,
  verifyDeviceSignature,
  REPLAY_WINDOW_MS,
} = require('../src/services/deviceHmac');

// "0000…0001" — 32-byte hex (matches the Android test fixture)
const SECRET = '0'.repeat(62) + '01';

// Reference vector — computed locally from the same algorithm. Locks in the
// exact bytes so a future refactor cannot silently change the wire format.
function computeReference(secretHex, msg) {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(msg, 'utf8').digest('hex');
}

describe('signServerCommand', () => {
  test('produces deterministic 64-char lowercase hex', () => {
    const a = signServerCommand(SECRET, {
      command_id: 'cmd-1', action: 'lock', issued_at: '2026-05-24T12:00:00Z',
    });
    const b = signServerCommand(SECRET, {
      command_id: 'cmd-1', action: 'lock', issued_at: '2026-05-24T12:00:00Z',
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('matches the same algorithm Android uses (string concat, no separator)', () => {
    const out = signServerCommand(SECRET, {
      command_id: 'cmd-1', action: 'lock', issued_at: '2026-05-24T12:00:00Z',
    });
    const expected = computeReference(SECRET, 'cmd-1lock2026-05-24T12:00:00Z');
    expect(out).toBe(expected);
  });

  // ── INTEROP VECTOR: pinned byte-for-byte. The Android test
  // DeviceHmacInteropTest.kt asserts the same hex for the same inputs. If
  // either side drifts (key handling, encoding, separator), this breaks.
  test('command interop vector matches the Android side', () => {
    const out = signServerCommand(SECRET, {
      command_id: 'cmd-1', action: 'lock', issued_at: '2026-05-24T12:00:00Z',
    });
    expect(out).toBe('a025197f7a8096058d0fbf8ff8099225384d5e22f38ff114f5e9d588103fd777');
  });

  test('changes when any input field changes', () => {
    const base = signServerCommand(SECRET, {
      command_id: 'cmd-1', action: 'lock', issued_at: '2026-05-24T12:00:00Z',
    });
    const diffId = signServerCommand(SECRET, {
      command_id: 'cmd-2', action: 'lock', issued_at: '2026-05-24T12:00:00Z',
    });
    const diffAction = signServerCommand(SECRET, {
      command_id: 'cmd-1', action: 'unlock', issued_at: '2026-05-24T12:00:00Z',
    });
    const diffTs = signServerCommand(SECRET, {
      command_id: 'cmd-1', action: 'lock', issued_at: '2026-05-24T12:00:01Z',
    });
    expect(new Set([base, diffId, diffAction, diffTs]).size).toBe(4);
  });
});

describe('verifyDeviceSignature', () => {
  const body = JSON.stringify({ imei: '352099001761481', lock_state: 'locked' });

  function makeSig(secret, b, issuedAt) {
    return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(b + issuedAt, 'utf8').digest('hex');
  }

  test('round-trips for a valid signature within the replay window', () => {
    const issuedAt = new Date().toISOString();
    const sig = makeSig(SECRET, body, issuedAt);
    expect(verifyDeviceSignature(SECRET, body, issuedAt, sig)).toBe(true);
  });

  test('rejects when the body has been tampered with', () => {
    const issuedAt = new Date().toISOString();
    const sig = makeSig(SECRET, body, issuedAt);
    const tampered = body.replace('locked', 'unlocked');
    expect(verifyDeviceSignature(SECRET, tampered, issuedAt, sig)).toBe(false);
  });

  test('rejects with a different secret', () => {
    const issuedAt = new Date().toISOString();
    const sig = makeSig(SECRET, body, issuedAt);
    const otherSecret = '0'.repeat(62) + '02';
    expect(verifyDeviceSignature(otherSecret, body, issuedAt, sig)).toBe(false);
  });

  test('rejects timestamps older than the replay window', () => {
    const tooOld = new Date(Date.now() - (REPLAY_WINDOW_MS + 1000)).toISOString();
    const sig = makeSig(SECRET, body, tooOld);
    expect(verifyDeviceSignature(SECRET, body, tooOld, sig)).toBe(false);
  });

  test('rejects timestamps further than the replay window in the future', () => {
    const tooFuture = new Date(Date.now() + (REPLAY_WINDOW_MS + 1000)).toISOString();
    const sig = makeSig(SECRET, body, tooFuture);
    expect(verifyDeviceSignature(SECRET, body, tooFuture, sig)).toBe(false);
  });

  test('rejects empty signature, body, or timestamp', () => {
    const issuedAt = new Date().toISOString();
    expect(verifyDeviceSignature(SECRET, '', issuedAt, 'aa')).toBe(false);
    expect(verifyDeviceSignature(SECRET, body, '', 'aa')).toBe(false);
    expect(verifyDeviceSignature(SECRET, body, issuedAt, '')).toBe(false);
    expect(verifyDeviceSignature('', body, issuedAt, 'aa')).toBe(false);
  });

  test('rejects a hex sig of the wrong length without throwing', () => {
    const issuedAt = new Date().toISOString();
    const sig = 'deadbeef'; // 4 bytes, not 32
    expect(verifyDeviceSignature(SECRET, body, issuedAt, sig)).toBe(false);
  });

  test('REPLAY_WINDOW_MS is exactly 10 minutes per spec §5', () => {
    expect(REPLAY_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});
