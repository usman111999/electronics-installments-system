const express = require('express');
const dayjs = require('dayjs');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');
const { issueCommand } = require('../services/deviceCommands');

const router = express.Router();
router.use(authenticate);

function genReceiptNo() {
  return 'RCP' + Date.now().toString().slice(-9) + Math.floor(Math.random() * 90 + 10);
}

// Clamp due day so a 30/31-day choice doesn't overflow into the next month.
function clampDueDate(base, monthsAhead, requestedDay) {
  const target = base.add(monthsAhead, 'month').date(1);
  const lastDay = target.daysInMonth();
  return target.date(Math.min(Math.max(Number(requestedDay) || 1, 1), lastDay));
}

router.get('/', async (req, res) => {
  let q = supabaseAdmin
    .from('installments')
    .select('*, orders!inner(id, order_no, branch_id, customer_id, total_installments, branches(name), customers(customer_name, account_no, phone_1))')
    .order('due_date', { ascending: true });

  if (req.user.role === 'customer') {
    const { data: cust } = await supabaseAdmin
      .from('customers').select('id').eq('profile_id', req.user.id).maybeSingle();
    if (!cust) return res.json([]);
    q = q.eq('orders.customer_id', cust.id);
  } else {
    const scope = scopeBranch(req);
    if (scope) q = q.eq('orders.branch_id', scope);
    if (req.query.order_id) q = q.eq('order_id', req.query.order_id);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.due_from) q = q.gte('due_date', req.query.due_from);
    if (req.query.due_to) q = q.lte('due_date', req.query.due_to);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/:id/pay', requirePermission('installments.record_payment'), async (req, res) => {
  const { id } = req.params;
  const { amount_paid, payment_date, receipt_no, fine, discount, remarks } = req.body || {};
  if (amount_paid == null) return res.status(400).json({ error: 'amount_paid required' });

  const payNow = Number(amount_paid);
  if (!(payNow >= 0)) return res.status(400).json({ error: 'amount_paid must be >= 0' });

  const { data: inst, error: instErr } = await supabaseAdmin
    .from('installments').select('*, orders(*)').eq('id', id).single();
  if (instErr || !inst) return res.status(404).json({ error: 'Installment not found' });
  const order = inst.orders;
  if (req.user.role === 'operator' && order.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (inst.status === 'paid') {
    return res.status(409).json({ error: 'This installment is already fully paid' });
  }

  // Accumulate across partial collections so a customer can clear one invoice
  // in several payments. fine/discount take the newest provided value, else
  // keep what was already on the invoice.
  const fineAmt = fine != null ? Number(fine) : Number(inst.fine || 0);
  const discAmt = discount != null ? Number(discount) : Number(inst.discount || 0);
  const newPaid = Number(inst.amount_paid || 0) + payNow;
  const netDue = Math.max(0, Number(inst.amount_due) + fineAmt - discAmt);

  let status;
  if (newPaid >= netDue && newPaid > 0) status = 'paid';
  else if (newPaid <= 0) status = 'pending';
  else status = 'partial';

  // The payment date IS the date the operator marks it paid (or an explicit
  // backdate). Only stamp it once the invoice is actually (fully/partially) paid.
  const paidDate = payment_date || dayjs().format('YYYY-MM-DD');

  const { data: updated, error } = await supabaseAdmin
    .from('installments')
    .update({
      amount_paid: newPaid,
      payment_date: paidDate,
      receipt_no: inst.receipt_no || receipt_no || genReceiptNo(),
      fine: fineAmt,
      discount: discAmt,
      status,
      remarks: remarks ?? inst.remarks,
      collected_by: req.user.id,
    })
    .eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Rolling generation: when this invoice is fully paid, open the NEXT one
  // (one month on from the payment date). Skip when the plan is finished or the
  // balance is cleared, and never duplicate an existing next invoice.
  let nextInstallment = null;
  if (status === 'paid') {
    const { data: allInst } = await supabaseAdmin
      .from('installments').select('installment_no, amount_due').eq('order_id', inst.order_id);
    const createdCount = (allInst || []).length;
    const sumDue = (allInst || []).reduce((s, x) => s + Number(x.amount_due || 0), 0);
    const totalToPay = Number(order.total_price) - Number(order.advance_payment || 0) - Number(order.discount || 0);
    const remaining = Math.round((totalToPay - sumDue) * 100) / 100;
    const maxNo = (allInst || []).reduce((m, x) => Math.max(m, x.installment_no), 0);

    if (createdCount < Number(order.total_installments) && remaining > 0.009) {
      const nextAmt = Math.min(Number(order.installment_amount), remaining);
      const nextDue = clampDueDate(dayjs(paidDate), 1, order.due_day || 5);
      const { data: created } = await supabaseAdmin.from('installments').insert({
        order_id: inst.order_id,
        installment_no: maxNo + 1,
        due_date: nextDue.format('YYYY-MM-DD'),
        amount_due: nextAmt,
        pre_balance: remaining,
        balance: Math.max(0, remaining - nextAmt),
        status: 'pending',
        recovery_officer: order.recovery_officer || null,
      }).select().single();
      nextInstallment = created || null;
    }
  }

  // Order completion: every created invoice paid AND nothing left to bill
  // (either the plan length is reached or the balance is cleared).
  const { data: siblings } = await supabaseAdmin
    .from('installments')
    .select('amount_due, amount_paid, status')
    .eq('order_id', inst.order_id);
  const allPaid = (siblings || []).length > 0 && (siblings || []).every(s => s.status === 'paid');
  const sumDueAll = (siblings || []).reduce((s, x) => s + Number(x.amount_due || 0), 0);
  const totalToPay2 = Number(order.total_price) - Number(order.advance_payment || 0) - Number(order.discount || 0);
  const nothingLeft = (siblings || []).length >= Number(order.total_installments) || (totalToPay2 - sumDueAll) <= 0.009;
  if (allPaid && nothingLeft) {
    await supabaseAdmin.from('orders').update({ status: 'completed' }).eq('id', inst.order_id);
  }

  await logActivity({
    userId: req.user.id, branchId: order.branch_id, action: 'record_payment',
    entityType: 'installment', entityId: id,
    details: { amount_paid: payNow, total_paid: newPaid, receipt_no: updated.receipt_no, status }, req,
  });

  // Auto-unlock: if the device is locked and the customer is no longer behind
  // (this invoice paid, no other overdue/partial invoice), unlock in the
  // background. The freshly created "next" invoice is future-dated/pending and
  // does not count as overdue. Fire-and-forget so the response stays fast.
  (async () => {
    try {
      if (!order?.device_locked) return;
      const behind = (siblings || []).some(s => s.status === 'overdue' || s.status === 'partial');
      if (status !== 'paid' || behind) return;
      await issueCommand({
        order,
        action: 'unlock',
        reason: 'auto-unlock: current invoice cleared',
        issued_by: req.user.id,
      });
    } catch (e) {
      console.warn('[installments/pay] auto-unlock failed:', e.message);
    }
  })();

  res.json({ ...updated, next_installment: nextInstallment });
});

router.post('/mark-overdue', requirePermission('installments.record_payment'), async (_req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  const { data, error } = await supabaseAdmin
    .from('installments')
    .update({ status: 'overdue' })
    .lt('due_date', today)
    .in('status', ['pending', 'partial'])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ updated: data?.length || 0 });
});

module.exports = router;
