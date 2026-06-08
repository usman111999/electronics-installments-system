-- =====================================================
-- 11_sales_officer.sql — capture the sales officer on an order
-- Idempotent: safe to re-run.
--
-- The person who MAKES the sale (sales officer) is distinct from the recovery
-- officer who collects installments later. We capture the sales officer on the
-- order at creation time; recovery_officer stays on the installments ledger.
-- =====================================================

alter table orders add column if not exists sales_officer text;
