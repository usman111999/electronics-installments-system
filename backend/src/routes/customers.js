const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, requireRole, scopeBranch, scopeCompany } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
router.use(authenticate);

// Sequential, zero-padded account numbers (no random): 0001, 0002, 0003 …
// Scoped PER COMPANY so each tenant has its own independent sequence (and so the
// sequence never leaks other companies' creation activity). Next = highest
// existing sequential account_no in this company + 1. Legacy 6-digit random
// numbers (>= 100000) are ignored. The (company_id, account_no) unique
// constraint plus a one-shot retry guards the rare race.
async function nextAccountNo(companyId) {
  let q = supabaseAdmin.from('customers').select('account_no');
  if (companyId) q = q.eq('company_id', companyId);
  const { data } = await q;
  let max = 0;
  for (const r of data || []) {
    const n = parseInt(r.account_no, 10);
    if (Number.isFinite(n) && n > max && n < 100000) max = n;
  }
  return String(max + 1).padStart(4, '0');
}

// GET /customers - admin/operator list, operators scoped to branch; customer gets only self
router.get('/', async (req, res) => {
  if (req.user.role === 'customer') {
    const { data } = await supabaseAdmin
      .from('customers').select('*, guarantors(*)').eq('profile_id', req.user.id).single();
    return res.json(data ? [data] : []);
  }

  let q = supabaseAdmin
    .from('customers')
    .select('*, branches(id, name, code), guarantors(*), orders(count)')
    .order('created_at', { ascending: false });

  const cScope = scopeCompany(req);
  if (cScope) q = q.eq('company_id', cScope);
  const scope = scopeBranch(req);
  if (scope) q = q.eq('branch_id', scope);
  if (req.query.branch_id && req.user.role === 'admin') q = q.eq('branch_id', req.query.branch_id);
  if (req.query.search) {
    // Strip anything that could break out of the PostgREST .or() filter expression
    const s = String(req.query.search).replace(/[(),%*"'\\]/g, '').slice(0, 60);
    if (s) {
      q = q.or(`customer_name.ilike.%${s}%,account_no.ilike.%${s}%,phone_1.ilike.%${s}%`);
    }
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('*, branches(id, name, code), guarantors(*), orders(*, installments(*))')
    .eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: error.message });

  if (req.user.role === 'customer' && data.profile_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // A Company Owner may only open customers inside their company.
  const cScope = scopeCompany(req);
  if (cScope && data.company_id !== cScope) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Any branch-scoped role (operator or custom) may only open a customer in
  // their own branch.
  const scope = scopeBranch(req);
  if (scope && data.branch_id !== scope) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(data);
});

// POST /customers - create customer (and optionally a login)
router.post('/', requirePermission('customers.manage'), async (req, res) => {
  const body = req.body || {};
  const isManager = req.user.role === 'admin' || req.user.role === 'super_admin';
  const branch_id = isManager ? (body.branch_id || req.user.branch_id) : req.user.branch_id;
  if (!branch_id) return res.status(400).json({ error: 'branch_id required' });
  if (!body.customer_name) return res.status(400).json({ error: 'customer_name required' });
  if (!body.phone_1) return res.status(400).json({ error: 'phone_1 required' });

  // A customer's company follows its branch. A super_admin inherits whichever
  // company the branch belongs to; every non-super caller is STRICTLY pinned to
  // their own company — and a caller with no company assigned may not create
  // data (fail-closed, so a company-less admin can't write into another tenant).
  const isSuper = req.user.role === 'super_admin';
  const { data: brRow } = await supabaseAdmin.from('branches').select('company_id').eq('id', branch_id).single();
  if (!brRow) return res.status(400).json({ error: 'Branch not found' });
  let company_id;
  if (isSuper) {
    company_id = brRow.company_id;
  } else {
    company_id = req.user.company_id;
    if (!company_id) return res.status(403).json({ error: 'Your account has no company assigned' });
    if (brRow.company_id !== company_id) return res.status(403).json({ error: 'Branch belongs to another company' });
  }
  if (!company_id) return res.status(400).json({ error: 'Could not resolve company for this branch' });

  // Optionally create a login for the customer
  let profile_id = null;
  if (body.create_login && body.email && body.password) {
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.customer_name, role: 'customer' },
    });
    if (authErr) return res.status(400).json({ error: 'Auth create failed: ' + authErr.message });

    const { error: profErr } = await supabaseAdmin.from('profiles').insert({
      id: authData.user.id,
      full_name: body.customer_name,
      email: body.email,
      phone: body.phone_1,
      role: 'customer',
      branch_id,
      company_id,
      password_plain: body.password,
    });
    if (profErr) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ error: 'Profile create failed: ' + profErr.message });
    }
    profile_id = authData.user.id;
  }

  const customerInsert = {
    profile_id,
    branch_id,
    company_id,
    account_no: body.account_no || await nextAccountNo(company_id),
    customer_name: body.customer_name,
    father_husband_name: body.father_husband_name,
    cnic: body.cnic,
    picture_url: body.picture_url,
    gender: body.gender,
    home_address: body.home_address,
    official_address: body.official_address,
    phone_1: body.phone_1,
    phone_2: body.phone_2,
    occupation: body.occupation,
    monthly_income: body.monthly_income,
    employee_status: body.employee_status,
    crc_remarks: body.crc_remarks,
    dbm_remarks: body.dbm_remarks,
    second_remarks: body.second_remarks,
    created_by: req.user.id,
  };

  let { data: customer, error: custErr } = await supabaseAdmin
    .from('customers').insert(customerInsert).select().single();
  // If a concurrent create grabbed the same sequential account_no, recompute and
  // retry once (only when we generated the number, not when the caller set it).
  if (custErr && /account_no/.test(custErr.message || '') && !body.account_no) {
    customerInsert.account_no = await nextAccountNo(company_id);
    ({ data: customer, error: custErr } = await supabaseAdmin
      .from('customers').insert(customerInsert).select().single());
  }
  if (custErr) return res.status(400).json({ error: custErr.message });

  // Insert guarantors
  const guarantors = Array.isArray(body.guarantors) ? body.guarantors : [];
  if (guarantors.length) {
    const rows = guarantors.map((g, idx) => ({
      customer_id: customer.id,
      guarantor_number: g.guarantor_number || (idx + 1),
      name: g.name,
      father_name: g.father_name,
      cnic: g.cnic,
      home_address: g.home_address,
      official_address: g.official_address,
      phone_1: g.phone_1,
      phone_2: g.phone_2,
      occupation: g.occupation,
      relation: g.relation,
    })).filter(g => g.name);
    if (rows.length) {
      await supabaseAdmin.from('guarantors').insert(rows);
    }
  }

  await logActivity({
    userId: req.user.id, branchId: branch_id, action: 'create_customer',
    entityType: 'customer', entityId: customer.id, details: { name: customer.customer_name }, req,
  });

  const { data: full } = await supabaseAdmin
    .from('customers').select('*, guarantors(*)').eq('id', customer.id).single();
  res.status(201).json(full);
});

