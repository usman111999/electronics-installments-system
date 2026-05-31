# Super Admin + RBAC + Phones Registry — Implementation Spec v1

Authoritative spec for the new role hierarchy, granular permissions, custom roles,
and global phones registry. **Backend, frontend, and QA must conform to this document.**

---

## 1. Role Hierarchy (4 system roles + N custom)

| Role          | Created by     | Branch-scoped? | Permissions source                                |
|---------------|----------------|----------------|---------------------------------------------------|
| `super_admin` | Seed script    | NO (global)    | Hardcoded: implicit `*` (bypasses every check)    |
| `admin`       | `super_admin`  | NO (global)    | Permissions granted by super_admin per account    |
| `operator`    | `admin` / custom-role users with `users.create` | YES        | Default operator permission set, can be narrowed  |
| `customer`    | `admin` / `operator` | YES       | Self-service only                                 |
| custom roles  | `super_admin` / `admin` with `roles.manage` | YES (configurable) | Permission set chosen at creation time |

`super_admin` is the only role that bypasses permission checks entirely. Everyone else,
including built-in `admin`, is gated by their explicit permission set.

---

## 2. Database Schema (`database/09_rbac.sql`)

```sql
-- 2.1 Update role constraint to allow super_admin
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'operator', 'customer'));

-- 2.2 Roles table — custom role templates
create table if not exists roles (
  id uuid primary key default uuid_generate_v4(),
  name text not null,                          -- 'Salesman', 'Manager', 'Recovery Officer'
  slug text unique not null,                   -- 'salesman', 'manager', 'recovery-officer'
  description text,
  is_system boolean not null default false,    -- super_admin / admin / operator / customer can't be deleted
  base_role text not null
    check (base_role in ('admin', 'operator', 'customer')),  -- super_admin is hardcoded, never a row here
  branch_id uuid references branches(id) on delete cascade,  -- null = global role
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2.3 Permission registry (seeded)
create table if not exists permissions (
  id text primary key,                          -- e.g. 'devices.lock'
  resource text not null,                       -- e.g. 'devices'
  action text not null,                         -- e.g. 'lock'
  description text not null,
  category text not null                        -- UI grouping: 'Devices', 'Sales', 'Admin'
);

-- 2.4 Role -> permission grants
create table if not exists role_permissions (
  role_id uuid references roles(id) on delete cascade,
  permission_id text references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- 2.5 Direct per-user permission grants/revokes (override role)
create table if not exists user_permission_overrides (
  user_id uuid references profiles(id) on delete cascade,
  permission_id text references permissions(id) on delete cascade,
  grant boolean not null,                       -- true = extra grant, false = explicit deny
  primary key (user_id, permission_id)
);

-- 2.6 Add role_id reference to profiles (custom role)
alter table profiles add column if not exists role_id uuid references roles(id) on delete set null;

-- 2.7 Indexes
create index if not exists idx_roles_branch on roles(branch_id);
create index if not exists idx_profiles_role_id on profiles(role_id);
```

### 2.8 Seeded permissions

Seed the `permissions` table with:

