const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, invalidateAll } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
router.use(authenticate);

// super_admin bypasses the "can only grant what you have" rule.
function callerCanGrant(req, perms) {
  const granted = req.user.permissions || [];
  if (granted.includes('*')) return { ok: true };
  const missing = (perms || []).filter(p => !granted.includes(p));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

router.get('/', requirePermission('users.view'), async (req, res) => {
  // password_plain is included so admins/operators can re-tell users their password
  // (explicit business requirement). Operators are branch-scoped — they only see
  // users (customers) in their own branch, so they can only see their branch's
  // passwords. Admin profiles are branch_id=null, so they never show up in an
  // operator's listing.
  let q = supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, phone, role, branch_id, is_active, password_plain, role_id, created_at, branches(name)')
    .order('created_at', { ascending: false });

  // super_admin sees everyone; admin sees everyone (back-compat); operators are
  // branch-scoped; everyone else needs explicit perms (already gated above).
  if (req.user.role === 'operator') {
    q = q.eq('branch_id', req.user.branch_id);
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    // Custom-role user with users.view — pin to own branch
    if (req.user.branch_id) q = q.eq('branch_id', req.user.branch_id);
  }

  if (req.query.role) q = q.eq('role', req.query.role);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Extra defense: don't leak admin passwords below the admin tier.
  const sanitized = (req.user.role === 'operator' || req.user.role === 'customer')
    ? data.map(u => (u.role === 'admin' || u.role === 'super_admin' ? { ...u, password_plain: null } : u))
    : data;
  res.json(sanitized);
});

router.post('/', requirePermission('users.create'), async (req, res) => {
  const { email, password, full_name, phone, role, branch_id, role_id, permissions } = req.body || {};

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, role are required' });
  }
  if (!['admin', 'operator', 'customer'].includes(role)) {
    return res.status(400).json({ error: 'invalid role (use /api/super-admin/admins to create admins is recommended)' });
  }

  // Operators can only create customers (back-compat behavior preserved).
  if (req.user.role === 'operator' && role !== 'customer') {
    return res.status(403).json({ error: 'Operators can only create customers' });
  }

  // Only super_admin can create admin accounts through this endpoint.
  if (role === 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only super_admin can create admin accounts (use /api/super-admin/admins)' });
  }

  const finalBranchId =
    (req.user.role === 'admin' || req.user.role === 'super_admin')
      ? (branch_id || null)
      : req.user.branch_id;

  if ((role === 'operator' || role === 'customer') && !finalBranchId) {
    return res.status(400).json({ error: 'branch_id is required for operators and customers' });
  }

  // Validate the caller can grant everything they're requesting.
  if (Array.isArray(permissions)) {
    const check = callerCanGrant(req, permissions);
    if (!check.ok) return res.status(403).json({ error: 'Cannot grant permissions you do not have', missing: check.missing });
  }

  const { data: auth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (authErr) return res.status(400).json({ error: authErr.message });

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: auth.user.id,
      full_name, email, phone, role,
      branch_id: finalBranchId,
      role_id: role_id || null,
      password_plain: password,
    })
    .select()
    .single();

  if (profileErr) {
    await supabaseAdmin.auth.admin.deleteUser(auth.user.id);
    return res.status(400).json({ error: profileErr.message });
  }

  if (Array.isArray(permissions) && permissions.length) {
    const rows = permissions.map(p => ({ user_id: profile.id, permission_id: p, grant: true }));
    await supabaseAdmin.from('user_permission_overrides').insert(rows);
  }

  invalidateAll();
  await logActivity({
    userId: req.user.id, branchId: finalBranchId, action: 'create_user',
    entityType: 'user', entityId: profile.id, details: { role, email, role_id, permissions: permissions || null }, req,
  });

  res.status(201).json(profile);
});

router.patch('/:id', requirePermission('users.update'), async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, is_active, branch_id, role, password, role_id, permissions } = req.body || {};

  if (req.user.role === 'operator') {
    const { data: target } = await supabaseAdmin
      .from('profiles').select('role, branch_id').eq('id', id).single();
    if (!target || target.role !== 'customer' || target.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  if (Array.isArray(permissions)) {
    const check = callerCanGrant(req, permissions);
    if (!check.ok) return res.status(403).json({ error: 'Cannot grant permissions you do not have', missing: check.missing });
  }

  // Update Auth first — if it fails we don't want a DB row that's out of sync
  if (password) {
    const { error: authUpdErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
    if (authUpdErr) return res.status(400).json({ error: 'Auth password update failed: ' + authUpdErr.message });
  }

  const updates = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (phone !== undefined) updates.phone = phone;
  if (is_active !== undefined) updates.is_active = is_active;
  if (branch_id !== undefined && (req.user.role === 'admin' || req.user.role === 'super_admin')) updates.branch_id = branch_id;
  if (role !== undefined && (req.user.role === 'admin' || req.user.role === 'super_admin')) updates.role = role;
  if (role_id !== undefined) updates.role_id = role_id;
  if (password) updates.password_plain = password;

  const { data, error } = Object.keys(updates).length
    ? await supabaseAdmin.from('profiles').update(updates).eq('id', id).select().single()
    : await supabaseAdmin.from('profiles').select('*').eq('id', id).single();
  if (error) return res.status(400).json({ error: error.message });

  // Replace overrides if a new permission set was supplied. We treat the
  // incoming list as authoritative grants; explicit denies aren't expressible
  // through this endpoint (super_admin admin-edit endpoint handles that case).
  if (Array.isArray(permissions)) {
    await supabaseAdmin.from('user_permission_overrides').delete().eq('user_id', id);
    if (permissions.length) {
      const rows = permissions.map(p => ({ user_id: id, permission_id: p, grant: true }));
      await supabaseAdmin.from('user_permission_overrides').insert(rows);
    }
  }

  // Profile change may affect role/active/branch/perms — flush auth cache so it takes effect now
  invalidateAll();

  await logActivity({
    userId: req.user.id, branchId: data.branch_id, action: 'update_user',
    entityType: 'user', entityId: id,
    details: { ...updates, password_plain: password ? '***' : undefined, role_id, permissions_changed: Array.isArray(permissions) }, req,
  });

  res.json(data);
});

router.delete('/:id', requirePermission('users.disable'), async (req, res) => {
  const { id } = req.params;
  await supabaseAdmin.from('profiles').update({ is_active: false }).eq('id', id);
  await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  invalidateAll();
  await logActivity({
    userId: req.user.id, action: 'disable_user', entityType: 'user', entityId: id, req,
  });
  res.json({ ok: true });
});

module.exports = router;
