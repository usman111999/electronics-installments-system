const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');
const { getEffectivePermissions } = require('../services/permissions');

const router = express.Router();

// Throw-away client per login so we don't contaminate supabaseAdmin's session
function signInClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const { data, error } = await signInClient().auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, phone, role, branch_id, is_active, role_id')
    .eq('id', data.user.id)
    .single();

  if (profileErr || !profile) {
    return res.status(403).json({ error: 'Profile not found — contact administrator' });
  }
  if (!profile.is_active) {
    return res.status(403).json({ error: 'Account is disabled' });
  }

  // Frontend reads permissions off the login response immediately to render
  // the right nav before /auth/me has a chance to resolve.
  profile.permissions = await getEffectivePermissions(profile);

  await logActivity({
    userId: profile.id,
    branchId: profile.branch_id,
    action: 'login',
    entityType: 'auth',
    req,
  });

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: profile,
  });
});

router.post('/logout', authenticate, async (req, res) => {
  await logActivity({
    userId: req.user.id,
    branchId: req.user.branch_id,
    action: 'logout',
    entityType: 'auth',
    req,
  });
  res.json({ ok: true });
});

router.get('/me', authenticate, async (req, res) => {
  let branch = null;
  if (req.user.branch_id) {
    const { data } = await supabaseAdmin
      .from('branches')
      .select('id, name, code, city')
      .eq('id', req.user.branch_id)
      .single();
    branch = data;
  }
  // req.user.permissions is already populated by authenticate middleware
  res.json({ user: req.user, branch });
});

module.exports = router;
