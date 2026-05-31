-- =====================================================
-- Disable RLS on all tables.
--
-- Architecture note: the frontend never talks to Supabase directly with
-- the anon key. Every read/write goes through the Express backend, which
-- uses the service_role key (bypasses RLS anyway). Keeping RLS enabled
-- without policies just shows a misleading "no data will be returned"
-- warning in the Supabase Dashboard. Disabling RLS removes those warnings
-- and has no functional impact because the anon key is not used for data
-- access in this app.
-- =====================================================

alter table branches              disable row level security;
alter table profiles              disable row level security;
alter table products              disable row level security;
alter table inventory             disable row level security;
alter table customers             disable row level security;
alter table guarantors            disable row level security;
alter table orders                disable row level security;
alter table installments          disable row level security;
alter table activity_logs         disable row level security;
alter table whatsapp_notifications disable row level security;

-- Clean up the unused policies that referenced auth roles
drop policy if exists "self read profile"              on profiles;
drop policy if exists "anyone authenticated reads products" on products;
drop policy if exists "customer reads own customer"    on customers;
drop policy if exists "customer reads own orders"      on orders;
drop policy if exists "customer reads own installments" on installments;
