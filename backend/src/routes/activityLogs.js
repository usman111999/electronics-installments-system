const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requirePermission, scopeBranch } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('activity_logs.view'), async (req, res) => {
  let q = supabaseAdmin
    .from('activity_logs')
    .select('*, profiles!activity_logs_user_id_fkey(full_name, role, email), branches(name)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 200, 1000));

  // Admins see everything; operators see only their branch activity
  const scope = scopeBranch(req);
  if (scope) q = q.eq('branch_id', scope);
  if (req.query.branch_id && req.user.role === 'admin') q = q.eq('branch_id', req.query.branch_id);
  if (req.query.user_id) q = q.eq('user_id', req.query.user_id);
  if (req.query.action) q = q.eq('action', req.query.action);
  if (req.query.from) q = q.gte('created_at', req.query.from);
  if (req.query.to) q = q.lte('created_at', req.query.to);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
