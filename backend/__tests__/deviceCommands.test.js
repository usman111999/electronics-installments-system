// Unit tests for services/deviceCommands.js
//
// Strategy: mock supabaseAdmin and the fcm sender so this test has zero
// dependencies on the database or Firebase. We capture every call into
// arrays and assert structure + side effects.

// --- Mocks (Jest hoists these to the top of the file) -----------------------

jest.mock('../src/config/supabase', () => {
  // A minimal in-memory query builder that records what was inserted and
  // updated, table by table. Every chainable method returns `this`. Terminal
  // methods (single/maybeSingle, or "no terminal" — i.e. awaiting the builder
  // directly) resolve to a fixed result that tests configure via __setData.
  function makeBuilder(table, dataStore) {
    const ctx = {
      __table: table,
      __filters: {},
      __lastInsert: null,
      __lastUpdate: null,
    };
    const builder = {
      select() { return builder; },
      eq(_k, _v) { return builder; },
      in() { return builder; },
      neq() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      lte() { return builder; },
      gte() { return builder; },
      lt() { return builder; },
      gt() { return builder; },
      not() { return builder; },
      insert(row) {
        dataStore.inserts.push({ table, row });
        // Make insert chainable: insert().select().single() returns the row
        builder.__inserted = Array.isArray(row) ? row[0] : row;
        return builder;
      },
      update(patch) {
        dataStore.updates.push({ table, patch });
        builder.__updated = patch;
        return builder;
      },
      single() {
        return Promise.resolve(resolveResult());
      },
      maybeSingle() {
        return Promise.resolve(resolveResult());
      },
      // Allow `await builder` for queries that don't terminate with single()
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
      },
    };
    function resolveResult() {
      // For inserts, echo back the inserted row plus a generated id
      if (builder.__inserted) {
        const row = { id: 'row-' + Math.random().toString(36).slice(2, 10), ...builder.__inserted };
        return { data: row, error: null };
      }
      // Otherwise fall back to a per-table fixture
      if (Object.prototype.hasOwnProperty.call(dataStore.fixtures, table)) {
        return { data: dataStore.fixtures[table], error: null };
      }
      return { data: null, error: null };
    }
    return builder;
  }

  const dataStore = {
    inserts: [],
    updates: [],
    fixtures: {},
    reset() { this.inserts = []; this.updates = []; this.fixtures = {}; },
    setFixture(table, data) { this.fixtures[table] = data; },
  };

  const supabaseAdmin = {
    from(table) { return makeBuilder(table, dataStore); },
    __dataStore: dataStore,
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

// --- Imports (AFTER mocks so they pick up the mocked modules) ---------------

const { issueCommand } = require('../src/services/deviceCommands');
const { sendCommand } = require('../src/services/fcm');
const { supabaseAdmin } = require('../src/config/supabase');

const order = { id: 'order-1', branch_id: 'branch-1', customer_id: 'cust-1', order_no: 'ORD-1' };

beforeEach(() => {
  supabaseAdmin.__dataStore.reset();
  sendCommand.mockReset();
  sendCommand.mockResolvedValue({ ok: true, name: 'projects/x/messages/y' });
});

describe('issueCommand', () => {
  test('lock: inserts command row, signs payload, calls FCM once, updates orders + emits lock event', async () => {
    // Arrange — pretend the order has an active device
    supabaseAdmin.__dataStore.setFixture('devices', {
      id: 'dev-1',
      order_id: order.id,
      branch_id: order.branch_id,
      fcm_token: 'fcm-abc',
      device_secret: '0'.repeat(62) + '01',
      status: 'active',
    });

    // Act
    const result = await issueCommand({ order, action: 'lock', reason: 'overdue', lock_message: 'pay up' });

    // Assert: exactly one FCM call
    expect(sendCommand).toHaveBeenCalledTimes(1);
    const fcmArg = sendCommand.mock.calls[0][0];
    expect(fcmArg.fcm_token).toBe('fcm-abc');
    expect(fcmArg.payload.type).toBe('command');
    expect(fcmArg.payload.action).toBe('lock');
    expect(fcmArg.payload.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(fcmArg.payload.command_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fcmArg.payload.issued_at).toMatch(/Z$/);

    // Assert: device_commands row inserted with status='queued', then updated to 'sent'
    const commandsInsert = supabaseAdmin.__dataStore.inserts.find(i => i.table === 'device_commands');
    expect(commandsInsert).toBeTruthy();
    expect(commandsInsert.row.action).toBe('lock');
    expect(commandsInsert.row.status).toBe('queued');
    expect(commandsInsert.row.command_id).toBe(fcmArg.payload.command_id);

    const cmdUpdate = supabaseAdmin.__dataStore.updates.find(u =>
      u.table === 'device_commands' && u.patch.status === 'sent');
    expect(cmdUpdate).toBeTruthy();
    expect(cmdUpdate.patch.sent_at).toBeTruthy();

    // Assert: order flipped device_locked=true
    const orderUpdate = supabaseAdmin.__dataStore.updates.find(u => u.table === 'orders');
    expect(orderUpdate).toBeTruthy();
    expect(orderUpdate.patch.device_locked).toBe(true);

    // Assert: device_lock_events audit row inserted
    const evInsert = supabaseAdmin.__dataStore.inserts.find(i => i.table === 'device_lock_events');
    expect(evInsert).toBeTruthy();
    expect(evInsert.row.action).toBe('lock');
    expect(evInsert.row.success).toBe(true);

    expect(result.command).toBeTruthy();
    expect(result.fcm.ok).toBe(true);
  });

  test('unlock: flips device_locked back to false', async () => {
    supabaseAdmin.__dataStore.setFixture('devices', {
      id: 'dev-1', order_id: order.id, branch_id: order.branch_id,
      fcm_token: 'fcm-abc', device_secret: '0'.repeat(62) + '01', status: 'active',
    });
    await issueCommand({ order, action: 'unlock', reason: 'paid' });

    const orderUpdate = supabaseAdmin.__dataStore.updates.find(u => u.table === 'orders');
    expect(orderUpdate.patch.device_locked).toBe(false);
    expect(orderUpdate.patch.device_unlocked_at).toBeTruthy();
  });

  test('no active device for order → throws', async () => {
    supabaseAdmin.__dataStore.setFixture('devices', null);
    await expect(issueCommand({ order, action: 'lock' })).rejects.toThrow(/No active device/);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  test('FCM sender returns {ok:false, error} → command row ends in status=failed with error populated', async () => {
    supabaseAdmin.__dataStore.setFixture('devices', {
      id: 'dev-1', order_id: order.id, branch_id: order.branch_id,
      fcm_token: 'fcm-abc', device_secret: '0'.repeat(62) + '01', status: 'active',
    });
    sendCommand.mockResolvedValueOnce({ ok: false, error: 'fcm down: UNREGISTERED' });

    await issueCommand({ order, action: 'lock' });

    const failedUpdate = supabaseAdmin.__dataStore.updates.find(u =>
      u.table === 'device_commands' && u.patch.status === 'failed');
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate.patch.error).toMatch(/UNREGISTERED|fcm/i);

    // Regression guard for the audit fix: when FCM dispatch fails the order's
    // device_locked field MUST NOT flip — otherwise the UI lies to the operator
    // about whether the customer's phone was actually locked.
    const orderUpdate = supabaseAdmin.__dataStore.updates.find(u =>
      u.table === 'orders' && 'device_locked' in (u.patch || {}));
    expect(orderUpdate).toBeFalsy();

    // The device_lock_events row should record the failure (success=false)
    // so we still have an audit trail even though the order didn't flip.
    const lockEvent = supabaseAdmin.__dataStore.inserts.find(i =>
      i.table === 'device_lock_events' && i.row?.action === 'lock');
    expect(lockEvent).toBeTruthy();
    expect(lockEvent.row.success).toBe(false);
  });

  // Regression guard: a thrown exception from the FCM sender MUST mark the
  // command failed, not sent. (Earlier implementation left `fcmResult` at a
  // sentinel {noop:true} on throw, which tricked the success branch.)
  test('FCM throws → command is marked failed with the error', async () => {
    supabaseAdmin.__dataStore.setFixture('devices', {
      id: 'dev-1', order_id: order.id, branch_id: order.branch_id,
      fcm_token: 'fcm-abc', device_secret: '0'.repeat(62) + '01', status: 'active',
    });
    sendCommand.mockRejectedValueOnce(new Error('boom: FCM threw'));

    await issueCommand({ order, action: 'lock' });

    const failedUpdate = supabaseAdmin.__dataStore.updates.find(u =>
      u.table === 'device_commands' && u.patch.status === 'failed');
    const sentUpdate = supabaseAdmin.__dataStore.updates.find(u =>
      u.table === 'device_commands' && u.patch.status === 'sent');

    expect(sentUpdate).toBeFalsy();
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate.patch.error).toMatch(/boom/);
  });

  test('invalid action throws before any DB write', async () => {
    supabaseAdmin.__dataStore.setFixture('devices', {
      id: 'dev-1', order_id: order.id, branch_id: order.branch_id,
      fcm_token: 'fcm-abc', device_secret: '0'.repeat(62) + '01', status: 'active',
    });
    await expect(issueCommand({ order, action: 'reboot' })).rejects.toThrow(/invalid action/);
    expect(supabaseAdmin.__dataStore.inserts).toHaveLength(0);
  });

  test('ping action does NOT touch orders.device_locked or write a lock event', async () => {
    supabaseAdmin.__dataStore.setFixture('devices', {
      id: 'dev-1', order_id: order.id, branch_id: order.branch_id,
      fcm_token: 'fcm-abc', device_secret: '0'.repeat(62) + '01', status: 'active',
    });
    await issueCommand({ order, action: 'ping' });
    const orderUpdate = supabaseAdmin.__dataStore.updates.find(u => u.table === 'orders');
    expect(orderUpdate).toBeUndefined();
    const evInsert = supabaseAdmin.__dataStore.inserts.find(i => i.table === 'device_lock_events');
    expect(evInsert).toBeUndefined();
  });
});
