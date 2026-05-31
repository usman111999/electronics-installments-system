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

router.delete('/:id', requirePermission('branches.delete'), async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin.from('branches').update({ is_active: false }).eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, branchId: id, action: 'delete_branch',
    entityType: 'branch', entityId: id, req,
  });
  res.json({ ok: true });
});

module.exports = router;