router.patch('/:id', requirePermission('customers.manage'), async (req, res) => {
  const { id } = req.params;
  const updates = { ...(req.body || {}) };
  const guarantors = updates.guarantors;
  // Strip joined relations / server-managed fields — these are not columns on
  // the customers table and Postgres rejects the whole update if they're sent.
  ['guarantors', 'orders', 'branches', 'id', 'company_id', 'created_at', 'updated_at'].forEach(k => delete updates[k]);

  const cScope = scopeCompany(req);
  const scope = scopeBranch(req);
  if (cScope || scope) {
    const { data: existing } = await supabaseAdmin
      .from('customers').select('branch_id, company_id').eq('id', id).single();
    if (!existing) return res.status(403).json({ error: 'Forbidden' });
    if (cScope && existing.company_id !== cScope) return res.status(403).json({ error: 'Forbidden' });
    if (scope && existing.branch_id !== scope) return res.status(403).json({ error: 'Forbidden' });
    delete updates.branch_id;
  }

  const { data, error } = await supabaseAdmin
    .from('customers').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (Array.isArray(guarantors)) {
    await supabaseAdmin.from('guarantors').delete().eq('customer_id', id);
    const rows = guarantors.map((g, idx) => ({
      customer_id: id,
      guarantor_number: g.guarantor_number || (idx + 1),
      name: g.name, father_name: g.father_name, cnic: g.cnic,
      home_address: g.home_address, official_address: g.official_address,
      phone_1: g.phone_1, phone_2: g.phone_2, occupation: g.occupation, relation: g.relation,
    })).filter(g => g.name);
    if (rows.length) await supabaseAdmin.from('guarantors').insert(rows);
  }

  await logActivity({
    userId: req.user.id, branchId: data.branch_id, action: 'update_customer',
    entityType: 'customer', entityId: id, details: updates, req,
  });

  const { data: full } = await supabaseAdmin
    .from('customers').select('*, guarantors(*)').eq('id', id).single();
  res.json(full);
});

