// Seed the permissions registry (idempotent). Run after 09_rbac.sql.
// Usage: npm run seed:permissions
require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

// Mirrors §2.8 of docs/SUPER_ADMIN_RBAC_SPEC.md.
const PERMISSIONS = [
  // Branches
  { id: 'branches.view',             category: 'Branches',     description: 'View branches' },
  { id: 'branches.create',           category: 'Branches',     description: 'Create branch' },
  { id: 'branches.update',           category: 'Branches',     description: 'Edit branch' },
  { id: 'branches.delete',           category: 'Branches',     description: 'Delete branch' },
  // Users
  { id: 'users.view',                category: 'Users',        description: 'View users' },
  { id: 'users.create',              category: 'Users',        description: 'Create operator/customer/custom-role users' },
  { id: 'users.update',              category: 'Users',        description: 'Edit user (incl. password reset)' },
  { id: 'users.disable',             category: 'Users',        description: 'Disable user' },
  // Roles
  { id: 'roles.view',                category: 'Roles',        description: 'View custom roles' },
  { id: 'roles.manage',              category: 'Roles',        description: 'Create / edit / delete custom roles' },
  // Admins (super_admin gated in practice, but kept as permissions for completeness)
  { id: 'admins.view',               category: 'Admins',       description: 'View admin accounts (super_admin only)' },
  { id: 'admins.manage',             category: 'Admins',       description: 'Create / edit admin accounts (super_admin)' },
  // Products
  { id: 'products.view',             category: 'Products',     description: 'View products' },
  { id: 'products.manage',           category: 'Products',     description: 'Create / edit / delete products' },
  // Inventory
  { id: 'inventory.view',            category: 'Inventory',    description: 'View stock' },
  { id: 'inventory.manage',          category: 'Inventory',    description: 'Add / edit / remove inventory' },
  // Customers
  { id: 'customers.view',            category: 'Customers',    description: 'View customers' },
  { id: 'customers.manage',          category: 'Customers',    description: 'Create / edit customers' },
  // Orders
  { id: 'orders.view',               category: 'Orders',       description: 'View orders' },
  { id: 'orders.create',             category: 'Orders',       description: 'Create orders' },
  { id: 'orders.update',             category: 'Orders',       description: 'Edit orders' },
  // Installments
  { id: 'installments.view',         category: 'Installments', description: 'View installments' },
  { id: 'installments.record_payment', category: 'Installments', description: 'Record customer payments' },
  // Devices
  { id: 'devices.view',              category: 'Devices',      description: 'View enrolled phones' },
  { id: 'devices.enroll',            category: 'Devices',      description: 'Issue enrollment QR / register device' },
  { id: 'devices.lock',              category: 'Devices',      description: 'Lock a device' },
  { id: 'devices.unlock',            category: 'Devices',      description: 'Unlock a device' },
  { id: 'devices.locate',            category: 'Devices',      description: 'Request on-demand location' },
  { id: 'devices.global_view',       category: 'Devices',      description: 'View phones across all branches' },
  // Activity
  { id: 'activity_logs.view',        category: 'Activity',     description: 'View activity logs' },
  { id: 'activity_logs.global_view', category: 'Activity',     description: 'View activity across all branches' },
  // WhatsApp
  { id: 'whatsapp.send',             category: 'WhatsApp',     description: 'Send WhatsApp messages' },
  { id: 'whatsapp.view',             category: 'WhatsApp',     description: 'View WhatsApp log' },
  // Reports
  { id: 'stats.view',                category: 'Reports',      description: 'View stats / KPIs (branch-scoped)' },
  { id: 'stats.global_view',         category: 'Reports',      description: 'View global stats across all branches' },
];

function expand(p) {
  const [resource, action] = p.id.split('.');
  return { ...p, resource, action };
}

async function main() {
  console.log(`[seed:permissions] upserting ${PERMISSIONS.length} permissions…`);
  const rows = PERMISSIONS.map(expand);
  const { error } = await supabaseAdmin.from('permissions').upsert(rows, { onConflict: 'id' });
  if (error) {
    console.error('[seed:permissions] failed:', error.message);
    process.exit(1);
  }
  const { count } = await supabaseAdmin
    .from('permissions').select('id', { count: 'exact', head: true });
  console.log(`[seed:permissions] OK — registry now has ${count} permissions`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
