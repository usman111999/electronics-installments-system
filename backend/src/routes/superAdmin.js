// /api/super-admin/* — gated by requireRole('super_admin') only.
// Spec §3.2.

const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole, invalidateAll } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');
const { getEffectivePermissions, DEFAULT_BUNDLES } = require('../services/permissions');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('super_admin'));

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------
router.get('/admins', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, phone, role, branch_id, is_active, role_id, password_plain, created_at, branches(name)')
    .eq('role', 'admin')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Attach resolved permissions per admin so UI can show them inline.
  const out = await Promise.all((data || []).map(async (p) => ({
    ...p,
    permissions: await getEffectivePermissions(p),
  })));
  res.json(out);
});

router.post('/admins', async (req, res) => {
  const { email, password, full_name, phone, permissions } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { data: auth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name, role: 'admin' },
  });
  if (authErr) return res.status(400).json({ error: authErr.message });

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: auth.user.id,
      full_name, email, phone,
      role: 'admin',
      branch_id: null,
      password_plain: password,
      is_active: true,
    })
    .select().single();
  if (profErr) {
    await supabaseAdmin.auth.admin.deleteUser(auth.user.id);
    return res.status(400).json({ error: profErr.message });
  }

  // If an explicit permission list was supplied, install it as overrides
  // relative to the admin default bundle: explicit deny for anything in the
  // bundle that wasn't requested.
  if (Array.isArray(permissions)) {
    await applyAdminPermissionSet(profile.id, permissions);
  }

  invalidateAll();
  await logActivity({
    userId: req.user.id, action: 'create_admin',
    entityType: 'user', entityId: profile.id,
    details: { email, permissions: permissions || 'default' }, req,
  });

  res.status(201).json({ ...profile, permissions: await getEffectivePermissions(profile) });
});

router.patch('/admins/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, password, permissions } = req.body || {};

  const { data: target } = await supabaseAdmin
    .from('profiles').select('id, role').eq('id', id).single();
  if (!target) return res.status(404).json({ error: 'Admin not found' });
  if (target.role !== 'admin') return res.status(400).json({ error: 'Target is not an admin' });

  if (password) {
    const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
    if (pwdErr) return res.status(400).json({ error: 'Auth password update failed: ' + pwdErr.message });
  }

  const updates = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (phone !== undefined) updates.phone = phone;
  if (password) updates.password_plain = password;

  if (Object.keys(updates).length) {
    const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
  }

  if (Array.isArray(permissions)) {
    await applyAdminPermissionSet(id, permissions);
  }

  invalidateAll();
  await logActivity({
    userId: req.user.id, action: 'update_admin',
    entityType: 'user', entityId: id,
    details: { fields: Object.keys(updates), permissions_changed: Array.isArray(permissions), password_reset: !!password }, req,
  });

  const { data: refreshed } = await supabaseAdmin
    .from('profiles').select('id, full_name, email, phone, role, branch_id, is_active, role_id, password_plain').eq('id', id).single();
  res.json({ ...refreshed, permissions: await getEffectivePermissions(refreshed) });
});

router.post('/admins/:id/disable', async (req, res) => {
  const { id } = req.params;
  await supabaseAdmin.from('profiles').update({ is_active: false }).eq('id', id);
  await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  invalidateAll();
  await logActivity({
    userId: req.user.id, action: 'disable_admin', entityType: 'user', entityId: id, req,
  });
  res.json({ ok: true });
});

router.post('/admins/:id/enable', async (req, res) => {
  const { id } = req.params;
  await supabaseAdmin.from('profiles').update({ is_active: true }).eq('id', id);
  await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' });
  invalidateAll();
  await logActivity({
    userId: req.user.id, action: 'enable_admin', entityType: 'user', entityId: id, req,
  });
  res.json({ ok: true });
});

// Diffs the requested permission set against the admin default bundle and
// writes explicit grant/deny override rows so super_admin can both add and
// remove permissions vs. the default.
async function applyAdminPermissionSet(userId, requestedPerms) {
  const requested = new Set(requestedPerms);
  const bundle = new Set(DEFAULT_BUNDLES.admin);
  await supabaseAdmin.from('user_permission_overrides').delete().eq('user_id', userId);

  const rows = [];
  for (const p of requested) {
    if (!bundle.has(p)) rows.push({ user_id: userId, permission_id: p, grant: true });
  }
  for (const p of bundle) {
    if (!requested.has(p)) rows.push({ user_id: userId, permission_id: p, grant: false });
  }
  if (rows.length) await supabaseAdmin.from('user_permission_overrides').insert(rows);
}

// ---------------------------------------------------------------------------
// Phones registry (global)
// ---------------------------------------------------------------------------
router.get('/phones', async (req, res) => {
  let q = supabaseAdmin
    .from('devices')
    .select('*, orders(id, order_no, device_locked, customer_id, customers(customer_name, phone_1, account_no)), branches(id, name)')
    .order('last_seen_at', { ascending: false, nullsFirst: false });

  if (req.query.status) q = q.eq('status', req.query.status);
  if (req.query.branch_id) q = q.eq('branch_id', req.query.branch_id);
  if (req.query.search) {
    const s = String(req.query.search).replace(/[(),%*"'\\]/g, '').slice(0, 60);
    if (s) q = q.ilike('imei', `%${s}%`);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/phones/stats', async (_req, res) => {
  const { data: devices, error } = await supabaseAdmin
    .from('devices').select('status, branch_id, last_seen_at, branches(name)');
  if (error) return res.status(500).json({ error: error.message });

  const total = devices.length;
  const byStatus = { active: 0, locked: 0, offline: 0, pending: 0 };
  const byBranch = {};
  const OFFLINE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const d of devices) {
    if (byStatus[d.status] !== undefined) byStatus[d.status]++;
    const branchName = d.branches?.name || 'Unassigned';
    if (!byBranch[branchName]) byBranch[branchName] = { total: 0, locked: 0, offline: 0 };
    byBranch[branchName].total++;
    if (d.status === 'locked') byBranch[branchName].locked++;
    if (!d.last_seen_at || now - new Date(d.last_seen_at).getTime() > OFFLINE_THRESHOLD_MS) {
      byBranch[branchName].offline++;
    }
  }
  res.json({ total, by_status: byStatus, by_branch: byBranch });
});

// ---------------------------------------------------------------------------
// System overview (global KPIs)
// ---------------------------------------------------------------------------
router.get('/system-overview', async (_req, res) => {
  const [{ count: branchesCount }, { count: usersCount }, { count: customersCount }, { count: devicesCount }] =
    await Promise.all([
      supabaseAdmin.from('branches').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('customers').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('devices').select('id', { count: 'exact', head: true }),
    ]);

  const { data: insts } = await supabaseAdmin
    .from('installments').select('amount_due, amount_paid, payment_date');

  let collected = 0;
  let outstanding = 0;
  let collectedYTD = 0;
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

  for (const i of insts || []) {
    const due = Number(i.amount_due || 0);
    const paid = Number(i.amount_paid || 0);
    collected += paid;
    outstanding += Math.max(0, due - paid);
    if (i.payment_date && i.payment_date >= yearStart) collectedYTD += paid;
  }

  res.json({
    branches: branchesCount || 0,
    users: usersCount || 0,
    customers: customersCount || 0,
    devices: devicesCount || 0,
    money_in_market: outstanding,
    collected_total: collected,
    collected_ytd: collectedYTD,
  });
});

module.exports = router;
