-- =====================================================
-- Add a viewable plaintext password column on profiles.
-- Per business requirement: admin/operator must be able to view the
-- password they assigned to a user (so they can re-tell a customer
-- or operator what their password is).
--
-- SECURITY NOTE: this stores credentials in cleartext. Only acceptable
-- because this DB is reached only via the trusted backend (service_role)
-- and the column is exposed only to admin and operator roles in the UI.
-- =====================================================

alter table profiles add column if not exists password_plain text;

-- Backfill the seeded admin's password so the very first row also has it
update profiles set password_plain = 'Admin@123456'
  where email = 'admin@eis.local' and password_plain is null;
