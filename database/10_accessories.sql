-- =====================================================
-- 10_accessories.sql — order line accessories + editable item snapshot
-- Idempotent: safe to re-run.
--
-- The shop finances any electronics (not just phones), and a sale often
-- bundles accessories (charger, earbuds, cover, stabiliser, etc.). We capture
-- those as free text on the order so the printed account form and order detail
-- can show exactly what was handed over.
-- =====================================================

alter table orders add column if not exists accessories text;