| id                          | category    | description                                  |
|-----------------------------|-------------|----------------------------------------------|
| `branches.view`             | Branches    | View branches                                |
| `branches.create`           | Branches    | Create branch                                |
| `branches.update`           | Branches    | Edit branch                                  |
| `branches.delete`           | Branches    | Delete branch                                |
| `users.view`                | Users       | View users                                   |
| `users.create`              | Users       | Create operator/customer/custom-role users   |
| `users.update`              | Users       | Edit user (incl. password reset)             |
| `users.disable`             | Users       | Disable user                                 |
| `roles.view`                | Roles       | View custom roles                            |
| `roles.manage`              | Roles       | Create / edit / delete custom roles          |
| `admins.view`               | Admins      | View admin accounts (super_admin only)       |
| `admins.manage`             | Admins      | Create / edit admin accounts (super_admin)   |
| `products.view`             | Products    | View products                                |
| `products.manage`           | Products    | Create / edit / delete products              |
| `inventory.view`            | Inventory   | View stock                                   |
| `inventory.manage`          | Inventory   | Add / edit / remove inventory                |
| `customers.view`            | Customers   | View customers                               |
| `customers.manage`          | Customers   | Create / edit customers                      |
| `orders.view`               | Orders      | View orders                                  |
| `orders.create`             | Orders      | Create orders                                |
| `orders.update`             | Orders      | Edit orders                                  |
| `installments.view`         | Installments| View installments                            |
| `installments.record_payment`| Installments | Record customer payments                    |
| `devices.view`              | Devices     | View enrolled phones                         |
| `devices.enroll`            | Devices     | Issue enrollment QR / register device        |
| `devices.lock`              | Devices     | Lock a device                                |
| `devices.unlock`            | Devices     | Unlock a device                              |
| `devices.locate`            | Devices     | Request on-demand location                   |
| `devices.global_view`       | Devices     | View phones across **all** branches          |
| `activity_logs.view`        | Activity    | View activity logs                           |
| `activity_logs.global_view` | Activity    | View activity across **all** branches       |
| `whatsapp.send`             | WhatsApp    | Send WhatsApp messages                       |
| `whatsapp.view`             | WhatsApp    | View WhatsApp log                            |
| `stats.view`                | Reports     | View stats / KPIs (branch-scoped)            |
| `stats.global_view`         | Reports     | View global stats across all branches        |

### 2.9 Default permission bundles per built-in base_role

When a user is created with no explicit permission list, they inherit these defaults:

* **`admin`** (default bundle, can be narrowed by super_admin per account):
  `branches.*, users.*, roles.*, products.*, inventory.*, customers.*, orders.*,
  installments.*, devices.view, devices.enroll, devices.lock, devices.unlock,
  devices.locate, devices.global_view, activity_logs.view, activity_logs.global_view,
  whatsapp.*, stats.view, stats.global_view`

* **`operator`** (default bundle, branch-scoped):
  `users.view, users.create (customers only), customers.view, customers.manage,
  products.view, inventory.view, inventory.manage, orders.view, orders.create,
  orders.update, installments.view, installments.record_payment, devices.view,
  devices.enroll, devices.lock, devices.unlock, devices.locate, activity_logs.view,
  whatsapp.send, whatsapp.view, stats.view`

* **`customer`** (default bundle): self-service implicit.

* **`super_admin`**: implicit all (no permission rows needed).

---

## 3. Backend Changes

### 3.1 New middleware (`backend/src/middleware/auth.js`)

* Keep `authenticate`, `requireRole`, `scopeBranch`, `invalidateAll` as-is.
* Add: when loading the profile, also load the user's effective permission set:
  1. If `role === 'super_admin'` → set `req.user.permissions = ['*']`
  2. Else collect: `role_permissions(role_id)` ∪ `user_permission_overrides(grant=true)`
     MINUS `user_permission_overrides(grant=false)`
  3. If `role_id` is null but `role` is built-in → use the default bundle from §2.9.
  4. Cache the resolved permission list inside the existing token cache entry.
* Add `requirePermission(...perms)`:
  ```js
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
  ```
* Export it. `requireRole` stays for back-compat.

### 3.2 New routes

#### `backend/src/routes/superAdmin.js`  (mounted at `/api/super-admin`)
Gated by `requireRole('super_admin')`:
* `GET    /admins`               — list admin accounts (with permissions + branch info)
* `POST   /admins`               — create admin (email, password, full_name, phone, permissions[])
* `PATCH  /admins/:id`           — update admin (incl. password reset, permission set)
* `POST   /admins/:id/disable`   — disable admin
* `POST   /admins/:id/enable`    — re-enable admin
* `GET    /phones`               — global devices list (all branches), with filters: status, branch_id, search by imei/customer
* `GET    /phones/stats`         — aggregate counts: total, active, locked, offline, by-branch breakdown
* `GET    /system-overview`      — global KPIs: branches, users, customers, devices, money in market, payments YTD

