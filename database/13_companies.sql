-- =====================================================
-- 13_companies.sql — Multi-company (tenant) layer.
-- Idempotent: safe to re-run.
--
-- Adds a "company" above branches so several independent businesses can share
-- one deployment without ever seeing each other's data:
--   super_admin            → no company_id  → sees EVERY company
--   Company Owner (admin)  → a company_id   → sees only that company
--   Operator               → a company_id + branch_id → one branch
--
-- Products, branches, customers, orders and inventory are all tagged with a
-- company_id so scoping is a simple equality filter (mirrors how branch_id is
-- already denormalised onto customers/orders/inventory).
-- =====================================================

-- 1) The tenant table -------------------------------------------------------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  logo_url text,
  phone text,
  address text,
  is_active boolean default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2) A default company for all existing data (only if none exists yet) ------
insert into companies (name, code)
select 'Ansaf Electronic', 'ANSAF'
where not exists (select 1 from companies);

-- 3) company_id on every tenant-scoped table --------------------------------
--    Data tables cascade (deleting a company removes its data); profiles use
--    SET NULL so we never orphan-delete a login by accident — the delete-company
--    endpoint removes a company's users explicitly.
alter table branches      add column if not exists company_id uuid references companies(id) on delete cascade;
alter table products      add column if not exists company_id uuid references companies(id) on delete cascade;
alter table customers     add column if not exists company_id uuid references companies(id) on delete cascade;
alter table orders        add column if not exists company_id uuid references companies(id) on delete cascade;
alter table inventory     add column if not exists company_id uuid references companies(id) on delete cascade;
alter table roles         add column if not exists company_id uuid references companies(id) on delete cascade;
alter table activity_logs add column if not exists company_id uuid references companies(id) on delete set null;
alter table profiles      add column if not exists company_id uuid references companies(id) on delete set null;

-- devices may not exist on every deployment (device-lock is optional) — guard it.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='devices') then
    execute 'alter table devices add column if not exists company_id uuid references companies(id) on delete cascade';
    execute 'create index if not exists idx_devices_company on devices(company_id)';
  end if;
end $$;

-- 4) Backfill existing rows into the default company ------------------------
--    super_admin stays company-less (NULL) so it keeps seeing everything.
do $$
declare def uuid;
begin
  select id into def from companies order by created_at asc limit 1;
  update branches  set company_id = def where company_id is null;
  update products  set company_id = def where company_id is null;
  update customers set company_id = def where company_id is null;
  update orders    set company_id = def where company_id is null;
  update inventory set company_id = def where company_id is null;
  update roles     set company_id = def where company_id is null;
  update activity_logs set company_id = def where company_id is null;
  update profiles  set company_id = def where company_id is null and role <> 'super_admin';
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='devices') then
    execute 'update devices set company_id = $1 where company_id is null' using def;
  end if;
end $$;

-- 5) Indexes ----------------------------------------------------------------
create index if not exists idx_branches_company  on branches(company_id);
create index if not exists idx_products_company  on products(company_id);
create index if not exists idx_customers_company on customers(company_id);
create index if not exists idx_orders_company    on orders(company_id);
create index if not exists idx_inventory_company on inventory(company_id);
create index if not exists idx_profiles_company  on profiles(company_id);

-- 6) keep updated_at fresh --------------------------------------------------
drop trigger if exists trg_companies_updated on companies;
create trigger trg_companies_updated before update on companies
for each row execute function set_updated_at();
