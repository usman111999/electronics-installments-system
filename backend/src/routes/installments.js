const express = require('express');
const dayjs = require('dayjs');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch, scopeCompany } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');
const { issueCommand } = require('../services/deviceCommands');
const { ensureDueInvoices, applyAdvance, recomputeOrderStatus, buildNextRow } = require('../services/installmentEngine');

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
    .select('*, orders!inner(id, order_no, branch_id, company_id, customer_id, total_installments, branches(name), customers(id, customer_name, account_no, phone_1, picture_url))')
    .order('due_date', { ascending: true });

  if (req.user.role === 'customer') {
    const { data: cust } = await supabaseAdmin
      .from('customers').select('id').eq('profile_id', req.user.id).maybeSingle();
    if (!cust) return res.json([]);
    q = q.eq('orders.customer_id', cust.id);
  } else {
    const cScope = scopeCompany(req);
    if (cScope) q = q.eq('orders.company_id', cScope);
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
  const payCScope = scopeCompany(req);
  if (payCScope && order.company_id !== payCScope) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const payScope = scopeBranch(req);
  if (payScope && order.branch_id !== payScope) {
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

  // The NEXT invoice is NOT created automatically here. The operator generates
  // it on demand via POST /installments/next (a button on the order page), so
  // there's never a surprise pending invoice right after a payment.

  // Order completion is derived by the shared engine helper (single source of
  // truth so /pay, /advance and edit/delete never disagree). siblings is also
  // used by the auto-unlock check below.
  const { data: siblings } = await supabaseAdmin
    .from('installments')
    .select('amount_due, amount_paid, status')
    .eq('order_id', inst.order_id);
  await recomputeOrderStatus(inst.order_id, order);

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

  res.json(updated);
});

// Generate the NEXT invoice for an order, on demand (the "Generate next invoice"
// button). Requires the current invoice to be fully paid first, and stops when
// the plan length is reached or the balance is cleared.
router.post('/next', requirePermission('installments.record_payment'), async (req, res) => {
  const orderId = req.body?.order_id;
  if (!orderId) return res.status(400).json({ error: 'order_id required' });

  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const nextCScope = scopeCompany(req);
  if (nextCScope && order.company_id !== nextCScope) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const nextScope = scopeBranch(req);
  if (nextScope && order.branch_id !== nextScope) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: allInst } = await supabaseAdmin
    .from('installments').select('*').eq('order_id', orderId).order('installment_no', { ascending: true });

  if ((allInst || []).length >= Number(order.total_installments)) {
    return res.status(409).json({ error: 'All invoices for this plan have already been created.' });
  }
  const last = (allInst || [])[allInst.length - 1];
  if (last && last.status !== 'paid') {
    return res.status(409).json({ error: 'Mark the current invoice as paid before generating the next one.' });
  }

  const sumDue = (allInst || []).reduce((s, x) => s + Number(x.amount_due || 0), 0);
  // Use the shared engine builder so the due date is anchored to order_date +
  // month number (same as accrual) — never to the payment date, which caused
  // invoices to bunch onto the same due date.
  const row = buildNextRow(order, (last?.installment_no || 0) + 1, sumDue);
  if (!row) {
    return res.status(409).json({ error: 'Nothing left to bill — the balance is already cleared.' });
  }
  const { _due, ...insert } = row;
  const status = _due.isBefore(dayjs(), 'day') ? 'overdue' : 'pending';
  const { data: created, error } = await supabaseAdmin.from('installments')
    .insert({ ...insert, status }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await logActivity({
    userId: req.user.id, branchId: order.branch_id, action: 'create_installment',
    entityType: 'installment', entityId: created.id,
    details: { order_id: orderId, installment_no: created.installment_no }, req,
  });
  res.status(201).json(created);
});

