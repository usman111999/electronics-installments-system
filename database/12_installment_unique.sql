-- Prevent duplicate invoice numbers within an order.
--
-- The invoice-creation paths (monthly accrual cron, lazy catch-up, manual
-- "Generate now", and Advance) each compute the next installment_no from the
-- current max. Without a DB-level guard, two of them running at the same instant
-- could insert the same installment_no twice and double-bill the plan. This
-- unique constraint makes that impossible — the second insert fails instead.

ALTER TABLE installments
  ADD CONSTRAINT installments_order_no_unique UNIQUE (order_id, installment_no);
