-- =====================================================
-- Device lock fields on orders.
-- For mobile devices financed on installment, the operator can remotely
-- lock the device (via PayJoy / Knox / custom MDM agent) when the customer
-- defaults, and unlock once the overdue payment is settled.
-- =====================================================

alter table orders add column if not exists device_imei text;
alter table orders add column if not exists device_locked boolean default false;
alter table orders add column if not exists device_lock_reason text;
alter table orders add column if not exists device_locked_at timestamptz;
alter table orders add column if not exists device_unlocked_at timestamptz;
alter table orders add column if not exists device_lock_provider text;
alter table orders add column if not exists device_lock_provider_ref text;

create index if not exists idx_orders_device_locked on orders(device_locked) where device_locked = true;

-- Lock/unlock audit trail
create table if not exists device_lock_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  action text not null check (action in ('lock', 'unlock')),
  reason text,
  triggered_by uuid references profiles(id) on delete set null,
  provider text,
  provider_response jsonb,
  success boolean default true,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_device_lock_events_order on device_lock_events(order_id);
create index if not exists idx_device_lock_events_created on device_lock_events(created_at desc);
