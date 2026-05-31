const express = require('express');
const dayjs = require('dayjs');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /stats/overview - dashboard KPIs
router.get('/overview', requirePermission('stats.view'), async (req, res) => {
  const scope = scopeBranch(req);
  const branchFilter = req.query.branch_id && req.user.role === 'admin' ? req.query.branch_id : scope;

  // Orders aggregate
  let ordersQ = supabaseAdmin.from('orders').select('total_price, advance_payment, discount, status, branch_id', { count: 'exact' });
  if (branchFilter) ordersQ = ordersQ.eq('branch_id', branchFilter);
  const { data: orders, count: ordersCount } = await ordersQ;

  let totalSales = 0, totalAdvance = 0, totalDiscount = 0;
  const ordersByStatus = { active: 0, completed: 0, defaulted: 0, cancelled: 0 };
  (orders || []).forEach(o => {
    totalSales += Number(o.total_price || 0);
    totalAdvance += Number(o.advance_payment || 0);
    totalDiscount += Number(o.discount || 0);
    if (ordersByStatus[o.status] !== undefined) ordersByStatus[o.status]++;
  });

  // Installments aggregate (collections + outstanding)
  let instQ = supabaseAdmin
    .from('installments')
    .select('amount_due, amount_paid, status, due_date, payment_date, orders!inner(branch_id)');
  if (branchFilter) instQ = instQ.eq('orders.branch_id', branchFilter);
  const { data: insts } = await instQ;

  let collected = 0;
  let outstanding = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  const today = dayjs().format('YYYY-MM-DD');
  (insts || []).forEach(i => {
    collected += Number(i.amount_paid || 0);
    const remaining = Math.max(0, Number(i.amount_due || 0) - Number(i.amount_paid || 0));
    outstanding += remaining;
    if ((i.status === 'pending' || i.status === 'overdue' || i.status === 'partial') && i.due_date < today) {
      overdueAmount += remaining;
      overdueCount++;
    }
  });

  // Customers count
  let custQ = supabaseAdmin.from('customers').select('id', { count: 'exact', head: true });
  if (branchFilter) custQ = custQ.eq('branch_id', branchFilter);
  const { count: customersCount } = await custQ;

  // Inventory count
  let invQ = supabaseAdmin.from('inventory').select('id', { count: 'exact', head: true }).eq('status', 'in_stock');
  if (branchFilter) invQ = invQ.eq('branch_id', branchFilter);
  const { count: stockCount } = await invQ;

  // Branches count
  const { count: branchCount } = await supabaseAdmin.from('branches').select('id', { count: 'exact', head: true }).eq('is_active', true);

  res.json({
    orders: {
      total: ordersCount || 0,
      total_sales: totalSales,
      total_advance: totalAdvance,
      total_discount: totalDiscount,
      by_status: ordersByStatus,
    },
    installments: {
      collected,
      outstanding,
      overdue_amount: overdueAmount,
      overdue_count: overdueCount,
    },
    money_in_market: outstanding,
    profit_so_far: collected - totalAdvance, // simplistic — refine with cost data
    customers: customersCount || 0,
    stock_in_hand: stockCount || 0,
    branches: branchCount || 0,
  });
});

// GET /stats/monthly-collections - last 12 months
router.get('/monthly-collections', requirePermission('stats.view'), async (req, res) => {
  const scope = scopeBranch(req);
  const branchFilter = req.query.branch_id && req.user.role === 'admin' ? req.query.branch_id : scope;

  const start = dayjs().subtract(11, 'month').startOf('month').format('YYYY-MM-DD');
  let q = supabaseAdmin
    .from('installments')
    .select('amount_paid, payment_date, orders!inner(branch_id)')
    .not('payment_date', 'is', null)
    .gte('payment_date', start);
  if (branchFilter) q = q.eq('orders.branch_id', branchFilter);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const buckets = {};
  for (let i = 11; i >= 0; i--) {
    const k = dayjs().subtract(i, 'month').format('YYYY-MM');
    buckets[k] = 0;
  }
  (data || []).forEach(r => {
    const k = dayjs(r.payment_date).format('YYYY-MM');
    if (buckets[k] !== undefined) buckets[k] += Number(r.amount_paid || 0);
  });

  res.json(Object.entries(buckets).map(([month, amount]) => ({ month, amount })));
});

// GET /stats/orders-by-branch - admin only
router.get('/orders-by-branch', requirePermission('stats.global_view'), async (_req, res) => {
  const { data: branches } = await supabaseAdmin.from('branches').select('id, name').eq('is_active', true);
  const out = [];
  for (const b of (branches || [])) {
    const { count } = await supabaseAdmin
      .from('orders').select('id', { count: 'exact', head: true }).eq('branch_id', b.id);
    out.push({ branch: b.name, orders: count || 0 });
  }
  res.json(out);
});

// GET /stats/top-products
router.get('/top-products', requirePermission('stats.view'), async (req, res) => {
  const scope = scopeBranch(req);
  const branchFilter = req.query.branch_id && req.user.role === 'admin' ? req.query.branch_id : scope;

  let q = supabaseAdmin.from('orders').select('product_id, products(name), total_price');
  if (branchFilter) q = q.eq('branch_id', branchFilter);
  const { data } = await q;

  const counter = {};
  (data || []).forEach(o => {
    const key = o.product_id || 'unknown';
    const name = o.products?.name || 'Unknown';
    if (!counter[key]) counter[key] = { name, orders: 0, revenue: 0 };
    counter[key].orders += 1;
    counter[key].revenue += Number(o.total_price || 0);
  });

  const arr = Object.values(counter).sort((a, b) => b.orders - a.orders).slice(0, 8);
  res.json(arr);
});

// GET /stats/customer - for customer portal
router.get('/customer', async (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Forbidden' });

  const { data: cust } = await supabaseAdmin
    .from('customers').select('id').eq('profile_id', req.user.id).single();
  if (!cust) return res.json({ orders: 0, outstanding: 0, paid: 0, next_due: null });

  const { data: insts } = await supabaseAdmin
    .from('installments')
    .select('amount_due, amount_paid, status, due_date, orders!inner(customer_id)')
    .eq('orders.customer_id', cust.id);

  let paid = 0, outstanding = 0;
  let nextDue = null;
  const today = dayjs().format('YYYY-MM-DD');
  (insts || []).forEach(i => {
    paid += Number(i.amount_paid || 0);
    const rem = Math.max(0, Number(i.amount_due || 0) - Number(i.amount_paid || 0));
    outstanding += rem;
    if ((i.status === 'pending' || i.status === 'partial' || i.status === 'overdue') && rem > 0) {
      if (!nextDue || i.due_date < nextDue) nextDue = i.due_date;
    }
  });

  const { count: orderCount } = await supabaseAdmin
    .from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', cust.id);

  res.json({
    orders: orderCount || 0,
    outstanding,
    paid,
    next_due: nextDue,
  });
});

module.exports = router;
