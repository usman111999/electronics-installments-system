-- =====================================================
-- Electronics Installments System - Database Schema
-- Supabase / PostgreSQL
-- =====================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =====================================================
-- BRANCHES
-- =====================================================
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  address text,
  city text,
  phone text,
  manager_name text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =====================================================
-- PROFILES (extends auth.users) - role-based access
-- =====================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text not null check (role in ('admin', 'operator', 'customer')),
  branch_id uuid references branches(id) on delete set null,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_branch on profiles(branch_id);

-- =====================================================
-- PRODUCTS (electronics catalog)
-- =====================================================
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text,
  company text,
  category text,
  description text,
  base_price numeric(12,2) not null default 0,
  default_installment_price numeric(12,2),
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_products_active on products(is_active);

-- =====================================================
-- INVENTORY (per branch stock with serial numbers)
-- =====================================================
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  serial_no text,
  cost_price numeric(12,2),
  status text default 'in_stock' check (status in ('in_stock', 'sold', 'reserved', 'damaged', 'returned')),
  received_at timestamptz default now(),
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_inventory_branch on inventory(branch_id);
create index if not exists idx_inventory_status on inventory(status);

-- =====================================================
-- CUSTOMERS (full customer details)
-- =====================================================
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  branch_id uuid references branches(id) not null,
  account_no text unique not null,
  customer_name text not null,
  father_husband_name text,
  cnic text,
  picture_url text,
  gender text,
  home_address text,
  official_address text,
  phone_1 text not null,
  phone_2 text,
  occupation text,
  monthly_income numeric(12,2),
  employee_status text,
  crc_remarks text,
  dbm_remarks text,
  second_remarks text,
  is_active boolean default true,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_customers_branch on customers(branch_id);
create index if not exists idx_customers_account on customers(account_no);
create index if not exists idx_customers_phone on customers(phone_1);

-- =====================================================
-- GUARANTORS (multiple per customer)
-- =====================================================
create table if not exists guarantors (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  guarantor_number int not null,
  name text not null,
  father_name text,
  cnic text,
  home_address text,
  official_address text,
  phone_1 text,
  phone_2 text,
  occupation text,
  relation text,
  created_at timestamptz default now(),
  unique(customer_id, guarantor_number)
);

-- =====================================================
-- ORDERS (sale with installment plan)
-- =====================================================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  customer_id uuid references customers(id) on delete restrict,
  branch_id uuid references branches(id) not null,
  product_id uuid references products(id),
  inventory_id uuid references inventory(id),
  product_name_snapshot text,
  product_model_snapshot text,
  product_serial_snapshot text,
  order_date date not null default current_date,
  total_price numeric(12,2) not null,
  advance_payment numeric(12,2) default 0,
  discount numeric(12,2) default 0,
  installment_amount numeric(12,2) not null,
  total_installments int not null,
  duration_months int not null,
  due_day int default 5,
  status text default 'active' check (status in ('active', 'completed', 'defaulted', 'cancelled')),
  recovery_officer text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_orders_branch on orders(branch_id);
create index if not exists idx_orders_customer on orders(customer_id);
create index if not exists idx_orders_status on orders(status);

-- =====================================================
-- INSTALLMENTS
-- =====================================================
create table if not exists installments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  installment_no int not null,
  due_date date not null,
  amount_due numeric(12,2) not null,
  amount_paid numeric(12,2) default 0,
  payment_date date,
  receipt_no text,
  pre_balance numeric(12,2),
  balance numeric(12,2),
  fine numeric(12,2) default 0,
  discount numeric(12,2) default 0,
  status text default 'pending' check (status in ('pending', 'paid', 'overdue', 'partial')),
  recovery_officer text,
  remarks text,
  collected_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(order_id, installment_no)
);

create index if not exists idx_installments_order on installments(order_id);
create index if not exists idx_installments_status on installments(status);
create index if not exists idx_installments_due_date on installments(due_date);

-- =====================================================
-- ACTIVITY LOGS
-- =====================================================
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

create index if not exists idx_activity_logs_user on activity_logs(user_id);
create index if not exists idx_activity_logs_branch on activity_logs(branch_id);
create index if not exists idx_activity_logs_created on activity_logs(created_at desc);

-- =====================================================
-- WHATSAPP NOTIFICATIONS LOG
-- =====================================================
create table if not exists whatsapp_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  installment_id uuid references installments(id) on delete cascade,
  phone text not null,
  message text not null,
  status text default 'pending' check (status in ('pending', 'sent', 'failed', 'delivered')),
  sent_at timestamptz,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_whatsapp_status on whatsapp_notifications(status);
create index if not exists idx_whatsapp_installment on whatsapp_notifications(installment_id);

-- =====================================================
-- Helpful trigger to keep updated_at fresh
-- =====================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
for each row execute function set_updated_at();

drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
for each row execute function set_updated_at();

drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated before update on customers
for each row execute function set_updated_at();

drop trigger if exists trg_orders_updated on orders;
create trigger trg_orders_updated before update on orders
for each row execute function set_updated_at();

drop trigger if exists trg_installments_updated on installments;
create trigger trg_installments_updated before update on installments
for each row execute function set_updated_at();

drop trigger if exists trg_branches_updated on branches;
create trigger trg_branches_updated before update on branches
for each row execute function set_updated_at();
