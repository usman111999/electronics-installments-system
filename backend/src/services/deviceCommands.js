// High-level "issue a lock/unlock/ping command for this order's device" service.
// Owns:
//   • picking the right device row
//   • building & HMAC-signing the FCM data payload (spec section 4)
//   • persisting device_commands + device_lock_events
//   • updating orders.device_locked* fields
//   • firing customer + branch WhatsApp notices on lock

const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/supabase');
const { signServerCommand } = require('./deviceHmac');
const { sendCommand: sendFcm } = require('./fcm');
const { sendWhatsApp } = require('./whatsapp');
const { logActivity } = require('./activityLog');

function buildLockMessageForCustomer({ customerName, branchPhone, lockMessage }) {
  return (
`Assalam o Alaikum ${customerName || 'Customer'},

Your device has been locked due to overdue installments.
${lockMessage ? '\n' + lockMessage + '\n' : ''}
Please contact your branch on ${branchPhone || 'the shop number'} ` +
`to clear the outstanding balance and unlock the device.

— Electronics Installments System`
  );
}

async function findDeviceForOrder(orderId) {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .select('*')
    .eq('order_id', orderId)
    .in('status', ['active', 'offline'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Issue a command (lock|unlock|ping) for the given order's device.
 *
 * @param {object} args
 * @param {object} args.order        — full orders row (must include id, branch_id, customer_id)
 * @param {'lock'|'unlock'|'ping'} args.action
 * @param {string} [args.reason]
 * @param {string} [args.lock_message]
 * @param {string} [args.issued_by]  — profile id of the operator (null for cron)
 * @param {object} [args.req]        — express req for activity logging
 */
async function issueCommand({ order, action, reason, lock_message, issued_by, req }) {
  if (!order?.id) throw new Error('order required');
  if (!['lock', 'unlock', 'ping'].includes(action)) throw new Error('invalid action');

  const device = await findDeviceForOrder(order.id);
  if (!device) {
    throw new Error('No active device enrolled for this order');
  }

  const command_id = uuidv4();
  const issued_at = new Date().toISOString();
  const hmac = signServerCommand(device.device_secret, { command_id, action, issued_at });

  const payload = {
    type: 'command',
    action,
    command_id,
    issued_at,
    reason: reason || '',
    lock_message: lock_message || '',
    hmac,
  };

  // Insert command row first so we always have a record even if FCM fails
  const { data: cmdRow, error: cmdErr } = await supabaseAdmin
    .from('device_commands')
    .insert({
      device_id: device.id,
      command_id,
      action,
      reason: reason || null,
      lock_message: lock_message || null,
      payload,
      status: 'queued',
      issued_at,
      issued_by: issued_by || null,
    })
    .select()
    .single();
  if (cmdErr) throw new Error(cmdErr.message);

  // Fire the FCM push. We seed fcmResult to null so a thrown exception cannot
  // leave the stale {noop:true} default in place and trick the success branch.
  let fcmResult = null;
  let fcmError = null;
  try {
    fcmResult = await sendFcm({ fcm_token: device.fcm_token, payload });
  } catch (e) {
    fcmError = e.message;
    fcmResult = { ok: false, error: e.message };
  }

  if (fcmResult?.ok || fcmResult?.noop) {
    await supabaseAdmin
      .from('device_commands')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', cmdRow.id);
  } else {
    await supabaseAdmin
      .from('device_commands')
      .update({ status: 'failed', error: fcmError || fcmResult?.error || 'unknown' })
      .eq('id', cmdRow.id);
  }

  // Persist the high-level lock/unlock state on the order itself, but only for
  // real lock/unlock commands (ping is a heartbeat probe and shouldn't flip
  // device_locked).
  const dispatched = !!(fcmResult?.ok || fcmResult?.noop);
  if (action === 'lock' || action === 'unlock') {
    // Only flip the order's lock state when the dispatch actually went out.
    // If FCM rejected the command we keep the previous state — otherwise the
    // UI would show "Locked" while the customer's phone never received the
    // command, and the lock-notice WhatsApp below would be a lie.
    if (dispatched) {
      const orderUpdate = action === 'lock'
        ? { device_locked: true, device_locked_at: issued_at, device_lock_reason: reason || null, device_lock_provider: 'fcm' }
        : { device_locked: false, device_unlocked_at: issued_at };
      await supabaseAdmin.from('orders').update(orderUpdate).eq('id', order.id);
    }

    await supabaseAdmin.from('device_lock_events').insert({
      order_id: order.id,
      action,
      reason: reason || null,
      triggered_by: issued_by || null,
      provider: 'fcm',
      provider_response: { command_id, fcm: fcmResult },
      success: dispatched,
      error_message: fcmError || fcmResult?.error || null,
    });

    await logActivity({
      userId: issued_by || null,
      branchId: order.branch_id,
      action: action === 'lock' ? 'device_lock' : 'device_unlock',
      entityType: 'order',
      entityId: order.id,
      details: { command_id, reason, dispatched },
      req,
    });

    // Notify the customer on lock (best-effort, swallow errors). Only send when
    // the lock actually went out — telling them their phone is locked when it
    // isn't would be a worse experience than no message at all.
    if (action === 'lock' && dispatched) {
      try {
        const { data: cust } = await supabaseAdmin
          .from('customers').select('customer_name, phone_1').eq('id', order.customer_id).single();
        const { data: branch } = await supabaseAdmin
          .from('branches').select('phone').eq('id', order.branch_id).single();
        if (cust?.phone_1) {
          await sendWhatsApp({
            phone: cust.phone_1,
            message: buildLockMessageForCustomer({
              customerName: cust.customer_name,
              branchPhone: branch?.phone,
              lockMessage: lock_message,
            }),
          });
        }
      } catch (e) {
        console.warn('[deviceCommands] lock-notice WhatsApp failed:', e.message);
      }
    }
  }

  return { command: cmdRow, fcm: fcmResult };
}

module.exports = { issueCommand, findDeviceForOrder };