#### `backend/src/routes/roles.js` (mounted at `/api/roles`)
Gated by `requirePermission('roles.view')` for reads, `requirePermission('roles.manage')` for writes:
* `GET    /`                      — list roles visible to caller (own-branch + global)
* `GET    /:id`                   — role detail with permissions
* `POST   /`                      — create role
* `PATCH  /:id`                   — update role (name, description, permissions)
* `DELETE /:id`                   — delete role (rejects if any users are assigned)
* `GET    /permissions/registry`  — list all available permissions (for the UI picker)

### 3.3 Convert existing routes from `requireRole` to `requirePermission`

Mapping (replace, keep `requireRole` only for super_admin-restricted endpoints):

| File / endpoint                                  | Old guard                       | New guard                                             |
|--------------------------------------------------|---------------------------------|--------------------------------------------------------|
| `branches.js` POST/PATCH/DELETE                  | `requireRole('admin')`          | `requirePermission('branches.create' / '.update' / '.delete')` |
| `users.js` GET                                   | inline check                    | `requirePermission('users.view')`                      |
| `users.js` POST                                  | inline check                    | `requirePermission('users.create')`                    |
| `users.js` PATCH                                 | inline check                    | `requirePermission('users.update')`                    |
| `users.js` DELETE                                | `requireRole('admin')`          | `requirePermission('users.disable')`                   |
| `products.js` POST/PATCH/DELETE                  | `requireRole('admin')`          | `requirePermission('products.manage')`                 |
| `inventory.js` POST/PATCH/DELETE                 | `requireRole('admin','operator')` | `requirePermission('inventory.manage')`              |
| `customers.js` POST/PATCH                        | `requireRole('admin','operator')` | `requirePermission('customers.manage')`              |
| `orders.js` POST                                 | `requireRole('admin','operator')` | `requirePermission('orders.create')`                 |
| `orders.js` PATCH                                | `requireRole('admin','operator')` | `requirePermission('orders.update')`                 |
| `orders.js` POST /:id/lock                       | `requireRole('admin','operator')` | `requirePermission('devices.lock')`                  |
| `orders.js` POST /:id/unlock                     | `requireRole('admin','operator')` | `requirePermission('devices.unlock')`                |
| `installments.js` POST /:id/pay                  | `requireRole('admin','operator')` | `requirePermission('installments.record_payment')`   |
| `installments.js` POST /mark-overdue             | `requireRole('admin')`          | `requirePermission('installments.record_payment')`     |
| `devices.js` POST /enrollment-tokens             | `requireRole('admin','operator')` | `requirePermission('devices.enroll')`                |
| `devices.js` GET /                               | `requireRole('admin','operator')` | `requirePermission('devices.view')`                  |
| `devices.js` POST /:imei/locate                  | `requireRole('admin','operator')` | `requirePermission('devices.locate')`                |
| `devices.js` POST /run-auto-lock                 | `requireRole('admin')`          | `requirePermission('devices.lock')`                    |
| `stats.js` GET /orders-by-branch                 | `requireRole('admin')`          | `requirePermission('stats.global_view')`               |
| `whatsapp.js` POST /run-reminders                | `requireRole('admin')`          | `requirePermission('whatsapp.send')`                   |
| `activityLogs.js` GET                            | `requireRole('admin','operator')` | `requirePermission('activity_logs.view')`            |

Branch scoping (`scopeBranch`) is **unchanged**. A user with `devices.global_view` permission is allowed to bypass `scopeBranch` filters explicitly via `?global=1` query param on `GET /devices`.

### 3.4 Permission resolution helper

Add `backend/src/services/permissions.js`:
* `getEffectivePermissions(profile)` returns an array of permission strings.
* Handles: super_admin → `['*']`, custom role → role's permissions ∪ overrides, built-in role → default bundle from §2.9.

### 3.5 Users route extensions

