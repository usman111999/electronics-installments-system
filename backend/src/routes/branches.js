const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

router.use(authenticate);

// GET /branches - admin sees all; operator sees own
router.get('/', async (req, res) => {
  let q = supabaseAdmin.from('branches').select('*').order('created_at', { ascending: false });
  // super_admin and admin see all branches; everyone else is pinned to their own.
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    q = q.eq('id', req.user.branch_id);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', requirePermission('branches.create'), async (req, res) => {
  const { name, code, address, city, phone, manager_name, auto_lock_days } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { data, error } = await supabaseAdmin
    .from('branches')
    .insert({
      name, code, address, city, phone, manager_name,
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
  const updates = req.body || {};
  delete updates.id;

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
