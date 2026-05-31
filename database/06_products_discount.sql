-- Promotional discount column on products (shown in customer portal browse)
alter table products add column if not exists discount_percent numeric(5,2) default 0;
alter table products add column if not exists discount_label text;
