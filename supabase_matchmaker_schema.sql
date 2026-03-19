-- Supabase schema for the DOOH matchmaker
-- Creates:
--   1) devices  (inputs + fairness state)
--   2) pairs    (analytics/history)

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

create table if not exists public.devices (
  id text primary key,
  taluk text not null,
  business_category text, -- comma-separated tokens, e.g. "restaurant,cafe"
  excluded_devices text[] not null default '{}'::text[],
  online boolean not null default true,
  last_seen timestamp with time zone,
  join_time timestamp with time zone,
  last_paired_cycle integer not null default 0
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  business_name text,
  taluk text,
  business_category text,
  created_at timestamp with time zone not null default now()
);

alter table public.devices
  add column if not exists user_id uuid references public.users(id);

create index if not exists devices_online_idx on public.devices (online);
create index if not exists devices_taluk_idx on public.devices (taluk);

create table if not exists public.pairs (
  id uuid primary key default gen_random_uuid(),
  device_a text not null,
  device_b text not null,
  cycle integer not null,
  cycle_timestamp timestamp default now(),
  created_at timestamp with time zone not null default now()
);

