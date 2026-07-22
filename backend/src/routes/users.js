const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, invalidateAll, scopeCompany } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');
const { DEFAULT_BUNDLES } = require('../services/permissions');

const router = express.Router();
router.use(authenticate);

// super_admin bypasses the "can only grant what you have" rule.
function callerCanGrant(req, perms) {
  const granted = req.user.permissions || [];
  if (granted.includes('*')) return { ok: true };
  const missing = (perms || []).filter(p => !granted.includes(p));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// A role_id attached to a user must belong to the caller's company AND must not
// grant permissions the caller lacks. Without this, role_id is a cross-tenant
// mis-tag and a privilege-escalation vector (a role's permissions are resolved
// straight from role_permissions, bypassing the inline callerCanGrant check).
// The base permission bundle a user WOULD have from a given built-in role plus
// an optional custom role_id (a custom role's grants replace the default bundle).
async function baseBundleFor(role, roleId) {
  if (roleId) {
    const { data: rps } = await supabaseAdmin
      .from('role_permissions').select('permission_id').eq('role_id', roleId);
    return (rps || []).map(r => r.permission_id);
  }
  return DEFAULT_BUNDLES[role] || [];
}

// For a non-super caller: the effective permission set a target WOULD end up
// with (base bundle from the resulting role/role_id, plus any explicit grants)
// must never exceed the caller's own permissions. Returns the excess (empty =
// ok). This closes escalation via the IMPLICIT default/role bundle, not just
// the explicit permissions[] array.
async function grantExceedsCaller(req, { role, roleId, permissions }) {
  const callerPerms = req.user.permissions || [];
  if (callerPerms.includes('*')) return [];
  const base = await baseBundleFor(role, roleId);
  const resulting = new Set([...base, ...(Array.isArray(permissions) ? permissions : [])]);
  return [...resulting].filter(p => !callerPerms.includes(p));
}

async function validateRoleId(req, roleId) {
  const { data: role } = await supabaseAdmin
    .from('roles').select('company_id').eq('id', roleId).single();
  if (!role) return { ok: false, status: 400, error: 'Role not found' };
  const cScope = scopeCompany(req);
  if (cScope && role.company_id !== cScope) {
    return { ok: false, status: 403, error: 'Role belongs to another company' };
  }
  const { data: rps } = await supabaseAdmin
    .from('role_permissions').select('permission_id').eq('role_id', roleId);
  const chk = callerCanGrant(req, (rps || []).map(r => r.permission_id));
  if (!chk.ok) return { ok: false, status: 403, error: 'Cannot assign a role that grants permissions you do not have', missing: chk.missing };
  return { ok: true };
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

  // super_admin sees everyone across all companies; a Company Owner (admin) sees
  // only their company's staff; operators are further pinned to their branch.
  const cScope = scopeCompany(req);
  if (cScope) q = q.eq('company_id', cScope);
  if (req.user.role === 'operator') {
    q = q.eq('branch_id', req.user.branch_id);
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    // Custom-role user with users.view — pin to own branch
    if (req.user.branch_id) q = q.eq('branch_id', req.user.branch_id);
  }

  // super_admin accounts are invisible to everyone but a super_admin — the row
  // is never returned, so no name, details, or password can leak to admins,
  // operators, or any custom role.
  if (req.user.role !== 'super_admin') {
    q = q.neq('role', 'super_admin');
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

  // Resolve the tenant for the new login. A super_admin derives it from the
  // chosen branch or an explicit company_id. Every non-super caller is STRICTLY
  // pinned to their own company — a company-less caller may not create logins
  // (fail-closed on role, never on the truthiness of company_id, so a
  // company-less admin can't mint users into another tenant).
  const isSuper = req.user.role === 'super_admin';
  let company_id;
  if (isSuper) {
    company_id = null;
    if (finalBranchId) {
      const { data: br } = await supabaseAdmin.from('branches').select('company_id').eq('id', finalBranchId).single();
      company_id = br?.company_id || null;
    }
    if (!company_id && req.body.company_id) company_id = req.body.company_id;
  } else {
    company_id = req.user.company_id;
    if (!company_id) return res.status(403).json({ error: 'Your account has no company assigned' });
    if (finalBranchId) {
      const { data: br } = await supabaseAdmin.from('branches').select('company_id').eq('id', finalBranchId).single();
      if (br && br.company_id !== company_id) {
        return res.status(403).json({ error: 'Branch belongs to another company' });
      }
    }
  }

  // Validate the caller can grant everything they're requesting.
  if (Array.isArray(permissions)) {
    const check = callerCanGrant(req, permissions);
    if (!check.ok) return res.status(403).json({ error: 'Cannot grant permissions you do not have', missing: check.missing });
  }
  // A custom role assignment must stay inside the caller's company and grantable.
  if (role_id) {
    const rc = await validateRoleId(req, role_id);
    if (!rc.ok) return res.status(rc.status).json({ error: rc.error, missing: rc.missing });
  }
  // The new user's resulting effective perms (default/role bundle + explicit
  // grants) must not exceed a non-super caller's own permissions.
  if (!isSuper) {
    const excess = await grantExceedsCaller(req, { role, roleId: role_id, permissions });
    if (excess.length) return res.status(403).json({ error: 'That role grants permissions you do not hold', missing: excess });
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
      company_id: company_id || null,
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

  // Only a super_admin may modify a super_admin account, and operators may only
  // edit customers in their own branch. One target lookup covers both checks.
  let target = null;
  if (req.user.role !== 'super_admin') {
    ({ data: target } = await supabaseAdmin
      .from('profiles').select('role, role_id, branch_id, company_id').eq('id', id).single());
    if (target?.role === 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // A Company Owner may only touch users inside their own company.
    const cScope = scopeCompany(req);
    if (cScope && (!target || target.company_id !== cScope)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (req.user.role === 'operator' && (!target || target.role !== 'customer' || target.branch_id !== req.user.branch_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const callerIsSuper = req.user.role === 'super_admin';
  const touchesPrivs = role !== undefined || role_id !== undefined || Array.isArray(permissions);

  // A non-super caller may NEVER change their own role / role_id / permissions
  // (self-escalation), regardless of which field is used.
  if (!callerIsSuper && id === req.user.id && touchesPrivs) {
    return res.status(403).json({ error: 'You cannot change your own role or permissions' });
  }
  // Role VALUE whitelist: a non-super can only (de)assign operator/customer —
  // never admin/super_admin.
  if (role !== undefined && !callerIsSuper && !['operator', 'customer'].includes(role)) {
    return res.status(403).json({ error: 'You cannot assign that role' });
  }
  // Explicit grants must be grantable, and a custom role_id must be in-company.
  if (Array.isArray(permissions)) {
    const check = callerCanGrant(req, permissions);
    if (!check.ok) return res.status(403).json({ error: 'Cannot grant permissions you do not have', missing: check.missing });
  }
  if (role_id) {
    const rc = await validateRoleId(req, role_id);
    if (!rc.ok) return res.status(rc.status).json({ error: rc.error, missing: rc.missing });
  }
  // Whenever privileges change, the target's RESULTING effective perms — the
  // base bundle from the POST-UPDATE role/role_id, plus explicit grants — must
  // stay within the caller's own perms. This covers the role-change, role_id
  // (incl. role_id:null clearing), and permissions[] paths uniformly, closing
  // the default/role-bundle escalation the explicit-only check used to miss.
  if (!callerIsSuper && touchesPrivs) {
    const effRole   = (role !== undefined)    ? role    : (target && target.role);
    const effRoleId = (role_id !== undefined) ? role_id : (target && target.role_id);
    const excess = await grantExceedsCaller(req, { role: effRole, roleId: effRoleId, permissions });
    if (excess.length) return res.status(403).json({ error: 'This change would grant permissions you do not hold', missing: excess });
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
  if (branch_id !== undefined && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
    // A reassigned branch must belong to the caller's own company.
    if (branch_id && req.user.role !== 'super_admin') {
      const { data: br } = await supabaseAdmin.from('branches').select('company_id').eq('id', branch_id).single();
      if (!br || br.company_id !== scopeCompany(req)) return res.status(403).json({ error: 'Branch belongs to another company' });
    }
    updates.branch_id = branch_id;
  }
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
  // A super_admin account can only be disabled by another super_admin.
  if (req.user.role !== 'super_admin') {
    const { data: target } = await supabaseAdmin.from('profiles').select('role, company_id').eq('id', id).single();
    if (target?.role === 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    const cScope = scopeCompany(req);
    if (cScope && (!target || target.company_id !== cScope)) return res.status(403).json({ error: 'Forbidden' });
  }
  await supabaseAdmin.from('profiles').update({ is_active: false }).eq('id', id);
  await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  invalidateAll();
  await logActivity({
    userId: req.user.id, action: 'disable_user', entityType: 'user', entityId: id, req,
  });
  res.json({ ok: true });
});

module.exports = router;
