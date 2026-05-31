const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
router.use(authenticate);

function genAccountNo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
    .select('*, branches(id, name, code), guarantors(*)')
    .order('created_at', { ascending: false });

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
  if (req.user.role === 'operator' && data.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(data);
});

// POST /customers - create customer (and optionally a login)
router.post('/', requirePermission('customers.manage'), async (req, res) => {
  const body = req.body || {};
  const branch_id = req.user.role === 'admin' ? (body.branch_id || req.user.branch_id) : req.user.branch_id;
  if (!branch_id) return res.status(400).json({ error: 'branch_id required' });
  if (!body.customer_name) return res.status(400).json({ error: 'customer_name required' });
  if (!body.phone_1) return res.status(400).json({ error: 'phone_1 required' });

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
    account_no: body.account_no || genAccountNo(),
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

  const { data: customer, error: custErr } = await supabaseAdmin
    .from('customers').insert(customerInsert).select().single();
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
  delete updates.guarantors;
  delete updates.id;

  if (req.user.role === 'operator') {
    const { data: existing } = await supabaseAdmin
      .from('customers').select('branch_id').eq('id', id).single();
    if (!existing || existing.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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

module.exports = router;
