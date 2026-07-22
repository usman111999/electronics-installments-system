-- =====================================================
-- 14_customer_account_per_company.sql
-- Make customer account numbers unique PER COMPANY instead of globally, so each
-- company runs its own independent 0001, 0002, … sequence and the numbering
-- never leaks (or collides across) other companies' customers.
-- Idempotent: safe to re-run.
-- =====================================================

-- 1) Drop any existing global UNIQUE constraint on account_no (default name is
--    customers_account_no_key, but match by definition to be safe).
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'customers'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(account_no)%'
      and pg_get_constraintdef(oid) not ilike '%company_id%'
  loop
    execute format('alter table customers drop constraint %I', c);
  end loop;
end $$;

-- 2) Add the composite per-company uniqueness (if not already present).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'customers'::regclass and conname = 'customers_company_account_unique'
  ) then
    alter table customers
      add constraint customers_company_account_unique unique (company_id, account_no);
  end if;
end $$;
