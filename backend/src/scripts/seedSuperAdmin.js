// Seed the bootstrap super_admin (idempotent). Run after schema + permissions.
// Usage: npm run seed:super-admin
require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'super@eis.local';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'Super@123456';
  const full_name = process.env.SUPER_ADMIN_NAME || 'Super Administrator';

  console.log(`[seed:super-admin] ensuring super admin ${email} ...`);

  // Step 1 — find or create the auth user
  let userId = null;
  const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = existing?.users?.find(u => u.email === email);
  if (found) {
    userId = found.id;
    // re-assert the seeded password so a forgotten password is recoverable
    await supabaseAdmin.auth.admin.updateUserById(userId, { password, ban_duration: 'none' });
    console.log(`[seed:super-admin] auth user already exists: ${userId}`);
  } else {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name, role: 'super_admin' },
    });
    if (createErr) { console.error('[seed:super-admin] auth create error', createErr); process.exit(1); }
    userId = created.user.id;
    console.log(`[seed:super-admin] auth user created: ${userId}`);
  }

  // Step 2 — ensure profile exists and is set to super_admin / branch=null
  const { data: profile, error: lookupErr } = await supabaseAdmin
    .from('profiles').select('id, role').eq('id', userId).maybeSingle();

  if (lookupErr) {
    if (lookupErr.code === 'PGRST205' || /schema cache/.test(lookupErr.message || '')) {
      console.error('[seed:super-admin] ❌ profiles table not found. Apply database/01_schema.sql + 09_rbac.sql first.');
      process.exit(1);
    }
    console.error('[seed:super-admin] profile lookup error', lookupErr);
    process.exit(1);
  }

  if (profile) {
    const { error } = await supabaseAdmin.from('profiles').update({
      role: 'super_admin',
      branch_id: null,
      is_active: true,
      password_plain: password,
      role_id: null,
    }).eq('id', userId);
    if (error) { console.error('[seed:super-admin] profile update error', error); process.exit(1); }
    console.log('[seed:super-admin] profile updated');
  } else {
    const { error } = await supabaseAdmin.from('profiles').insert({
      id: userId, full_name, email,
      role: 'super_admin', branch_id: null, is_active: true,
      password_plain: password,
    });
    if (error) { console.error('[seed:super-admin] profile insert error', error); process.exit(1); }
    console.log('[seed:super-admin] profile created');
  }

  // Clean up any stale overrides — super_admin's permissions are implicit ('*').
  await supabaseAdmin.from('user_permission_overrides').delete().eq('user_id', userId);

  console.log(`[seed:super-admin] ✅ done — email: ${email}  password: ${password}`);
  console.log('[seed:super-admin] CHANGE THIS PASSWORD ON FIRST LOGIN.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
