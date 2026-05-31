-- =====================================================
-- Device enrollment + heartbeat + commands + location history
-- Companion to 07_device_lock.sql which already added the lock fields on orders.
-- =====================================================

-- Per-branch auto-lock policy (null = manual only)
alter table branches add column if not exists auto_lock_days integer;

-- =====================================================
-- DEVICES — one row per enrolled Android phone tied to an order
-- =====================================================
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  imei text unique,
  order_id uuid references orders(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  device_secret text not null,
  fcm_token text,
  device_model text,
  android_version text,
  status text not null default 'pending' check (status in ('pending','active','offline','lost')),
  last_seen_at timestamptz,
  last_battery integer,
  last_network text,
  current_sim_serial text,
  enrollment_token text unique,
  enrollment_token_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_devices_imei on devices(imei);
create index if not exists idx_devices_branch on devices(branch_id);
create index if not exists idx_devices_status on devices(status);
create index if not exists idx_devices_order on devices(order_id);
create index if not exists idx_devices_enrollment_token on devices(enrollment_token);

-- =====================================================
-- DEVICE_LOCATIONS — append-only GPS history
-- =====================================================
create table if not exists device_locations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  lat numeric(10, 7) not null,
  lon numeric(10, 7) not null,
  accuracy_m integer,
  recorded_at timestamptz not null default now(),
  source text not null default 'heartbeat' check (source in ('heartbeat','on_demand'))
);

create index if not exists idx_device_locations_device_recorded
  on device_locations(device_id, recorded_at desc);

-- =====================================================
-- DEVICE_COMMANDS — every lock/unlock/ping issued from the server
-- =====================================================
create table if not exists device_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  command_id uuid unique not null,
  action text not null check (action in ('lock','unlock','ping')),
  reason text,
  lock_message text,
  payload jsonb,
  status text not null default 'queued' check (status in ('queued','sent','ack','failed')),
  issued_at timestamptz not null default now(),
  sent_at timestamptz,
  acked_at timestamptz,
  error text,
  issued_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_device_commands_device_status
  on device_commands(device_id, status);
create index if not exists idx_device_commands_issued_at
  on device_commands(issued_at desc);

-- RLS — service role bypasses; explicit deny for anon/authenticated since
-- everything in this codebase already goes through the service-role backend.
alter table devices enable row level security;
alter table device_locations enable row level security;
alter table device_commands enable row level security;

drop policy if exists "devices_service_only" on devices;
drop policy if exists "device_locations_service_only" on device_locations;
drop policy if exists "device_commands_service_only" on device_commands;

create policy "devices_service_only" on devices for all using (false);
create policy "device_locations_service_only" on device_locations for all using (false);
create policy "device_commands_service_only" on device_commands for all using (false);
