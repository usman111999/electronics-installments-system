// /api/roles/* — custom role management. Spec §3.2.

const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, invalidateAll } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
router.use(authenticate);

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// super_admin bypasses the "must hold the perm to grant it" rule.
function callerCanGrant(req, perms) {
  const granted = req.user.permissions || [];
  if (granted.includes('*')) return { ok: true };
  const missing = perms.filter(p => !granted.includes(p));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// List roles visible to caller. Admin/super_admin see all; others see global +
// own-branch.
router.get('/', requirePermission('roles.view'), async (req, res) => {
  let q = supabaseAdmin
    .from('roles')
    .select('*, branches(id, name)')
    .order('created_at', { ascending: false });

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    if (req.user.branch_id) {
      q = q.or(`branch_id.is.null,branch_id.eq.${req.user.branch_id}`);
    } else {
      q = q.is('branch_id', null);
    }
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Attach permission_ids[] per role
  const out = await Promise.all((data || []).map(async (r) => {
    const { data: rps } = await supabaseAdmin
      .from('role_permissions').select('permission_id').eq('role_id', r.id);
    return { ...r, permissions: (rps || []).map(p => p.permission_id) };
  }));
  res.json(out);
});

// Permission registry — used by the UI permission picker.
// Placed before /:id to avoid being shadowed by the param route.
router.get('/permissions/registry', requirePermission('roles.view'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('permissions').select('*').order('category').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', requirePermission('roles.view'), async (req, res) => {
  const { data: role, error } = await supabaseAdmin
    .from('roles').select('*, branches(id, name)').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: error.message });
  const { data: rps } = await supabaseAdmin
    .from('role_permissions').select('permission_id').eq('role_id', role.id);
  res.json({ ...role, permissions: (rps || []).map(p => p.permission_id) });
});

router.post('/', requirePermission('roles.manage'), async (req, res) => {
  const { name, description, base_role, branch_id, permissions } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!base_role || !['admin', 'operator', 'customer'].includes(base_role)) {
    return res.status(400).json({ error: 'base_role must be one of: admin, operator, customer' });
  }
  const perms = Array.isArray(permissions) ? permissions : [];

  const check = callerCanGrant(req, perms);
  if (!check.ok) return res.status(403).json({ error: 'Cannot grant permissions you do not have', missing: check.missing });

  const { data: role, error } = await supabaseAdmin
    .from('roles').insert({
      name,
      slug: slugify(name) + '-' + Math.random().toString(36).slice(2, 6),
      description: description || null,
      base_role,
      branch_id: branch_id || null,
      created_by: req.user.id,
    }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (perms.length) {
    const rows = perms.map(p => ({ role_id: role.id, permission_id: p }));
    const { error: rpErr } = await supabaseAdmin.from('role_permissions').insert(rows);
    if (rpErr) return res.status(400).json({ error: rpErr.message });
  }

  await logActivity({
    userId: req.user.id, branchId: role.branch_id, action: 'create_role',
    entityType: 'role', entityId: role.id, details: { name, permissions: perms }, req,
  });
  invalidateAll();
  res.status(201).json({ ...role, permissions: perms });
});

router.patch('/:id', requirePermission('roles.manage'), async (req, res) => {
  const { id } = req.params;
  const { name, description, permissions, branch_id } = req.body || {};

  const { data: existing } = await supabaseAdmin.from('roles').select('*').eq('id', id).single();
  if (!existing) return res.status(404).json({ error: 'Role not found' });
  if (existing.is_system) return res.status(400).json({ error: 'System role is immutable' });

  if (Array.isArray(permissions)) {
    const check = callerCanGrant(req, permissions);
    if (!check.ok) return res.status(403).json({ error: 'Cannot grant permissions you do not have', missing: check.missing });
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (branch_id !== undefined) updates.branch_id = branch_id;

  if (Object.keys(updates).length) {
    const { error } = await supabaseAdmin.from('roles').update(updates).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
  }

  if (Array.isArray(permissions)) {
    await supabaseAdmin.from('role_permissions').delete().eq('role_id', id);
    if (permissions.length) {
      const rows = permissions.map(p => ({ role_id: id, permission_id: p }));
      const { error: rpErr } = await supabaseAdmin.from('role_permissions').insert(rows);
      if (rpErr) return res.status(400).json({ error: rpErr.message });
    }
  }

  await logActivity({
    userId: req.user.id, branchId: existing.branch_id, action: 'update_role',
    entityType: 'role', entityId: id, details: { updates, permissions_changed: Array.isArray(permissions) }, req,
  });
  invalidateAll();

  const { data: refreshed } = await supabaseAdmin.from('roles').select('*').eq('id', id).single();
  const { data: rps } = await supabaseAdmin.from('role_permissions').select('permission_id').eq('role_id', id);
  res.json({ ...refreshed, permissions: (rps || []).map(p => p.permission_id) });
});

router.delete('/:id', requirePermission('roles.manage'), async (req, res) => {
  const { id } = req.params;
  const { data: existing } = await supabaseAdmin.from('roles').select('id, is_system').eq('id', id).single();
  if (!existing) return res.status(404).json({ error: 'Role not found' });
  if (existing.is_system) return res.status(400).json({ error: 'System role cannot be deleted' });

  // Reject delete if any profile is still pointing at this role (§5 QA #9).
  const { count: assignedCount } = await supabaseAdmin
    .from('profiles').select('id', { count: 'exact', head: true }).eq('role_id', id);
  if (assignedCount && assignedCount > 0) {
    const { data: users } = await supabaseAdmin
      .from('profiles').select('id, full_name, email').eq('role_id', id).limit(20);
    return res.status(409).json({ error: 'Role is assigned to one or more users', users });
  }

  const { error } = await supabaseAdmin.from('roles').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, action: 'delete_role', entityType: 'role', entityId: id, req,
  });
  invalidateAll();
  res.json({ ok: true });
});

module.exports = router;
