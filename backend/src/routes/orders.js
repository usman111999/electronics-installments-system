const express = require('express');
const dayjs = require('dayjs');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');
const { issueCommand } = require('../services/deviceCommands');

const router = express.Router();
router.use(authenticate);

function genOrderNo() {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `ORD-${ts}-${rand}`;
}

// Clamp due_day so a 30/31-day choice doesn't overflow into next month
function clampDueDate(startDate, monthsAhead, requestedDay) {
  const target = startDate.add(monthsAhead, 'month').date(1);
  const lastDay = target.daysInMonth();
  return target.date(Math.min(requestedDay, lastDay));
}

router.get('/', async (req, res) => {
  let q = supabaseAdmin
    .from('orders')
    .select('*, customers(id, customer_name, account_no, phone_1), products(id, name, model), branches(id, name)')
    .order('created_at', { ascending: false });

  if (req.user.role === 'customer') {
    const { data: cust } = await supabaseAdmin
      .from('customers').select('id').eq('profile_id', req.user.id).maybeSingle();
    if (!cust) return res.json([]);
    q = q.eq('customer_id', cust.id);
  } else {
    const scope = scopeBranch(req);
    if (scope) q = q.eq('branch_id', scope);
    if (req.query.branch_id && req.user.role === 'admin') q = q.eq('branch_id', req.query.branch_id);
    if (req.query.customer_id) q = q.eq('customer_id', req.query.customer_id);
    if (req.query.status) q = q.eq('status', req.query.status);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, customers(*, guarantors(*)), products(*), branches(*), installments(*)')
    .eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: error.message });

  if (data?.installments) data.installments.sort((a, b) => a.installment_no - b.installment_no);

  if (req.user.role === 'operator' && data.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.user.role === 'customer' && data.customers?.profile_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(data);
});

router.post('/', requirePermission('orders.create'), async (req, res) => {
  const b = req.body || {};
  const isManager = req.user.role === 'admin' || req.user.role === 'super_admin';
  const branch_id = isManager ? (b.branch_id || req.user.branch_id) : req.user.branch_id;

  if (!branch_id) return res.status(400).json({ error: 'branch_id required' });
  if (!b.customer_id) return res.status(400).json({ error: 'customer_id required' });
  if (!b.total_price || !b.installment_amount || !b.total_installments) {
    return res.status(400).json({ error: 'total_price, installment_amount, total_installments required' });
  }

  if (req.user.role === 'operator') {
    const { data: cust } = await supabaseAdmin
      .from('customers').select('branch_id').eq('id', b.customer_id).single();
    if (!cust || cust.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Customer not in your branch' });
    }
  }

  // If an inventory item was chosen, reserve it now to avoid double-sell.
  // We do this BEFORE creating the order, so a concurrent order on the same
  // serial gets rejected at the inventory step rather than after the order is
  // already written.
  if (b.inventory_id) {
    const { data: invRow, error: invErr } = await supabaseAdmin
      .from('inventory')
      .update({ status: 'sold' })
      .eq('id', b.inventory_id)
      .eq('status', 'in_stock')
      .select()
      .maybeSingle();
    if (invErr) return res.status(400).json({ error: 'Inventory update failed: ' + invErr.message });
    if (!invRow) return res.status(409).json({ error: 'Selected inventory item is no longer available' });
  }

  let productSnap = { name: null, model: null, serial: null };
  if (b.product_id) {
    const { data: p } = await supabaseAdmin
      .from('products').select('name, model').eq('id', b.product_id).single();
    if (p) { productSnap.name = p.name; productSnap.model = p.model; }
  }
  if (b.inventory_id) {
    const { data: inv } = await supabaseAdmin
      .from('inventory').select('serial_no').eq('id', b.inventory_id).single();
    if (inv) productSnap.serial = inv.serial_no;
  }
  // Allow free-text overrides so any electronics item can be financed even when
  // it isn't in the catalog, and so the operator can refine the model/serial.
  if (b.product_name_snapshot) productSnap.name = b.product_name_snapshot;
  if (b.product_model_snapshot) productSnap.model = b.product_model_snapshot;
  if (b.product_serial_snapshot) productSnap.serial = b.product_serial_snapshot;

  const order_no = b.order_no || genOrderNo();
  const order_date = b.order_date || dayjs().format('YYYY-MM-DD');
  const due_day = Math.min(Math.max(Number(b.due_day) || 5, 1), 28); // hard cap at 28 to avoid month-end overflow

  const { data: order, error: orderErr } = await supabaseAdmin.from('orders').insert({
    order_no,
    customer_id: b.customer_id,
    branch_id,
    product_id: b.product_id || null,
    inventory_id: b.inventory_id || null,
    product_name_snapshot: productSnap.name,
    product_model_snapshot: productSnap.model,
    product_serial_snapshot: productSnap.serial,
    accessories: b.accessories || null,
    order_date,
    total_price: b.total_price,
    advance_payment: b.advance_payment || 0,
    discount: b.discount || 0,
    installment_amount: b.installment_amount,
    total_installments: b.total_installments,
    duration_months: b.duration_months || b.total_installments,
    due_day,
    recovery_officer: b.recovery_officer || null,
    notes: b.notes || null,
    created_by: req.user.id,
  }).select().single();

  if (orderErr) {
    // Roll back the inventory reservation if order insert failed
    if (b.inventory_id) {
      await supabaseAdmin.from('inventory').update({ status: 'in_stock' }).eq('id', b.inventory_id);
    }
    return res.status(400).json({ error: orderErr.message });
  }

  // Rolling installment model: create only the FIRST invoice now. The next
  // installment is generated when the current one is fully paid (see
  // installments POST /:id/pay). This keeps the customer on a single active
  // invoice at a time instead of a pre-built full-year schedule.
  const totalRemainingToPay = Number(b.total_price) - Number(b.advance_payment || 0) - Number(b.discount || 0);
  const orderStart = dayjs(order_date);
  const firstAmt = Math.min(Number(b.installment_amount), Math.max(0, totalRemainingToPay));

  if (totalRemainingToPay > 0 && Number(b.total_installments) > 0) {
    await supabaseAdmin.from('installments').insert({
      order_id: order.id,
      installment_no: 1,
      due_date: clampDueDate(orderStart, 1, due_day).format('YYYY-MM-DD'),
      amount_due: firstAmt,
      pre_balance: totalRemainingToPay,
      balance: Math.max(0, totalRemainingToPay - firstAmt),
      status: 'pending',
      recovery_officer: b.recovery_officer || null,
    });
  }

  await logActivity({
    userId: req.user.id, branchId: branch_id, action: 'create_order',
    entityType: 'order', entityId: order.id, details: { order_no, total_price: b.total_price }, req,
  });

  const { data: full } = await supabaseAdmin
    .from('orders').select('*, customers(*), products(*), installments(*)').eq('id', order.id).single();
  if (full?.installments) full.installments.sort((a, b) => a.installment_no - b.installment_no);
  res.status(201).json(full);
});

