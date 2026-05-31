// Supertest-level integration test for the /api/devices and /api/orders/:id/lock
// routes. Auth middleware + Supabase + FCM are all stubbed so this exercises
// the express wiring, validation, and HMAC logic end-to-end without a live
// network or DB.

const crypto = require('crypto');

// --- Mocks (Jest hoists) ----------------------------------------------------

// Replace the auth middleware with a deterministic shim:
//   • `authenticate` reads X-Test-User header (JSON) and sets req.user
//   • `requireRole` allows everything if req.user.role is in the list
//   • `scopeBranch` keeps original semantics
jest.mock('../src/middleware/auth', () => {
  return {
    authenticate(req, res, next) {
      const hdr = req.headers['x-test-user'];
      if (!hdr) return res.status(401).json({ error: 'Missing access token' });
      try {
        req.user = JSON.parse(hdr);
      } catch {
        return res.status(401).json({ error: 'Bad test user header' });
      }
      next();
    },
    requireRole(...allowed) {
      return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
        if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
        next();
      };
    },
    // RBAC migration added this; tests don't really care about permission
    // strings, so allow super_admin/admin everything and otherwise check
    // req.user.permissions if the test seeded it.
    requirePermission(...perms) {
      return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
        const granted = req.user.permissions || [];
        if (granted.includes('*') || req.user.role === 'super_admin') return next();
        if (req.user.role === 'admin') return next();
        if (perms.some(p => granted.includes(p))) return next();
        return res.status(403).json({ error: 'Forbidden', missing: perms });
      };
    },
    invalidateAll() {},
    scopeBranch(req) {
      if (!req.user) return null;
      if (req.user.role === 'admin') return null;
      return req.user.branch_id;
    },
  };
});

