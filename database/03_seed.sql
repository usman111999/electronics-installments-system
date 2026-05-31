-- =====================================================
-- Seed data: default branch + sample products
-- =====================================================

insert into branches (name, code, address, city, phone, manager_name)
values
  ('Allama Iqbal Park SKP', 'SKP-01', 'Allama Iqbal Park, Sialkot', 'Sialkot', '0300-0000000', 'Default Manager')
on conflict do nothing;

insert into products (name, model, company, category, base_price, default_installment_price)
values
  ('Y20 Mobile', 'Y20', 'Vivo', 'Mobile', 35100, 2925),
  ('Redmi 12', 'Redmi-12', 'Xiaomi', 'Mobile', 40000, 3500),
  ('iPhone 13', '13', 'Apple', 'Mobile', 250000, 21000),
  ('LED TV 43 inch', 'LED-43', 'Samsung', 'TV', 80000, 7000),
  ('Refrigerator', 'RF-300', 'Dawlance', 'Appliance', 120000, 10000)
on conflict do nothing;
