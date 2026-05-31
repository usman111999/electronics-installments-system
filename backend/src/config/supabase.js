const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env');
}

// Service-role client - bypasses RLS for trusted backend operations
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Anon client factory used for verifying user JWTs
const supabaseAnon = (accessToken) => createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
});

module.exports = { supabaseAdmin, supabaseAnon, SUPABASE_URL };