// In-memory Supabase shim that supports the chainable surface used by the
// routes we test. State is keyed by table; tests seed it via __seed().
jest.mock('../src/config/supabase', () => {
  const state = {
    tables: {
      devices: [],
      orders: [],
      device_locations: [],
      device_commands: [],
      device_lock_events: [],
      activity_logs: [],
      customers: [],
      branches: [],
    },
    reset() {
      for (const k of Object.keys(this.tables)) this.tables[k] = [];
    },
    seed(table, rows) {
      this.tables[table] = Array.isArray(rows) ? rows : [rows];
    },
  };

  function makeBuilder(table) {
    let rows = [...(state.tables[table] || [])];
    const ops = { lastInserted: null };

    const b = {
      select() { return b; },
      eq(col, val) { rows = rows.filter(r => r[col] === val); return b; },
      neq(col, val) { rows = rows.filter(r => r[col] !== val); return b; },
      in(col, arr) { rows = rows.filter(r => arr.includes(r[col])); return b; },
      order() { return b; },
      limit() { return b; },
      lte() { return b; },
      gte() { return b; },
      lt() { return b; },
      gt() { return b; },
      not() { return b; },
      insert(row) {
        const inserted = Array.isArray(row) ? row : [row];
        const stored = inserted.map(r => ({ id: 'row-' + Math.random().toString(36).slice(2, 10), ...r }));
        state.tables[table] = (state.tables[table] || []).concat(stored);
        rows = stored;
        ops.lastInserted = stored;
        return b;
      },
      update(patch) {
        const ids = rows.map(r => r.id);
        const t = state.tables[table] || [];
        for (const r of t) {
          if (ids.includes(r.id)) Object.assign(r, patch);
        }
        rows = t.filter(r => ids.includes(r.id));
        return b;
      },
      single() {
        if (rows.length === 0) return Promise.resolve({ data: null, error: { message: 'no row' } });
        return Promise.resolve({ data: rows[0], error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return b;
  }

  const supabaseAdmin = {
    from(table) { return makeBuilder(table); },
    __state: state,
  };
  return { supabaseAdmin };
});

jest.mock('../src/services/fcm', () => ({
  sendCommand: jest.fn(async () => ({ ok: true, name: 'projects/x/messages/y' })),
}));

jest.mock('../src/services/whatsapp', () => ({
  sendWhatsApp: jest.fn(async () => ({ noop: true })),
}));

jest.mock('../src/services/activityLog', () => ({
  logActivity: jest.fn(async () => {}),
}));

// --- Wire up ---------------------------------------------------------------

process.env.NODE_ENV = 'test';

const request = require('supertest');
const { buildApp } = require('./_buildApp');
const { supabaseAdmin } = require('../src/config/supabase');
const { sendCommand } = require('../src/services/fcm');

const app = buildApp();

const ADMIN = { id: 'admin-1', role: 'admin', branch_id: null };
const OPERATOR = { id: 'op-1', role: 'operator', branch_id: 'branch-1' };

beforeEach(() => {
  supabaseAdmin.__state.reset();
  sendCommand.mockClear();
});

// ---------------------------------------------------------------------------
// /enrollment-tokens
// ---------------------------------------------------------------------------
describe('POST /api/devices/enrollment-tokens', () => {
  beforeEach(() => {
    supabaseAdmin.__state.seed('orders', [
      { id: 'order-1', branch_id: 'branch-1', customer_id: 'cust-1', order_no: 'ORD-1' },
    ]);
  });

  test('requires auth', async () => {
    const res = await request(app).post('/api/devices/enrollment-tokens').send({ order_id: 'order-1' });
    expect(res.status).toBe(401);
  });

  test('returns token + secret + qr_payload with the right shape', async () => {
    const res = await request(app)
      .post('/api/devices/enrollment-tokens')
      .set('X-Test-User', JSON.stringify(ADMIN))
      .send({ order_id: 'order-1' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.qr_payload).toMatchObject({
      v: 1,
      token: res.body.token,
      secret: res.body.secret,
      branch: 'branch-1',
      order: 'order-1',
    });
    expect(res.body.qr_payload.url).toMatch(/\/devices\/enroll$/);
    expect(res.body.expires_at).toBeTruthy();
  });

  test('400 when order_id missing', async () => {
    const res = await request(app)
      .post('/api/devices/enrollment-tokens')
      .set('X-Test-User', JSON.stringify(ADMIN))
      .send({});
    expect(res.status).toBe(400);
  });

  test('operator cannot mint a token for an order in another branch', async () => {
    const otherOp = { id: 'op-2', role: 'operator', branch_id: 'branch-2' };
    const res = await request(app)
      .post('/api/devices/enrollment-tokens')
      .set('X-Test-User', JSON.stringify(otherOp))
      .send({ order_id: 'order-1' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// /enroll
// ---------------------------------------------------------------------------
describe('POST /api/devices/enroll', () => {
  test('400 when token or imei missing', async () => {
    const res = await request(app).post('/api/devices/enroll').send({});
    expect(res.status).toBe(400);
  });

  test('404 for unknown enrollment token', async () => {
    supabaseAdmin.__state.seed('devices', []);
    const res = await request(app).post('/api/devices/enroll')
      .send({ token: 'no-such-token', imei: '111122223333444' });
    expect(res.status).toBe(404);
  });

  test('410 when enrollment token has expired', async () => {
    supabaseAdmin.__state.seed('devices', [{
      id: 'dev-1', order_id: 'order-1', branch_id: 'branch-1',
      enrollment_token: 'tok-stale',
      enrollment_token_expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      status: 'pending',
    }]);
    const res = await request(app).post('/api/devices/enroll')
      .send({ token: 'tok-stale', imei: '111122223333444' });
    expect(res.status).toBe(410);
  });

  test('happy path: flips status to active and returns ok', async () => {
    supabaseAdmin.__state.seed('devices', [{
      id: 'dev-1', order_id: 'order-1', branch_id: 'branch-1',
      enrollment_token: 'tok-fresh',
      enrollment_token_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      status: 'pending',
    }]);
    supabaseAdmin.__state.seed('orders', [{ id: 'order-1', branch_id: 'branch-1' }]);

    const res = await request(app).post('/api/devices/enroll')
      .send({ token: 'tok-fresh', imei: '352099001761481', fcm_token: 'fcm-abc' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.device_id).toBe('dev-1');
    const dev = supabaseAdmin.__state.tables.devices.find(d => d.id === 'dev-1');
    expect(dev.status).toBe('active');
    expect(dev.imei).toBe('352099001761481');
  });
});

// ---------------------------------------------------------------------------
// /heartbeat
// ---------------------------------------------------------------------------
describe('POST /api/devices/heartbeat', () => {
  const SECRET = '0'.repeat(62) + '01';

  function makeSig(secret, body, issuedAt) {
    return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(body + issuedAt, 'utf8').digest('hex');
  }

  function seedDevice() {
    supabaseAdmin.__state.seed('devices', [{
      id: 'dev-1', order_id: 'order-1', branch_id: 'branch-1',
      device_secret: SECRET,
      imei: '352099001761481',
      status: 'active',
      current_sim_serial: null,
    }]);
  }

  test('rejects missing Authorization header (401)', async () => {
    seedDevice();
    const res = await request(app).post('/api/devices/heartbeat')
      .set('Content-Type', 'application/json')
      .send({ imei: 'x' });
    expect(res.status).toBe(401);
  });

  test('rejects malformed Authorization header (401)', async () => {
    seedDevice();
    const res = await request(app).post('/api/devices/heartbeat')
      .set('Authorization', 'Bearer junk')
      .set('X-Issued-At', new Date().toISOString())
      .send({});
    expect(res.status).toBe(401);
  });

  test('rejects missing X-Issued-At (401)', async () => {
    seedDevice();
    const res = await request(app).post('/api/devices/heartbeat')
      .set('Authorization', 'HMAC dev-1:deadbeef')
      .send({});
    expect(res.status).toBe(401);
  });

  test('rejects a stale X-Issued-At (>10 min) with 401', async () => {
    seedDevice();
    const body = JSON.stringify({ lock_state: 'locked' });
    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const sig = makeSig(SECRET, body, stale);
    const res = await request(app).post('/api/devices/heartbeat')
      .set('Authorization', `HMAC dev-1:${sig}`)
      .set('X-Issued-At', stale)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(401);
  });

  test('rejects a bad signature (401)', async () => {
    seedDevice();
    const issuedAt = new Date().toISOString();
    const res = await request(app).post('/api/devices/heartbeat')
      .set('Authorization', `HMAC dev-1:${'ab'.repeat(32)}`)
      .set('X-Issued-At', issuedAt)
      .set('Content-Type', 'application/json')
      .send({ lock_state: 'locked' });
    expect(res.status).toBe(401);
  });

  test('accepts a valid heartbeat and writes a device_locations row when lat/lon present', async () => {
    seedDevice();
    const issuedAt = new Date().toISOString();
    const body = JSON.stringify({
      imei: '352099001761481', lock_state: 'locked',
      battery_pct: 78, network_type: 'wifi',
      lat: 32.4945, lon: 74.5229, accuracy_m: 12,
    });
    const sig = makeSig(SECRET, body, issuedAt);

    const res = await request(app).post('/api/devices/heartbeat')
      .set('Authorization', `HMAC dev-1:${sig}`)
      .set('X-Issued-At', issuedAt)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(supabaseAdmin.__state.tables.device_locations).toHaveLength(1);
    const loc = supabaseAdmin.__state.tables.device_locations[0];
    expect(loc.lat).toBe(32.4945);
    expect(loc.lon).toBe(74.5229);
    expect(loc.accuracy_m).toBe(12);
    expect(loc.source).toBe('heartbeat');
  });

  test('does NOT write a location row when lat/lon absent', async () => {
    seedDevice();
    const issuedAt = new Date().toISOString();
    const body = JSON.stringify({ lock_state: 'unlocked', battery_pct: 60 });
    const sig = makeSig(SECRET, body, issuedAt);
    const res = await request(app).post('/api/devices/heartbeat')
      .set('Authorization', `HMAC dev-1:${sig}`)
      .set('X-Issued-At', issuedAt)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(supabaseAdmin.__state.tables.device_locations).toHaveLength(0);
  });

  test('404 for unknown device id', async () => {
    supabaseAdmin.__state.seed('devices', []);
    const issuedAt = new Date().toISOString();
    const body = JSON.stringify({ x: 1 });
    const sig = makeSig(SECRET, body, issuedAt);
    const res = await request(app).post('/api/devices/heartbeat')
      .set('Authorization', `HMAC dev-1:${sig}`)
      .set('X-Issued-At', issuedAt)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// /api/orders/:id/lock — smoke
// ---------------------------------------------------------------------------
describe('POST /api/orders/:id/lock', () => {
  beforeEach(() => {
    supabaseAdmin.__state.seed('orders', [{
      id: 'order-1', branch_id: 'branch-1', customer_id: 'cust-1', order_no: 'ORD-1',
    }]);
    supabaseAdmin.__state.seed('devices', [{
      id: 'dev-1', order_id: 'order-1', branch_id: 'branch-1',
      device_secret: '0'.repeat(62) + '01', fcm_token: 'fcm-abc', status: 'active',
    }]);
    supabaseAdmin.__state.seed('customers', [{ id: 'cust-1', customer_name: 'Test', phone_1: '0300' }]);
    supabaseAdmin.__state.seed('branches', [{ id: 'branch-1', phone: '042-x' }]);
  });

  test('requires auth (401)', async () => {
    const res = await request(app).post('/api/orders/order-1/lock').send({ reason: 'x' });
    expect(res.status).toBe(401);
  });

  test('forbids customer role (403)', async () => {
    const res = await request(app).post('/api/orders/order-1/lock')
      .set('X-Test-User', JSON.stringify({ id: 'c-1', role: 'customer' }))
      .send({});
    expect(res.status).toBe(403);
  });

  test('admin can issue lock — fires FCM and returns 202', async () => {
    const res = await request(app).post('/api/orders/order-1/lock')
      .set('X-Test-User', JSON.stringify(ADMIN))
      .send({ reason: 'qa-test' });
    expect(res.status).toBe(202);
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when no active device on the order', async () => {
    supabaseAdmin.__state.seed('devices', []);
    const res = await request(app).post('/api/orders/order-1/lock')
      .set('X-Test-User', JSON.stringify(ADMIN))
      .send({ reason: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active device/);
  });

  test('operator in wrong branch is forbidden (403)', async () => {
    const otherOp = { id: 'op-99', role: 'operator', branch_id: 'branch-9' };
    const res = await request(app).post('/api/orders/order-1/lock')
      .set('X-Test-User', JSON.stringify(otherOp))
      .send({ reason: 'x' });
    expect(res.status).toBe(403);
  });
});
