const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch, scopeCompany } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

router.use(authenticate);

// Assert a branch is inside the caller's company (no-op for super_admin).
// Returns true if allowed; on failure it has already sent the 403/404 response.
async function guardBranchCompany(req, res, id) {
  const cScope = scopeCompany(req);
  if (!cScope) return true; // super_admin
  const { data } = await supabaseAdmin.from('branches').select('company_id').eq('id', id).single();
  if (!data) { res.status(404).json({ error: 'Branch not found' }); return false; }
  if (data.company_id !== cScope) { res.status(403).json({ error: 'Forbidden — not your company' }); return false; }
  return true;
}

// GET /branches - super_admin sees all; a Company Owner sees all branches in
// their company; an operator sees only their own branch.
router.get('/', async (req, res) => {
  let q = supabaseAdmin.from('branches').select('*').order('created_at', { ascending: false });
  // Pin to the caller's company (null for super_admin = every company).
  const cScope = scopeCompany(req);
  if (cScope) q = q.eq('company_id', cScope);
  // super_admin lets an admin drill into one company via ?company_id.
  if (req.query.company_id && req.user.role === 'super_admin') q = q.eq('company_id', req.query.company_id);
  // operators / custom roles are further pinned to their single branch.
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    q = q.eq('id', req.user.branch_id || '00000000-0000-0000-0000-000000000000');
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /branches/:id/detail - full stats + related records for one branch.
router.get('/:id/detail', requirePermission('branches.view'), async (req, res) => {
  const { id } = req.params;

  // Branch-scoped users may only view their own branch.
  const scope = scopeBranch(req);
  if (scope && scope !== id) return res.status(403).json({ error: 'Forbidden — not your branch' });

  const { data: branch, error: bErr } = await supabaseAdmin
    .from('branches').select('*').eq('id', id).single();
  if (bErr || !branch) return res.status(404).json({ error: 'Branch not found' });
  // Company Owners may only open branches inside their own company.
  const cScope = scopeCompany(req);
  if (cScope && branch.company_id !== cScope) return res.status(403).json({ error: 'Forbidden — not your company' });

  const [
    custCount, orderCount, invCount,
    usersRes, customersRes, inventoryRes, installmentsRes,
  ] = await Promise.all([
    supabaseAdmin.from('customers').select('id', { count: 'exact', head: true }).eq('branch_id', id),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('branch_id', id),
    supabaseAdmin.from('inventory').select('id', { count: 'exact', head: true }).eq('branch_id', id),
    supabaseAdmin.from('profiles')
      .select('id, full_name, email, phone, role, is_active, created_at')
      .eq('branch_id', id).order('role', { ascending: true }),
    supabaseAdmin.from('customers')
      .select('id, customer_name, account_no, phone_1, picture_url, created_at, orders(count)')
      .eq('branch_id', id).order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('inventory')
      .select('id, serial_no, status, created_at, products(name, model, company, base_price)')
      .eq('branch_id', id).order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('installments')
      .select('amount_due, amount_paid, fine, discount, status, orders!inner(branch_id)')
      .eq('orders.branch_id', id),
  ]);

  const insts = installmentsRes.data || [];
  let outstanding = 0, collected = 0;
  const instByStatus = { paid: 0, pending: 0, overdue: 0, partial: 0 };
  for (const i of insts) {
    collected += Number(i.amount_paid || 0);
    outstanding += Math.max(0, Number(i.amount_due || 0) + Number(i.fine || 0) - Number(i.discount || 0) - Number(i.amount_paid || 0));
    if (instByStatus[i.status] != null) instByStatus[i.status]++;
  }

  res.json({
    branch,
    stats: {
      customers: custCount.count || 0,
      orders: orderCount.count || 0,
      inventory_items: invCount.count || 0,
      users: (usersRes.data || []).length,
      installments_total: insts.length,
      installments_paid: instByStatus.paid,
      installments_pending: instByStatus.pending,
      installments_partial: instByStatus.partial,
      installments_overdue: instByStatus.overdue,
      outstanding,
      collected,
    },
    users: usersRes.data || [],
    customers: customersRes.data || [],
    inventory: inventoryRes.data || [],
  });
});

router.post('/', requirePermission('branches.create'), async (req, res) => {
  const { name, code, address, city, phone, manager_name, auto_lock_days } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  // A Company Owner's branch always lands in their own company; a super_admin
  // must say which company it belongs to.
  const company_id = req.user.role === 'super_admin'
    ? (req.body.company_id || null)
    : req.user.company_id;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const { data, error } = await supabaseAdmin
    .from('branches')
    .insert({
      name, code, address, city, phone, manager_name, company_id,
      auto_lock_days: auto_lock_days === '' || auto_lock_days == null ? null : Number(auto_lock_days),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await logActivity({
    userId: req.user.id, branchId: data.id, action: 'create_branch',
    entityType: 'branch', entityId: data.id, details: { name }, req,
  });
  res.status(201).json(data);
});

router.patch('/:id', requirePermission('branches.update'), async (req, res) => {
  const { id } = req.params;
  if (!(await guardBranchCompany(req, res, id))) return;
  const updates = req.body || {};
  // Never let a company's branch be moved to another company via a stray field.
  ['id', 'company_id'].forEach(k => delete updates[k]);

  const { data, error } = await supabaseAdmin
    .from('branches').update(updates).eq('id', id).select().single();

  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, branchId: id, action: 'update_branch',
    entityType: 'branch', entityId: id, details: updates, req,
  });
  res.json(data);
});

// DELETE /branches/:id — hard delete. Blocked while the branch still has
// customers or orders (those FKs are NOT NULL, so the delete would fail);
// the admin should reassign/remove them or just disable the branch instead.
// Inventory cascades; staff, devices and activity logs are detached
// (their branch_id is set to null).
router.delete('/:id', requirePermission('branches.delete'), async (req, res) => {
  const { id } = req.params;
  if (!(await guardBranchCompany(req, res, id))) return;

  const { data: branch } = await supabaseAdmin
    .from('branches').select('id, name').eq('id', id).single();
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const [{ count: customerCount, error: cErr }, { count: orderCount, error: oErr }] = await Promise.all([
    supabaseAdmin.from('customers').select('id', { count: 'exact', head: true }).eq('branch_id', id),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('branch_id', id),
  ]);
  // Never delete on bad data — fail safe.
  if (cErr || oErr || customerCount == null || orderCount == null) {
    return res.status(500).json({ error: 'Could not check branch dependencies. Please try again.' });
  }
  if (customerCount > 0 || orderCount > 0) {
    return res.status(409).json({
      code: 'BRANCH_IN_USE',
      customerCount, orderCount,
      error: `Cannot delete "${branch.name}": it still has ${customerCount} customer(s) and ${orderCount} order(s). Reassign or remove them first, or disable the branch instead.`,
    });
  }

  const { error } = await supabaseAdmin.from('branches').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, action: 'delete_branch',
    entityType: 'branch', entityId: id, details: { name: branch.name }, req,
  });
  res.json({ ok: true });
});

// PATCH-based enable/disable stays the canonical "soft" path (Active dropdown);
// this dedicated route is a convenience for the list's Disable/Enable button.
router.post('/:id/active', requirePermission('branches.update'), async (req, res) => {
  const { id } = req.params;
  if (!(await guardBranchCompany(req, res, id))) return;
  const is_active = !!(req.body || {}).is_active;
  const { data, error } = await supabaseAdmin
    .from('branches').update({ is_active }).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, branchId: id, action: is_active ? 'enable_branch' : 'disable_branch',
    entityType: 'branch', entityId: id, req,
  });
  res.json(data);
});

module.exports = router;
