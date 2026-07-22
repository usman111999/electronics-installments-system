-- =====================================================
-- 15_lockdown_anon_access.sql
-- CRITICAL: close direct database access via the public anon/authenticated keys.
--
-- RLS was disabled (04_disable_rls.sql) and the backend talks to the DB only
-- with the service_role key (which has BYPASSRLS + its own grants), so nothing
-- in the app relies on the anon/authenticated roles having table access — yet
-- with RLS off those roles could read/write EVERY table directly via PostgREST
-- (passwords, CNICs, all companies' data), bypassing every backend guard.
--
-- This migration:
--   (a) drops any leftover permissive policies,
--   (b) enables RLS (deny-by-default: no policies = no access for anon/auth),
--   (c) revokes all table/sequence grants from anon + authenticated.
-- service_role is untouched, so the backend keeps full access. The frontend
-- never talks to Supabase directly (verified), so nothing else breaks.
-- Idempotent: safe to re-run.
-- =====================================================

do $$
declare r record;
begin
  -- (a) drop every policy on public tables (clean slate)
  for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;

  -- (b) enable RLS on every public table (deny-by-default)
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- (c) revoke all direct grants from the public-API roles
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- and stop future tables from auto-granting to them
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
