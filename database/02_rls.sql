-- =====================================================
-- Row Level Security Policies
-- We rely on the backend service-role key for most data access
-- so RLS is enabled but the backend bypasses it. Customer
-- self-service reads go through anon key with restrictive policies.
-- =====================================================

alter table branches enable row level security;
alter table profiles enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table customers enable row level security;
alter table guarantors enable row level security;
alter table orders enable row level security;
alter table installments enable row level security;
alter table activity_logs enable row level security;
alter table whatsapp_notifications enable row level security;

-- A profile can read its own row
drop policy if exists "self read profile" on profiles;
create policy "self read profile" on profiles
  for select using (auth.uid() = id);

-- Customers can read products
drop policy if exists "anyone authenticated reads products" on products;
create policy "anyone authenticated reads products" on products
  for select using (auth.role() = 'authenticated');

-- Customer reads own customer row
drop policy if exists "customer reads own customer" on customers;
create policy "customer reads own customer" on customers
  for select using (profile_id = auth.uid());

-- Customer reads own orders
drop policy if exists "customer reads own orders" on orders;
create policy "customer reads own orders" on orders
  for select using (
    customer_id in (select id from customers where profile_id = auth.uid())
  );

-- Customer reads own installments
drop policy if exists "customer reads own installments" on installments;
create policy "customer reads own installments" on installments
  for select using (
    order_id in (
      select id from orders where customer_id in (
        select id from customers where profile_id = auth.uid()
      )
    )
  );
