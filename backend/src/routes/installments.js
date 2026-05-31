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

router.get('/', async (req, res) => {
  let q = supabaseAdmin
    .from('installments')
    .select('*, orders!inner(id, order_no, branch_id, customer_id, customers(customer_name, account_no, phone_1))')
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

  const paidAmt = Number(amount_paid);
  if (paidAmt < 0) return res.status(400).json({ error: 'amount_paid must be >= 0' });

  const { data: inst, error: instErr } = await supabaseAdmin
    .from('installments').select('*, orders(branch_id)').eq('id', id).single();
  if (instErr || !inst) return res.status(404).json({ error: 'Installment not found' });
  if (req.user.role === 'operator' && inst.orders.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (inst.status === 'paid') {
    return res.status(409).json({ error: 'This installment is already fully paid' });
  }

  const due = Number(inst.amount_due);
  const fineAmt = Number(fine || 0);
  const discAmt = Number(discount || 0);
  const netDue = Math.max(0, due + fineAmt - discAmt);

  let status = 'partial';
  if (paidAmt >= netDue) status = 'paid';
  else if (paidAmt <= 0) status = 'pending';

  const { data, error } = await supabaseAdmin
    .from('installments')
    .update({
      amount_paid: paidAmt,
      payment_date: payment_date || dayjs().format('YYYY-MM-DD'),
      receipt_no: receipt_no || genReceiptNo(),
      fine: fineAmt,
      discount: discAmt,
      status,
      remarks,
      collected_by: req.user.id,
    })
    .eq('id', id).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // Re-evaluate order completion using actual money paid vs. due, not just status
  const { data: siblings } = await supabaseAdmin
    .from('installments')
    .select('amount_due, amount_paid, fine, discount')
    .eq('order_id', inst.order_id);

  const fullyPaid = (siblings || []).every(s => {
    const sDue = Math.max(0, Number(s.amount_due || 0) + Number(s.fine || 0) - Number(s.discount || 0));
    return Number(s.amount_paid || 0) >= sDue;
  });
  if (fullyPaid && siblings && siblings.length > 0) {
    await supabaseAdmin.from('orders').update({ status: 'completed' }).eq('id', inst.order_id);
  }

  await logActivity({
    userId: req.user.id, branchId: inst.orders.branch_id, action: 'record_payment',
    entityType: 'installment', entityId: id,
    details: { amount_paid: paidAmt, receipt_no: data.receipt_no, status }, req,
  });

  // Auto-unlock: if this order is currently locked AND every installment is
  // now fully paid OR no overdue balance remains, fire an unlock command in
  // the background. Fire-and-forget so the payment response stays fast.
  (async () => {
    try {
      const { data: order } = await supabaseAdmin
        .from('orders').select('*').eq('id', inst.order_id).single();
      if (!order?.device_locked) return;

      const today = dayjs().format('YYYY-MM-DD');
      const stillOverdue = (siblings || []).some(s => {
        const sDue = Math.max(0, Number(s.amount_due || 0) + Number(s.fine || 0) - Number(s.discount || 0));
        const paid = Number(s.amount_paid || 0);
        // Treat "overdue" as: unpaid AND we are past due date. We don't have
        // due_date in `siblings`, so be conservative: require ZERO unpaid
        // balance before auto-unlock.
        return paid < sDue;
      });
      // Strictly: auto-unlock only when balance is zero. Looser policies can be
      // added later behind a branch-level setting.
      if (stillOverdue) return;

      await issueCommand({
        order,
        action: 'unlock',
        reason: 'auto-unlock: balance cleared',
        issued_by: req.user.id,
      });
    } catch (e) {
      console.warn('[installments/pay] auto-unlock failed:', e.message);
    }
  })();

  res.json(data);
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
