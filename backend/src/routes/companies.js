const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole, invalidateAll } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

// Companies are the top-level tenant. Only a super_admin may create or manage
// them — a Company Owner lives *inside* a company and can never see or touch
// this surface. Every endpoint here is therefore locked to super_admin.
const router = express.Router();
router.use(authenticate);
router.use(requireRole('super_admin'));

// GET /companies — list every company with a few headline counts.
router.get('/', async (req, res) => {
  const { data: companies, error } = await supabaseAdmin
    .from('companies').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Attach cheap per-company counts (branches / users / customers).
  const withStats = await Promise.all((companies || []).map(async (c) => {
    const [b, u, cu] = await Promise.all([
      supabaseAdmin.from('branches').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', c.id).neq('role', 'customer'),
      supabaseAdmin.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
    ]);
    return { ...c, stats: { branches: b.count || 0, staff: u.count || 0, customers: cu.count || 0 } };
  }));
  res.json(withStats);
});

// GET /companies/:id — one company plus its owners/staff for the detail view.
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data: company, error } = await supabaseAdmin
    .from('companies').select('*').eq('id', id).single();
  if (error || !company) return res.status(404).json({ error: 'Company not found' });

  const [branches, staff, custCount, orderCount, prodCount] = await Promise.all([
    supabaseAdmin.from('branches').select('id, name, code, city, is_active').eq('company_id', id).order('created_at'),
    supabaseAdmin.from('profiles')
      .select('id, full_name, email, role, is_active, branch_id, password_plain, branches(name)')
      .eq('company_id', id).neq('role', 'customer').order('role'),
    supabaseAdmin.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', id),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('company_id', id),
    supabaseAdmin.from('products').select('id', { count: 'exact', head: true }).eq('company_id', id),
  ]);

  res.json({
    company,
    branches: branches.data || [],
    staff: staff.data || [],
    stats: {
      branches: (branches.data || []).length,
      staff: (staff.data || []).length,
      customers: custCount.count || 0,
      orders: orderCount.count || 0,
      products: prodCount.count || 0,
    },
  });
});

// POST /companies — create a company, optionally with its first owner login.
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Company name is required' });

  const { data: company, error } = await supabaseAdmin
    .from('companies')
    .insert({
      name: b.name,
      code: b.code || null,
      logo_url: b.logo_url || null,
      phone: b.phone || null,
      address: b.address || null,
      created_by: req.user.id,
    })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  let owner = null;
  // If owner credentials were supplied, provision the Company Owner in one shot.
  if (b.owner_email && b.owner_password) {
    const result = await createOwner(company.id, b, req);
    if (result.error) {
      // Roll the company back so we don't leave a half-created tenant.
      await supabaseAdmin.from('companies').delete().eq('id', company.id);
      return res.status(400).json({ error: result.error });
    }
    owner = result.owner;
  }

  await logActivity({
    userId: req.user.id, action: 'create_company',
    entityType: 'company', entityId: company.id, details: { name: company.name }, req,
  });
  res.status(201).json({ company, owner });
});

// POST /companies/:id/owner — add another Company Owner login to a company.
router.post('/:id/owner', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const { data: company } = await supabaseAdmin.from('companies').select('id, name').eq('id', id).single();
  if (!company) return res.status(404).json({ error: 'Company not found' });
  if (!b.owner_email || !b.owner_password) {
    return res.status(400).json({ error: 'owner_email and owner_password are required' });
  }
  const result = await createOwner(id, b, req);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ owner: result.owner });
});

