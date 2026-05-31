const { supabaseAdmin } = require('../config/supabase');

async function logActivity({ userId, branchId, action, entityType, entityId, details, req }) {
  try {
    await supabaseAdmin.from('activity_logs').insert({
      user_id: userId || null,
      branch_id: branchId || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: details || null,
      ip_address: req?.ip || req?.headers?.['x-forwarded-for'] || null,
      user_agent: req?.headers?.['user-agent'] || null,
    });
  } catch (e) {
    console.error('[activityLog] failed', e.message);
  }
}

module.exports = { logActivity };