In `users.js POST /` and `PATCH /:id`:
* Accept `role_id` (uuid) and `permissions` (string[]).
* If `role_id` provided, set it on profile.
* If `permissions` provided, replace `user_permission_overrides` rows.
* Validate: caller cannot grant a permission they themselves don't have (super_admin exempt).

### 3.6 Seed scripts

* `seedSuperAdmin.js` — idempotent. Default `super@eis.local / Super@123456`. Sets `role='super_admin'`, `branch_id=null`. Pattern from §6 of analyzer report.
* `seedPermissions.js` — populates `permissions` table from §2.8.
* Run order: schema → permissions seed → super admin seed → existing admin seed.
* Update `package.json`: `"seed:super-admin": "node src/scripts/seedSuperAdmin.js"`,
  `"seed:permissions": "node src/scripts/seedPermissions.js"`,
  `"seed:all": "npm run seed:permissions && npm run seed:super-admin && npm run seed:admin"`.

### 3.7 Activity logging
Every super_admin and admin-management action logs to `activity_logs`:
`action='create_admin'`, `action='update_permissions'`, `action='create_role'`, `action='delete_role'`, etc.

### 3.8 Cache invalidation
After ANY of: profile update, role_permissions update, user_permission_overrides update,
role delete — call `invalidateAll()`. Permissions must take effect on next request.

### 3.9 Backwards compat
* Existing admins keep working. On startup, if no super_admin exists, the seed script seeds one.
* Until super_admin is created, the system functions exactly as before.
* Default permission bundles ensure `requirePermission` returns the same yes/no answer as the old `requireRole` for built-in roles.

---

## 4. Frontend Changes

### 4.1 `AuthContext.jsx`
* `/auth/me` now returns `{ user: { ..., permissions: string[] }, branch }`.
* Expose `user.permissions` and a helper `hasPermission(perm)` that returns `true` if
  `'*' ∈ permissions || perm ∈ permissions`.

### 4.2 `ProtectedRoute.jsx`
* New optional prop `permission` (string) or `permissions` (string[]).
* If both `roles` and `permissions` provided, both must pass.
* `roles` kept for back-compat.

### 4.3 `Layout.jsx` sidebar
* Replace hard-coded `navItemsFor(role)` with a single list of `{label, to, icon, requires}` items;
  filter by `hasPermission(requires)`.
* Super admin sees an additional section "**Super Admin**":
  - Admins (`/super-admin/admins`)
  - Phones Registry (`/super-admin/phones`)
  - System Overview (`/super-admin/overview`)
* All users see "Roles" if they have `roles.view` (admin or custom-role with that perm).

### 4.4 New pages

* `pages/super-admin/Admins.jsx` — table of admins, create/edit modal with permission picker grouped by category, password show/hide/copy, enable/disable.
* `pages/super-admin/Phones.jsx` — global phones table with: total/active/locked/offline counters, filter by branch + status + IMEI search, action menu (View, Lock, Unlock, Locate).
* `pages/super-admin/Overview.jsx` — KPI dashboard: branches count, users count, customers count, total money in market, devices status pie, monthly collection trendline.
* `pages/Roles.jsx` — manage custom roles. Same UI for admin and super_admin. Lists roles; "+ New Role" opens modal with name/description + permission checklist grouped by category.

### 4.5 Users.jsx page update
* When creating/editing a user, add a "Role" select that lists: built-in roles caller can grant + custom roles in caller's branch.
* Add an optional "Custom permissions" panel (only super_admin sees this for admins) that lets you add/remove permissions overriding the role default.

### 4.6 `App.jsx` routes

```jsx
<Route element={<ProtectedRoute roles={['super_admin']}><Layout /></ProtectedRoute>}>
  <Route path="/super-admin/admins" element={<SuperAdmins />} />
  <Route path="/super-admin/phones" element={<SuperPhones />} />
  <Route path="/super-admin/overview" element={<SuperOverview />} />
</Route>

<Route element={<ProtectedRoute permission="roles.view"><Layout /></ProtectedRoute>}>
  <Route path="/roles" element={<Roles />} />
</Route>
```

