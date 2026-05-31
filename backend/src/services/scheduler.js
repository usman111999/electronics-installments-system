const cron = require('node-cron');
const dayjs = require('dayjs');
const { supabaseAdmin } = require('../config/supabase');
const { sendWhatsApp } = require('./whatsapp');

function buildReminderMessage({ customerName, amount, dueDate, accountNo }) {
  const due = dayjs(dueDate);
  return (
`Assalam o Alaikum ${customerName || 'Customer'},

This is a reminder from Electronics Installments System.
Your installment of Rs. ${Number(amount).toLocaleString()} for account #${accountNo || '-'} ` +
`is pending (due ${due.format('DD MMM YYYY')}).
Please pay on or before day ${due.date()} of the month to avoid any fines.

Thank you.`
  );
}

// Sends WhatsApp reminders for any unpaid installment whose due_date is in the
// current month and today is day 1–5 of the month. Runs every day at 09:30.
async function runReminderJob() {
  const today = dayjs();
  const dom = today.date();
  if (dom > 5) {
    console.log(`[scheduler] day ${dom} > 5, skipping reminder job`);
    return { skipped: true };
  }

  const monthStart = today.startOf('month').format('YYYY-MM-DD');
  const monthEnd = today.endOf('month').format('YYYY-MM-DD');

  const { data: insts, error } = await supabaseAdmin
    .from('installments')
    .select('id, installment_no, due_date, amount_due, amount_paid, status, order_id, orders(customer_id, customers(id, customer_name, account_no, phone_1))')
    .gte('due_date', monthStart)
    .lte('due_date', monthEnd)
    .in('status', ['pending', 'partial', 'overdue']);

  if (error) {
    console.error('[scheduler] fetch error', error.message);
    return { error: error.message };
  }

  let sent = 0, failed = 0;
  for (const inst of (insts || [])) {
    const customer = inst.orders?.customers;
    if (!customer || !customer.phone_1) continue;
    const remaining = Math.max(0, Number(inst.amount_due) - Number(inst.amount_paid || 0));
    if (remaining <= 0) continue;

    const message = buildReminderMessage({
      customerName: customer.customer_name,
      amount: remaining,
      dueDate: inst.due_date,
      accountNo: customer.account_no,
    });

    try {
      await sendWhatsApp({ phone: customer.phone_1, message });
      await supabaseAdmin.from('whatsapp_notifications').insert({
        customer_id: customer.id,
        installment_id: inst.id,
        phone: customer.phone_1,
        message,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
      sent++;
    } catch (e) {
      await supabaseAdmin.from('whatsapp_notifications').insert({
        customer_id: customer.id,
        installment_id: inst.id,
        phone: customer.phone_1,
        message,
        status: 'failed',
        error_message: e.message,
      });
      failed++;
    }
  }
  console.log(`[scheduler] reminders done — sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Auto-lock sweep — runs nightly at 02:00. Issues lock commands for every
// order on a branch where branch.auto_lock_days is set and the most-overdue
// installment crosses the threshold.
// ---------------------------------------------------------------------------
async function runAutoLockJob() {
  try {
    const { runAutoLockSweep } = require('../routes/devices');
    const result = await runAutoLockSweep({ dryRun: false });
    console.log('[scheduler] auto-lock sweep:', JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('[scheduler] auto-lock sweep failed:', e.message);
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Auto-lock 24h warning — runs daily at 09:00. WhatsApps customers whose
// most overdue installment is exactly `auto_lock_days - 1` days past due.
// ---------------------------------------------------------------------------
async function runAutoLockWarningJob() {
  const today = dayjs();
  const { data: branches } = await supabaseAdmin
    .from('branches').select('id, name, phone, auto_lock_days').not('auto_lock_days', 'is', null);

  let warned = 0;
  for (const branch of branches || []) {
    const days = Number(branch.auto_lock_days);
    if (!days || days < 1) continue;
    const warnDate = today.subtract(days - 1, 'day').format('YYYY-MM-DD');

    // Installments due exactly on warnDate that are still unpaid, in orders
    // that are not already locked and have a device.
    const { data: insts } = await supabaseAdmin
      .from('installments')
      .select('id, due_date, amount_due, amount_paid, orders!inner(id, order_no, branch_id, device_locked, customers(customer_name, phone_1))')
      .eq('due_date', warnDate)
      .eq('orders.branch_id', branch.id)
      .eq('orders.device_locked', false)
      .in('status', ['pending', 'partial', 'overdue']);

    for (const inst of insts || []) {
      const remaining = Number(inst.amount_due) - Number(inst.amount_paid || 0);
      if (remaining <= 0) continue;
      const cust = inst.orders?.customers;
      if (!cust?.phone_1) continue;

      // Require that the order has an enrolled device — otherwise the warning
      // is meaningless because there's nothing to auto-lock.
      const { data: device } = await supabaseAdmin
        .from('devices').select('id').eq('order_id', inst.orders.id)
        .in('status', ['active', 'offline']).maybeSingle();
      if (!device) continue;

      const msg =
`Assalam o Alaikum ${cust.customer_name || 'Customer'},

Your installment is overdue. If not paid within the next 24 hours your device will be automatically LOCKED.

Outstanding: Rs. ${Number(remaining).toLocaleString()}
Branch: ${branch.name}${branch.phone ? ' (' + branch.phone + ')' : ''}

Please pay today to avoid lock.

— Electronics Installments System`;

      try {
        await sendWhatsApp({ phone: cust.phone_1, message: msg });
        warned++;
      } catch (e) {
        console.warn('[scheduler] warning send failed', cust.phone_1, e.message);
      }
    }
  }
  console.log(`[scheduler] auto-lock warnings sent: ${warned}`);
  return { warned };
}

async function runOverdueMarker() {
  const today = dayjs().format('YYYY-MM-DD');
  const { data } = await supabaseAdmin
    .from('installments')
    .update({ status: 'overdue' })
    .lt('due_date', today)
    .in('status', ['pending', 'partial'])
    .select('id');
  console.log(`[scheduler] marked ${(data || []).length} installments overdue`);
}

function startScheduler() {
  // All cron times are in Pakistan time (Asia/Karachi, UTC+5). Without an
  // explicit tz, node-cron uses the host's local timezone — which is UTC on
  // Render/Railway/Vercel — so 09:30 would fire 5 hours late for Pakistani
  // customers. SCHEDULER_TZ env var lets you override per-deployment.
  const tz = process.env.SCHEDULER_TZ || 'Asia/Karachi';
  const opts = { timezone: tz };

  // Every day at 09:30 — send reminders on days 1–5
  cron.schedule('30 9 * * *', () => {
    console.log('[scheduler] running daily reminder job');
    runReminderJob().catch(e => console.error(e));
  }, opts);

  // Every day at 00:10 — mark overdue
  cron.schedule('10 0 * * *', () => {
    console.log('[scheduler] running overdue marker');
    runOverdueMarker().catch(e => console.error(e));
  }, opts);

  // Every day at 02:00 — auto-lock sweep (spec §8)
  cron.schedule('0 2 * * *', () => {
    console.log('[scheduler] running auto-lock sweep');
    runAutoLockJob().catch(e => console.error(e));
  }, opts);

  // Every day at 09:00 — "you will be locked in 24h" WhatsApp warnings
  cron.schedule('0 9 * * *', () => {
    console.log('[scheduler] running auto-lock warning job');
    runAutoLockWarningJob().catch(e => console.error(e));
  }, opts);

  console.log(`[scheduler] cron jobs registered (timezone: ${tz})`);
}

module.exports = {
  startScheduler,
  runReminderJob,
  runOverdueMarker,
  runAutoLockJob,
  runAutoLockWarningJob,
};
