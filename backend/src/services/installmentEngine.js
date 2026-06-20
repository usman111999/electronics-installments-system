// Installment engine — the single source of truth for creating invoices and
// applying advance payments. Used by the installments routes, the order detail
// route (lazy catch-up) and the daily cron. Keeping this logic in one place is
// what prevents the schedule from ever drifting or duplicating.

const dayjs = require('dayjs');
const { supabaseAdmin } = require('../config/supabase');

function clampDueDate(base, monthsAhead, requestedDay) {
  const target = base.add(monthsAhead, 'month').date(1);
  const lastDay = target.daysInMonth();
  return target.date(Math.min(Math.max(Number(requestedDay) || 1, 1), lastDay));
}

function genReceiptNo() {
  return 'RCP' + Date.now().toString().slice(-9) + Math.floor(Math.random() * 90 + 10);
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Amount to collect across the whole plan via installments (advance + discount
// are taken off the top, never billed).
function financedTotal(order) {
  return Math.max(0, Number(order.total_price) - Number(order.advance_payment || 0) - Number(order.discount || 0));
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Re-derive an order's status from its installments. Only toggles active <->
// completed; never touches a cancelled order.
async function recomputeOrderStatus(orderId, order) {
  const ord = order || (await supabaseAdmin.from('orders').select('*').eq('id', orderId).single()).data;
  if (!ord || (ord.status !== 'active' && ord.status !== 'completed')) return;
  const { data: sibs } = await supabaseAdmin
    .from('installments').select('amount_due, status').eq('order_id', orderId);
  const list = sibs || [];
  const allPaid = list.length > 0 && list.every(s => s.status === 'paid');
  const sumDue = list.reduce((s, x) => s + Number(x.amount_due || 0), 0);
  const nothingLeft = list.length >= Number(ord.total_installments) || (financedTotal(ord) - sumDue) <= 0.009;
  const newStatus = (allPaid && nothingLeft) ? 'completed' : 'active';
  if (newStatus !== ord.status) {
    await supabaseAdmin.from('orders').update({ status: newStatus }).eq('id', orderId);
  }
}

// Build the row for the next installment number given how much is already billed.
function buildNextRow(order, nextNo, alreadyBilled) {
  const financed = financedTotal(order);
  const remaining = round2(financed - alreadyBilled);
  if (remaining <= 0.009) return null;
  const per = Number(order.installment_amount || 0);
  const amt = round2(Math.min(per > 0 ? per : remaining, remaining));
  const due = clampDueDate(dayjs(order.order_date), nextNo, order.due_day || 5);
  return {
    order_id: order.id,
    installment_no: nextNo,
    due_date: due.format('YYYY-MM-DD'),
    amount_due: amt,
    pre_balance: remaining,
    balance: Math.max(0, round2(remaining - amt)),
    recovery_officer: order.recovery_officer || null,
    _due: due,
  };
}

// Create every invoice whose due-month has already started but which doesn't
// exist yet. Idempotent — only ever inserts missing rows, never edits existing
// ones. Returns the number created.
async function ensureDueInvoices(orderId, opts = {}) {
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single();
  // Only accrue for active orders — never a cancelled or already-completed one.
  if (!order || order.status !== 'active') return 0;
  const N = Number(order.total_installments || 0);
  if (!N) return 0;

  const { data: existing } = await supabaseAdmin
    .from('installments').select('installment_no, amount_due').eq('order_id', orderId)
    .order('installment_no', { ascending: true });
  const list = existing || [];

  let billed = list.reduce((s, i) => s + Number(i.amount_due || 0), 0);
  let lastNo = list.reduce((m, i) => Math.max(m, i.installment_no || 0), 0);
  const today = opts.asOf ? dayjs(opts.asOf) : dayjs();

  let created = 0;
  for (let k = lastNo + 1; k <= N; k++) {
    const row = buildNextRow(order, k, billed);
    if (!row) break;                                   // balance fully billed
    // Only create once the due-month has begun (1st of that month <= today).
    if (row._due.date(1).isAfter(today, 'day')) break; // future month — stop
    const status = row._due.isBefore(today, 'day') ? 'overdue' : 'pending';
    const { _due, ...insert } = row;
    const { error } = await supabaseAdmin.from('installments').insert({ ...insert, status });
    if (error) throw httpErr(400, error.message);
    billed = round2(billed + insert.amount_due);
    created++;
  }
  if (created) await recomputeOrderStatus(orderId, order);
  return created;
}

// Collect an advance: fill unpaid existing invoices first, then create upcoming
// ones in sequence up to `months`, distributing `amount` (each Paid, the last
// Partial/Pending if the amount runs out). Never overpays beyond what's owed.
async function applyAdvance(orderId, months, amount, userId) {
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single();
  if (!order) throw httpErr(404, 'Order not found');
  if (order.status === 'cancelled') throw httpErr(409, 'Order is cancelled');

  const N = Number(order.total_installments || 0);
  const m = Math.max(1, Math.floor(Number(months) || 1));
  let amountLeft = Number(amount);
  if (!(amountLeft > 0)) throw httpErr(400, 'Advance amount must be greater than 0');

  const { data: existing } = await supabaseAdmin
    .from('installments').select('*').eq('order_id', orderId)
    .order('installment_no', { ascending: true });
  const list = existing || [];
  let billed = list.reduce((s, i) => s + Number(i.amount_due || 0), 0);
  let lastNo = list.reduce((mx, i) => Math.max(mx, i.installment_no || 0), 0);

  // Walk existing unpaid invoices first, then create upcoming ones ON DEMAND —
  // only while there's money left to put on them. This guarantees we never
  // pre-create unfunded future invoices, never overpay, and never bill past the
  // financed total or the plan length.
  const unpaid = list.filter(i => i.status !== 'paid');
  const today = dayjs().format('YYYY-MM-DD');
  let applied = 0;
  let monthsUsed = 0;
  let idx = 0;

  while (monthsUsed < m && amountLeft > 0.009) {
    let inst;
    if (idx < unpaid.length) {
      inst = unpaid[idx++];
    } else {
      if (lastNo >= N) break;                          // plan length reached
      const row = buildNextRow(order, lastNo + 1, billed);
      if (!row) break;                                 // balance fully billed
      const { _due, ...insert } = row;
      const { data: createdRow, error } = await supabaseAdmin
        .from('installments').insert({ ...insert, status: 'pending' }).select().single();
      if (error) throw httpErr(400, error.message);
      inst = createdRow;
      lastNo += 1;
      billed = round2(billed + insert.amount_due);
    }

    const netDue = Math.max(0, Number(inst.amount_due) + Number(inst.fine || 0) - Number(inst.discount || 0));
    const already = Number(inst.amount_paid || 0);
    const room = Math.max(0, round2(netDue - already));
    if (room <= 0) continue;                           // nothing owed on this one
    const pay = Math.min(amountLeft, room);
    const newPaid = round2(already + pay);
    const status = newPaid >= netDue ? 'paid' : 'partial';
    const { error } = await supabaseAdmin.from('installments').update({
      amount_paid: newPaid,
      status,
      payment_date: today,
      receipt_no: inst.receipt_no || genReceiptNo(),
      collected_by: userId,
    }).eq('id', inst.id);
    if (error) throw httpErr(400, error.message);
    applied = round2(applied + pay);
    amountLeft = round2(amountLeft - pay);
    monthsUsed += 1;
  }

  await recomputeOrderStatus(orderId, order);
  return { applied, leftover: round2(Math.max(0, amountLeft)), monthsTargeted: monthsUsed };
}

module.exports = {
  clampDueDate,
  genReceiptNo,
  financedTotal,
  buildNextRow,
  recomputeOrderStatus,
  ensureDueInvoices,
  applyAdvance,
};
