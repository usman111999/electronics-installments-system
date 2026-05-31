const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin } = require('../config/supabase');
const { getEffectivePermissions } = require('../services/permissions');

// Use a dedicated short-lived client for token verification so we don't
// contaminate the global supabaseAdmin client's session — once you call
// auth.getUser(token) on a client it adopts that user's JWT for subsequent
// .from() queries, defeating service-role bypass of RLS.
function verifyToken(token) {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return c.auth.getUser(token);
}

// Short-lived cache: token → { profile, expiresAt }. Avoids hitting Supabase
// auth + profiles on every API call when a user navigates rapidly (each page
// load triggers an /auth/me + several data fetches).
const TOKEN_CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

function getCached(token) {
  const entry = cache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(token); return null; }
  return entry.profile;
}

function setCached(token, profile) {
  cache.set(token, { profile, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  // Cap cache size to prevent unbounded growth
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

function invalidateToken(token) { if (token) cache.delete(token); }
function invalidateAll() { cache.clear(); }

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing access token' });

    const cached = getCached(token);
    if (cached) {
      req.user = cached;
      req.accessToken = token;
      return next();
    }

    const { data: userData, error: userErr } = await verifyToken(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, role, branch_id, is_active, role_id')
      .eq('id', userData.user.id)
      .single();

    if (profileErr || !profile) {
      return res.status(403).json({ error: 'No profile found for this user' });
    }
    if (!profile.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    // Resolve permissions once per token entry; downstream guards (and the
    // sidebar via /auth/me) read straight off req.user.permissions.
    profile.permissions = await getEffectivePermissions(profile);

    setCached(token, profile);
    req.user = profile;
    req.accessToken = token;
    next();
  } catch (e) {
    console.error('[auth] error', e);
    res.status(500).json({ error: 'Auth error' });
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden — requires role: ${allowed.join(' / ')}` });
    }
    next();
  };
}

// Any of the listed permissions satisfies the guard. super_admin (which has
// '*' in its set) always passes.
function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const granted = req.user.permissions || [];
    if (granted.includes('*')) return next();
    const ok = perms.some(p => granted.includes(p));
    if (!ok) return res.status(403).json({ error: 'Forbidden', missing: perms });
    next();
  };
}

function scopeBranch(req) {
  if (!req.user) return null;
  // super_admin sees everything by default; admin still global as before.
  if (req.user.role === 'admin' || req.user.role === 'super_admin') return null;
  return req.user.branch_id;
}

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  scopeBranch,
  invalidateToken,
  invalidateAll,
};