// Shared helper: create an auth login + an admin profile pinned to a company.
// A Company Owner is simply an `admin` whose company_id is set — that scopes
// them to their tenant while giving them full management inside it.
async function createOwner(companyId, b, req) {
  const email = b.owner_email;
  const password = b.owner_password;
  const full_name = b.owner_name || b.name || email;

  const { data: auth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name, role: 'admin' },
  });
  if (authErr) return { error: 'Auth create failed: ' + authErr.message };

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: auth.user.id,
      full_name, email, phone: b.owner_phone || null,
      role: 'admin',
      company_id: companyId,
      branch_id: null,
      password_plain: password,
    })
    .select().single();
  if (profileErr) {
    await supabaseAdmin.auth.admin.deleteUser(auth.user.id);
    return { error: 'Owner profile failed: ' + profileErr.message };
  }
  invalidateAll();
  await logActivity({
    userId: req.user.id, action: 'create_company_owner',
    entityType: 'company', entityId: companyId, details: { email }, req,
  });
  return { owner: profile };
}

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = { ...(req.body || {}) };
  ['id', 'created_at', 'updated_at', 'created_by'].forEach(k => delete updates[k]);
  const { data, error } = await supabaseAdmin
    .from('companies').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, action: 'update_company',
    entityType: 'company', entityId: id, details: updates, req,
  });
  res.json(data);
});

// Enable / disable a whole company. Disabling also bans every staff login so
// nobody in that tenant can sign in until it's re-enabled.
router.post('/:id/active', async (req, res) => {
  const { id } = req.params;
  const is_active = !!(req.body || {}).is_active;
  const { data, error } = await supabaseAdmin
    .from('companies').update({ is_active }).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  const { data: staff } = await supabaseAdmin
    .from('profiles').select('id').eq('company_id', id).neq('role', 'customer');
  await Promise.all((staff || []).map(u =>
    supabaseAdmin.auth.admin.updateUserById(u.id, { ban_duration: is_active ? 'none' : '876000h' }).catch(() => {})
  ));
  await supabaseAdmin.from('profiles').update({ is_active }).eq('company_id', id).neq('role', 'customer');
  invalidateAll();

  await logActivity({
    userId: req.user.id, action: is_active ? 'enable_company' : 'disable_company',
    entityType: 'company', entityId: id, req,
  });
  res.json(data);
});

// DELETE /companies/:id — remove a company and everything under it. Data tables
// (branches, products, customers, orders, inventory) cascade via FK; staff
// logins are torn down explicitly (auth users + profiles). Requires ?force=true
// so it can never be a one-click accident.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const force = req.query.force === 'true' || req.query.force === '1';

  const { data: company } = await supabaseAdmin.from('companies').select('id, name').eq('id', id).single();
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const [{ count: branchCount }, { count: custCount }, { data: staff }] = await Promise.all([
    supabaseAdmin.from('branches').select('id', { count: 'exact', head: true }).eq('company_id', id),
    supabaseAdmin.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', id),
    supabaseAdmin.from('profiles').select('id').eq('company_id', id),
  ]);

  if (!force) {
    return res.status(409).json({
      code: 'COMPANY_HAS_DATA',
      branchCount: branchCount || 0,
      customerCount: custCount || 0,
      staffCount: (staff || []).length,
      error: `Deleting "${company.name}" will permanently remove ${branchCount || 0} branch(es), ${custCount || 0} customer(s), and all their orders, products and logins.`,
    });
  }

  // Delete the company FIRST. Its branches/products/customers/orders/inventory
  // cascade away, which clears the created_by/profile references that would
  // otherwise RESTRICT the login deletes below. profiles.company_id is nulled
  // by the FK's ON DELETE SET NULL — that's why we captured the ids above.
  const staffIds = (staff || []).map(u => u.id);
  const { error } = await supabaseAdmin.from('companies').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  // Now tear down every login that belonged to the tenant (auth user + profile).
  for (const uid of staffIds) {
    await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
    await supabaseAdmin.from('profiles').delete().eq('id', uid);
  }

  await logActivity({
    userId: req.user.id, action: 'delete_company',
    entityType: 'company', entityId: id, details: { name: company.name }, req,
  });
  res.json({ ok: true });
});

module.exports = router;
