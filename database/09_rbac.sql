-- =====================================================
-- 09_rbac.sql — Super Admin + RBAC + Phones Registry
-- Idempotent: safe to re-run.
-- =====================================================

-- 2.1 widen profiles.role to allow super_admin
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'operator', 'customer'));

-- 2.2 custom role templates
create table if not exists roles (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  description text,
  is_system boolean not null default false,
  base_role text not null
    check (base_role in ('admin', 'operator', 'customer')),
  branch_id uuid references branches(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2.3 permission registry (seeded from JS so descriptions stay close to UI strings)
create table if not exists permissions (
  id text primary key,
  resource text not null,
  action text not null,
  description text not null,
  category text not null
);

-- 2.4 role -> permission grants
create table if not exists role_permissions (
  role_id uuid references roles(id) on delete cascade,
  permission_id text references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- 2.5 per-user overrides on top of the role-derived set
create table if not exists user_permission_overrides (
  user_id uuid references profiles(id) on delete cascade,
  permission_id text references permissions(id) on delete cascade,
  -- "grant" is a reserved SQL keyword; must be quoted in DDL and DML
  "grant" boolean not null,
  primary key (user_id, permission_id)
);

-- 2.6 custom-role pointer on profile
alter table profiles add column if not exists role_id uuid references roles(id) on delete set null;

-- 2.7 indexes
create index if not exists idx_roles_branch on roles(branch_id);
create index if not exists idx_profiles_role_id on profiles(role_id);

drop trigger if exists trg_roles_updated on roles;
create trigger trg_roles_updated before update on roles
for each row execute function set_updated_at();
