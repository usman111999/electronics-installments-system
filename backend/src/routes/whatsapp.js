const express = require('express');
const { authenticate, requirePermission, scopeBranch, scopeCompany } = require('../middleware/auth');
const { runReminderJob } = require('../services/scheduler');
const { sendWhatsApp } = require('../services/whatsapp');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();
router.use(authenticate);

router.post('/run-reminders', requirePermission('whatsapp.send'), async (req, res) => {
  // Scope to the caller's tenant (null for super_admin = global, as the cron does).
  const result = await runReminderJob({ companyId: scopeCompany(req), branchId: scopeBranch(req) });
  res.json(result);
});

router.post('/send', requirePermission('whatsapp.send'), async (req, res) => {
  const { phone, message, customer_id } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  // A referenced customer must belong to the caller's company — otherwise the
  // logged notification would surface under another tenant's /notifications.
  const cScope = scopeCompany(req);
  if (customer_id && cScope) {
    const { data: cust } = await supabaseAdmin.from('customers').select('company_id').eq('id', customer_id).single();
    if (!cust || cust.company_id !== cScope) {
      return res.status(403).json({ error: 'Customer belongs to another company' });
    }
  }
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
  // Use !inner so the branch filter is actually applied to parent rows.
  // Covers operators AND custom branch-scoped roles via scopeBranch.
  const scope = scopeBranch(req);
  const cScope = scopeCompany(req);
  const needInner = scope || cScope;
  const joinSpec = needInner
    ? 'customers!inner(customer_name, account_no, branch_id, company_id)'
    : 'customers(customer_name, account_no, branch_id, company_id)';

  let q = supabaseAdmin
    .from('whatsapp_notifications')
    .select(`*, ${joinSpec}`)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 200, 1000));

  if (cScope) q = q.eq('customers.company_id', cScope);
  if (scope) q = q.eq('customers.branch_id', scope);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