// DELETE /customers/:id — admin/super_admin only. Guarantors and whatsapp
// notifications cascade; the linked login (if any) is removed. Orders block
// deletion because orders.customer_id is ON DELETE RESTRICT: without
// ?force=true we return a 409 reporting the order count so the UI can confirm.
// With ?force=true we first cancel (delete) the customer's orders — their
// installments, devices and device-lock rows cascade from each order — then
// remove the customer.
router.delete('/:id', requireRole('admin', 'super_admin'), async (req, res) => {
  const { id } = req.params;
  const force = req.query.force === 'true' || req.query.force === '1';

  const { data: existing } = await supabaseAdmin
    .from('customers').select('id, customer_name, profile_id, company_id').eq('id', id).single();
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  const cScope = scopeCompany(req);
  if (cScope && existing.company_id !== cScope) return res.status(403).json({ error: 'Forbidden — not your company' });

  // Load the customer's orders up front so we can report the count and log them.
  const { data: orders, error: ordErr } = await supabaseAdmin
    .from('orders').select('id, order_no').eq('customer_id', id);
  // Never delete on bad data — fail safe rather than risk an orphaning delete.
  if (ordErr) return res.status(500).json({ error: 'Could not check customer orders. Please try again.' });
  const orderCount = orders?.length || 0;

  // Require explicit confirmation before cancelling orders.
  if (orderCount > 0 && !force) {
    return res.status(409).json({
      code: 'HAS_ORDERS',
      orderCount,
      error: `This customer has ${orderCount} order(s) that will be cancelled if you delete them.`,
    });
  }

  // Cancel the orders first so the RESTRICT foreign key can't block the delete.
  if (orderCount > 0) {
    const { error: delOrdErr } = await supabaseAdmin
      .from('orders').delete().eq('customer_id', id);
    if (delOrdErr) return res.status(400).json({ error: 'Failed to cancel orders: ' + delOrdErr.message });
  }

  const { error } = await supabaseAdmin.from('customers').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  // Tear down the customer's login if one was provisioned. Delete the auth user
  // first — profiles.id references auth.users ON DELETE CASCADE, so the profile
  // row goes with it; the explicit profile delete is a harmless safety net.
  if (existing.profile_id) {
    await supabaseAdmin.auth.admin.deleteUser(existing.profile_id).catch(() => {});
    await supabaseAdmin.from('profiles').delete().eq('id', existing.profile_id);
  }

  await logActivity({
    userId: req.user.id, action: 'delete_customer',
    entityType: 'customer', entityId: id,
    details: {
      name: existing.customer_name,
      cancelledOrders: orderCount,
      orderNos: (orders || []).map(o => o.order_no),
    }, req,
  });
  res.json({ ok: true, cancelledOrders: orderCount });
});

module.exports = router;
