const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
router.use(authenticate);

// GET /inventory - scoped by branch for operators
router.get('/', async (req, res) => {
  let q = supabaseAdmin
    .from('inventory')
    .select('*, products(id, name, model, company, base_price, image_url), branches(id, name, code)')
    .order('created_at', { ascending: false });

  const branchScope = scopeBranch(req);
  if (branchScope) q = q.eq('branch_id', branchScope);
  if (req.query.branch_id && req.user.role === 'admin') q = q.eq('branch_id', req.query.branch_id);
  if (req.query.status) q = q.eq('status', req.query.status);
  if (req.query.product_id) q = q.eq('product_id', req.query.product_id);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /inventory - admin or operator add stock
router.post('/', requirePermission('inventory.manage'), async (req, res) => {
  const body = req.body || {};
  const branch_id = req.user.role === 'admin' ? (body.branch_id || req.user.branch_id) : req.user.branch_id;
  if (!branch_id) return res.status(400).json({ error: 'branch_id is required' });
  if (!body.product_id) return res.status(400).json({ error: 'product_id is required' });

  const { data, error } = await supabaseAdmin.from('inventory').insert({
    product_id: body.product_id,
    branch_id,
    serial_no: body.serial_no || null,
    cost_price: body.cost_price || null,
    status: body.status || 'in_stock',
    notes: body.notes || null,
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, branchId: branch_id, action: 'add_inventory',
    entityType: 'inventory', entityId: data.id, details: { product_id: body.product_id }, req,
  });
  res.status(201).json(data);
});

router.patch('/:id', requirePermission('inventory.manage'), async (req, res) => {
  const updates = req.body || {};
  delete updates.id;

  // operator can only update inventory in their branch
  if (req.user.role === 'operator') {
    const { data: existing } = await supabaseAdmin
      .from('inventory').select('branch_id').eq('id', req.params.id).single();
    if (!existing || existing.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    delete updates.branch_id;
  }

  const { data, error } = await supabaseAdmin
    .from('inventory').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await logActivity({
    userId: req.user.id, branchId: data.branch_id, action: 'update_inventory',
    entityType: 'inventory', entityId: req.params.id, details: updates, req,
  });
  res.json(data);
});

router.delete('/:id', requirePermission('inventory.manage'), async (req, res) => {
  const { id } = req.params;
  if (req.user.role === 'operator') {
    const { data: existing } = await supabaseAdmin
      .from('inventory').select('branch_id').eq('id', id).single();
    if (!existing || existing.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  const { error } = await supabaseAdmin.from('inventory').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, action: 'delete_inventory', entityType: 'inventory', entityId: id, req,
  });
  res.json({ ok: true });
});

module.exports = router;