### 4.7 Permission picker component
`components/PermissionPicker.jsx`: checkbox tree grouped by category, fetches
`/api/roles/permissions/registry` once and caches. Used in Admins create modal, Roles
create modal, and Users edit modal (custom overrides section).

### 4.8 Phones registry filtering
On `/super-admin/phones`, allow:
* Status chip filter: All / Active / Locked / Offline / Pending
* Branch dropdown
* IMEI / customer name / order# search
* Sort: Last Seen / Branch / Status
* Stat cards above the table: total devices, locked, offline today, active

---

## 5. QA Acceptance Criteria

1. Seeding super admin from a fresh DB lets `super@eis.local` log in and see the Super Admin sidebar section.
2. Super admin can create a new admin with a custom subset of permissions; that admin can log in and ONLY sees nav items + page contents matching their permissions; missing permissions return 403 from API and the relevant UI buttons are hidden.
3. Admin can create a custom role "Salesman", assign it `customers.view`, `customers.manage`, `orders.create`, `orders.view`. A user assigned to that role:
   - Sees only those nav items.
   - 403s on `POST /products`, `POST /branches`, etc.
   - Is correctly branch-scoped.
4. Super admin disables an admin → the admin's existing tokens are rejected on next request (cache invalidated).
5. Super admin `/phones` lists devices from every branch; an admin without `devices.global_view` sees only their accessible branches.
6. Existing admin/operator/customer flows from the previous Playwright suite still pass (no regressions).
7. All endpoints that previously returned 403 for the wrong role still return 403 under the new permission system (negative tests).
8. Cache invalidation: change a user's permission set; next request reflects the change within 1 second.
9. Deleting a role that has assigned users returns 409 with a list of affected users.
10. Super admin role cannot be deleted, demoted, or disabled by anyone (including itself).

---

## 6. Files to Create / Modify

### Create
* `database/09_rbac.sql`
* `backend/src/services/permissions.js`
* `backend/src/routes/superAdmin.js`
* `backend/src/routes/roles.js`
* `backend/src/scripts/seedPermissions.js`
* `backend/src/scripts/seedSuperAdmin.js`
* `frontend/src/components/PermissionPicker.jsx`
* `frontend/src/pages/Roles.jsx`
* `frontend/src/pages/super-admin/Admins.jsx`
* `frontend/src/pages/super-admin/Phones.jsx`
* `frontend/src/pages/super-admin/Overview.jsx`

### Modify
* `backend/src/middleware/auth.js` (add `requirePermission`, resolve perms in `authenticate`)
* `backend/src/routes/auth.js` (return `permissions` in `/auth/me`)
* `backend/src/routes/users.js` (accept role_id + permissions, validate against caller's perms)
* `backend/src/routes/branches.js`, `products.js`, `inventory.js`, `customers.js`,
  `orders.js`, `installments.js`, `devices.js`, `whatsapp.js`, `activityLogs.js`, `stats.js`
  (swap `requireRole` for `requirePermission` per §3.3)
* `backend/src/server.js` (mount `/api/super-admin` and `/api/roles`)
* `backend/package.json` (new seed scripts)
* `frontend/src/App.jsx` (new routes)
* `frontend/src/components/Layout.jsx` (permission-driven sidebar)
* `frontend/src/components/ProtectedRoute.jsx` (`permission` prop)
* `frontend/src/context/AuthContext.jsx` (expose `permissions` + `hasPermission`)
* `frontend/src/pages/Users.jsx` (role picker + custom-permissions panel)

---

## 7. Out of Scope (Phase 2)

* Audit trail UI of "who changed which permission" — already captured in activity_logs;
  no dedicated UI in this phase.
* Permission inheritance graphs / role composition.
* SAML / SSO.
* Branch-scoped permission grants (a permission that only applies to certain branches).
