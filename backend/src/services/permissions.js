// Resolves a profile's effective permission set per §2.9/§3.4 of
// docs/SUPER_ADMIN_RBAC_SPEC.md. The result is the single source of truth
// `requirePermission` checks against; do not duplicate this logic anywhere.

const { supabaseAdmin } = require('../config/supabase');

// Default bundles per built-in base role (§2.9).
// Stored as plain arrays so the resolver returns the same shape regardless of
// whether a user has a custom role row or not.
const DEFAULT_BUNDLES = {
  admin: [
    'branches.view', 'branches.create', 'branches.update', 'branches.delete',
    'users.view', 'users.create', 'users.update', 'users.disable',
    'roles.view', 'roles.manage',
    'products.view', 'products.manage',
    'inventory.view', 'inventory.manage',
    'customers.view', 'customers.manage',
    'orders.view', 'orders.create', 'orders.update',
    'installments.view', 'installments.record_payment',
    'devices.view', 'devices.enroll', 'devices.lock', 'devices.unlock',
    'devices.locate', 'devices.global_view',
    'activity_logs.view', 'activity_logs.global_view',
    'whatsapp.send', 'whatsapp.view',
    'stats.view', 'stats.global_view',
  ],
  operator: [
    'users.view', 'users.create',
    'customers.view', 'customers.manage',
    'products.view', 'products.manage',
    'inventory.view', 'inventory.manage',
    'orders.view', 'orders.create', 'orders.update',
    'installments.view', 'installments.record_payment',
    'devices.view', 'devices.enroll', 'devices.lock', 'devices.unlock',
    'devices.locate',
    'activity_logs.view',
    'whatsapp.send', 'whatsapp.view',
    'stats.view',
  ],
  // customer self-service is gated by per-route owner checks, not perms
  customer: [],
};

async function getEffectivePermissions(profile) {
  if (!profile) return [];
  // super_admin bypasses every check
  if (profile.role === 'super_admin') return ['*'];

  let base = [];
  if (profile.role_id) {
    // Custom role: join role_permissions
    const { data: rps } = await supabaseAdmin
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', profile.role_id);
    base = (rps || []).map(r => r.permission_id);
  } else {
    // Built-in role with no row in `roles` -> default bundle
    base = DEFAULT_BUNDLES[profile.role] || [];
  }

  // Per-user overrides on top of the base set
  const { data: overrides } = await supabaseAdmin
    .from('user_permission_overrides')
    .select('permission_id, grant')
    .eq('user_id', profile.id);

  const set = new Set(base);
  for (const o of overrides || []) {
    if (o.grant) set.add(o.permission_id);
    else set.delete(o.permission_id);
  }
  return Array.from(set);
}

module.exports = { getEffectivePermissions, DEFAULT_BUNDLES };
