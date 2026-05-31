// Seed an initial admin user. Idempotent — run as many times as you want.
// Usage: npm run seed:admin
require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@eis.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const full_name = process.env.ADMIN_NAME || 'System Administrator';

  console.log(`[seed] ensuring admin ${email} ...`);

  // Step 1 — make sure auth user exists
  let userId = null;
  const { data: existingByEmail } = await supabaseAdmin.auth.admin.listUsers({
    page: 1, perPage: 200,
  });
  const found = existingByEmail?.users?.find(u => u.email === email);
  if (found) {
    userId = found.id;
    console.log(`[seed] auth user already exists: ${userId}`);
    // ensure password is reset to the seeded one for first login
    await supabaseAdmin.auth.admin.updateUserById(userId, { password });
  } else {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name, role: 'admin' },
    });
    if (createErr) {
      console.error('[seed] auth create error', createErr);
      process.exit(1);
    }
    userId = created.user.id;
    console.log(`[seed] auth user created: ${userId}`);
  }

  // Step 2 — make sure profile exists (table must exist; if not, instruct user)
  const { data: profile, error: profileLookupErr } = await supabaseAdmin
    .from('profiles').select('id, role').eq('id', userId).maybeSingle();

  if (profileLookupErr) {
    if (profileLookupErr.message?.includes('schema cache') || profileLookupErr.code === 'PGRST205') {
      console.error('[seed] ❌ profiles table not found. Apply database/01_schema.sql in the Supabase SQL Editor first, then re-run this command.');
      process.exit(1);
    }
    console.error('[seed] profile lookup error', profileLookupErr);
    process.exit(1);
  }

  if (profile) {
    await supabaseAdmin.from('profiles')
      .update({ role: 'admin', is_active: true, password_plain: password })
      .eq('id', userId);
    console.log('[seed] admin profile updated with current password');
  } else {
    const { error: insErr } = await supabaseAdmin.from('profiles').insert({
      id: userId, full_name, email, role: 'admin', is_active: true, password_plain: password,
    });
    if (insErr) {
      console.error('[seed] profile insert error', insErr);
      process.exit(1);
    }
    console.log('[seed] profile created');
  }

  console.log(`[seed] ✅ done — email: ${email}  password: ${password}`);
  console.log('[seed] CHANGE THIS PASSWORD ON FIRST LOGIN.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
