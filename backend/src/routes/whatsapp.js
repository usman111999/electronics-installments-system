const express = require('express');
const { authenticate, requirePermission } = require('../middleware/auth');
const { runReminderJob } = require('../services/scheduler');
const { sendWhatsApp } = require('../services/whatsapp');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();
router.use(authenticate);

router.post('/run-reminders', requirePermission('whatsapp.send'), async (_req, res) => {
  const result = await runReminderJob();
  res.json(result);
});

router.post('/send', requirePermission('whatsapp.send'), async (req, res) => {
  const { phone, message, customer_id } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    await sendWhatsApp({ phone, message });
    await supabaseAdmin.from('whatsapp_notifications').insert({
      customer_id: customer_id || null,
      installment_id: null,
      phone, message, status: 'sent', sent_at: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    await supabaseAdmin.from('whatsapp_notifications').insert({
      customer_id: customer_id || null, phone, message, status: 'failed', error_message: e.message,
    });
    res.status(500).json({ error: e.message });
  }
});

router.get('/notifications', requirePermission('whatsapp.view'), async (req, res) => {
  // Use !inner so the branch filter is actually applied to parent rows
  const joinSpec = req.user.role === 'operator'
    ? 'customers!inner(customer_name, account_no, branch_id)'
    : 'customers(customer_name, account_no, branch_id)';

  let q = supabaseAdmin
    .from('whatsapp_notifications')
    .select(`*, ${joinSpec}`)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 200, 1000));

  if (req.user.role === 'operator') {
    q = q.eq('customers.branch_id', req.user.branch_id);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