// Collect an advance across one or more upcoming months. Creates/updates the
// invoices in sequence and distributes the amount (engine guarantees no
// overpay, no gaps, no duplicates). Reflects on the order totals immediately.
router.post('/advance', requirePermission('installments.record_payment'), async (req, res) => {
  const { order_id, months, amount } = req.body || {};
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { data: order } = await supabaseAdmin.from('orders').select('branch_id, company_id').eq('id', order_id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const advCScope = scopeCompany(req);
  if (advCScope && order.company_id !== advCScope) return res.status(403).json({ error: 'Forbidden' });
  const scope = scopeBranch(req);
  if (scope && order.branch_id !== scope) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await applyAdvance(order_id, months, amount, req.user.id);
    await logActivity({
      userId: req.user.id, branchId: order.branch_id, action: 'advance_payment',
      entityType: 'order', entityId: order_id,
      details: { months: Number(months), amount: Number(amount), ...result }, req,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/mark-overdue', requirePermission('installments.record_payment'), async (req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  let q = supabaseAdmin
    .from('installments')
    .update({ status: 'overdue' })
    .lt('due_date', today)
    .in('status', ['pending', 'partial']);

  // Company/branch-scoped users only flip overdue status within their own scope.
  const cScope = scopeCompany(req);
  const scope = scopeBranch(req);
  if (cScope || scope) {
    let oq = supabaseAdmin.from('orders').select('id');
    if (cScope) oq = oq.eq('company_id', cScope);
    if (scope) oq = oq.eq('branch_id', scope);
    const { data: ordersInScope } = await oq;
    const ids = (ordersInScope || []).map(o => o.id);
    if (!ids.length) return res.json({ updated: 0 });
    q = q.in('order_id', ids);
  }

  const { data, error } = await q.select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ updated: data?.length || 0 });
});

// Edit an installment / its payment. Recomputes status and the order status.
// amount_due (the financed chain) is intentionally NOT editable here.
router.patch('/:id', requirePermission('installments.record_payment'), async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  const { data: inst, error: instErr } = await supabaseAdmin
    .from('installments').select('*, orders(*)').eq('id', id).single();
  if (instErr || !inst) return res.status(404).json({ error: 'Installment not found' });
  const order = inst.orders;
  const cScope = scopeCompany(req);
  if (cScope && order.company_id !== cScope) return res.status(403).json({ error: 'Forbidden' });
  const scope = scopeBranch(req);
  if (scope && order.branch_id !== scope) return res.status(403).json({ error: 'Forbidden' });

  const amountPaid = body.amount_paid != null ? Number(body.amount_paid) : Number(inst.amount_paid || 0);
  if (!(amountPaid >= 0)) return res.status(400).json({ error: 'amount_paid must be >= 0' });
  const fineAmt = body.fine != null ? Number(body.fine) : Number(inst.fine || 0);
  const discAmt = body.discount != null ? Number(body.discount) : Number(inst.discount || 0);
  const dueDate = body.due_date || inst.due_date;
  const remarks = body.remarks !== undefined ? body.remarks : inst.remarks;
  const reqReceipt = body.receipt_no !== undefined ? body.receipt_no : inst.receipt_no;
  const reqPayDate = body.payment_date !== undefined ? body.payment_date : inst.payment_date;

  const netDue = Math.max(0, Number(inst.amount_due) + fineAmt - discAmt);
  let status;
  if (amountPaid >= netDue && amountPaid > 0) status = 'paid';
  else if (amountPaid <= 0) status = 'pending';
  else status = 'partial';
  if (status === 'pending' && dueDate && dayjs(dueDate).isBefore(dayjs(), 'day')) status = 'overdue';

  const { data: updated, error } = await supabaseAdmin
    .from('installments')
    .update({
      amount_paid: amountPaid,
      fine: fineAmt,
      discount: discAmt,
      due_date: dueDate,
      remarks,
      status,
      // payment fields only make sense when something is paid
      payment_date: amountPaid > 0 ? (reqPayDate || dayjs().format('YYYY-MM-DD')) : null,
      receipt_no: amountPaid > 0 ? (reqReceipt || inst.receipt_no || genReceiptNo()) : null,
    })
    .eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await recomputeOrderStatus(inst.order_id, order);
  await logActivity({
    userId: req.user.id, branchId: order.branch_id, action: 'edit_installment',
    entityType: 'installment', entityId: id, details: { amount_paid: amountPaid, status, due_date: dueDate }, req,
  });
  res.json(updated);
});

// Delete an installment — only the most recent one for the order, so the running
// balance and installment numbering stay consistent.
router.delete('/:id', requirePermission('installments.record_payment'), async (req, res) => {
  const { id } = req.params;
  const { data: inst, error: instErr } = await supabaseAdmin
    .from('installments').select('*, orders(*)').eq('id', id).single();
  if (instErr || !inst) return res.status(404).json({ error: 'Installment not found' });
  const order = inst.orders;
  const cScope = scopeCompany(req);
  if (cScope && order.company_id !== cScope) return res.status(403).json({ error: 'Forbidden' });
  const scope = scopeBranch(req);
  if (scope && order.branch_id !== scope) return res.status(403).json({ error: 'Forbidden' });

  // Any installment can be deleted. Totals are always derived from the rows that
  // remain, so collected/remaining/paid-count stay correct. The deleted amount
  // simply becomes un-billed again and the engine will re-bill it on a later
  // month (or via Generate now / Advance).
  const { error: delErr } = await supabaseAdmin.from('installments').delete().eq('id', id);
  if (delErr) return res.status(400).json({ error: delErr.message });

  await recomputeOrderStatus(inst.order_id, order);
  await logActivity({
    userId: req.user.id, branchId: order.branch_id, action: 'delete_installment',
    entityType: 'installment', entityId: id, details: { installment_no: inst.installment_no }, req,
  });
  res.json({ ok: true });
});

module.exports = router;
