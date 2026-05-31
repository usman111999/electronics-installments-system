const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  let q = supabaseAdmin.from('products').select('*').order('created_at', { ascending: false });
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.search) {
    const s = String(req.query.search).replace(/[(),%*"'\\]/g, '').slice(0, 60);
    if (s) q = q.ilike('name', `%${s}%`);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

router.post('/', requirePermission('products.manage'), async (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'name is required' });

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: body.name,
      model: body.model,
      company: body.company,
      category: body.category,
      description: body.description,
      base_price: body.base_price || 0,
      default_installment_price: body.default_installment_price,
      discount_percent: body.discount_percent || 0,
      discount_label: body.discount_label,
      image_url: body.image_url,
      is_active: body.is_active !== false,
    })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, action: 'create_product',
    entityType: 'product', entityId: data.id, details: { name: data.name }, req,
  });
  res.status(201).json(data);
});

router.patch('/:id', requirePermission('products.manage'), async (req, res) => {
  const updates = req.body || {};
  delete updates.id;
  const { data, error } = await supabaseAdmin
    .from('products').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, action: 'update_product',
    entityType: 'product', entityId: req.params.id, details: updates, req,
  });
  res.json(data);
});

router.delete('/:id', requirePermission('products.manage'), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('products').update({ is_active: false }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await logActivity({
    userId: req.user.id, action: 'delete_product',
    entityType: 'product', entityId: req.params.id, req,
  });
  res.json({ ok: true });
});

module.exports = router;