router.patch('/:id', requirePermission('orders.update'), async (req, res) => {
  const updates = req.body || {};
  delete updates.id;
  delete updates.installments;
  // branch_id is immutable post-creation — would orphan branch-scoped queries
  delete updates.branch_id;
  delete updates.customer_id;

  if (req.user.role === 'operator') {
    const { data: existing } = await supabaseAdmin
      .from('orders').select('branch_id').eq('id', req.params.id).single();
    if (!existing || existing.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  const { data, error } = await supabaseAdmin
    .from('orders').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, branchId: data.branch_id, action: 'update_order',
    entityType: 'order', entityId: req.params.id, details: updates, req,
  });
  res.json(data);
});

// ---------------------------------------------------------------------------
// Device lock / unlock — spec §4 + §7
// ---------------------------------------------------------------------------
async function loadOrderForLockOp(orderId, user) {
  const { data: order, error } = await supabaseAdmin
    .from('orders').select('*').eq('id', orderId).single();
  if (error || !order) return { error: { status: 404, msg: 'Order not found' } };
  if (user.role === 'operator' && order.branch_id !== user.branch_id) {
    return { error: { status: 403, msg: 'Forbidden' } };
  }
  return { order };
}

router.post('/:id/lock', requirePermission('devices.lock'), async (req, res) => {
  const { reason, lock_message } = req.body || {};
  const { order, error: loadErr } = await loadOrderForLockOp(req.params.id, req.user);
  if (loadErr) return res.status(loadErr.status).json({ error: loadErr.msg });

  try {
    const result = await issueCommand({
      order,
      action: 'lock',
      reason: reason || 'Operator initiated',
      lock_message: lock_message || '',
      issued_by: req.user.id,
      req,
    });
    res.status(202).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/unlock', requirePermission('devices.unlock'), async (req, res) => {
  const { reason } = req.body || {};
  const { order, error: loadErr } = await loadOrderForLockOp(req.params.id, req.user);
  if (loadErr) return res.status(loadErr.status).json({ error: loadErr.msg });

  try {
    const result = await issueCommand({
      order,
      action: 'unlock',
      reason: reason || 'Operator initiated',
      issued_by: req.user.id,
      req,
    });
    res.status(202).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
