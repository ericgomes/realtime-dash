create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  site text not null,
  allowed_domains text[] not null default '{}',
  is_active boolean not null default true,
  retention_hours numeric not null default 3,
  aggregation_freshness_minutes integer not null default 1,
  default_period_key text not null default '3h',
  min_group_size integer not null default 5,
  slow_threshold_ms integer not null default 5000,
  very_slow_threshold_ms integer not null default 10000,
  sample_rate numeric not null default 0.10,
  ingest_token text unique,
  view_token text unique,
  timezone text not null default 'America/Sao_Paulo',
  storage_mode text not null default 'shared',
  tag_host text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenants add column if not exists sample_rate numeric not null default 0.10;
alter table public.tenants add column if not exists ingest_token text unique;
alter table public.tenants add column if not exists retention_hours numeric not null default 3;
alter table public.tenants add column if not exists view_token text unique;
alter table public.tenants add column if not exists tag_host text;

update public.tenants
set ingest_token = 'ing_' || encode(gen_random_bytes(20), 'hex')
where ingest_token is null;

update public.tenants
set view_token = 'view_' || encode(gen_random_bytes(20), 'hex')
where view_token is null;

create index if not exists tenants_slug_idx on public.tenants (slug);
create index if not exists tenants_active_idx on public.tenants (is_active);

insert into public.tenants (
  slug, name, site, allowed_domains,
  retention_hours, aggregation_freshness_minutes, default_period_key,
  min_group_size, slow_threshold_ms, very_slow_threshold_ms, timezone, storage_mode
)
values (
  'prospin', 'Pró Spin', 'prospin.com.br',
  array['prospin.com.br', 'www.prospin.com.br'],
  3, 1, '3h', 5, 5000, 10000, 'America/Sao_Paulo', 'shared'
)
on conflict (slug) do update set
  name = excluded.name,
  site = excluded.site,
  allowed_domains = excluded.allowed_domains,
  updated_at = now();

create table if not exists public.load_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_timestamp timestamptz,
  site text not null,
  page_location text,
  page_path text,
  load_time_ms integer,
  dom_ready_ms integer,
  ttfb_ms integer,
  user_agent text,
  width integer,
  height integer,
  effective_type text,
  downlink numeric,
  is_mobile boolean,
  is_iphone boolean,
  is_android boolean,
  browser text,
  os text,
  device_label text,
  is_slow boolean,
  is_very_slow boolean,
  sample_rate numeric,
  prerendered boolean,
  is_bot boolean,
  raw jsonb
);

alter table public.load_events
add column if not exists tenant_id uuid references public.tenants(id);

alter table public.load_events
add column if not exists sample_rate numeric;

alter table public.load_events
add column if not exists prerendered boolean;

alter table public.load_events
add column if not exists is_bot boolean;

update public.load_events
set tenant_id = (select id from public.tenants where slug = 'prospin')
where tenant_id is null
and site = 'prospin.com.br';

alter table public.load_events
alter column tenant_id set not null;

create index if not exists load_events_created_at_idx on public.load_events (created_at desc);
create index if not exists load_events_site_idx on public.load_events (site);
create index if not exists load_events_page_path_idx on public.load_events (page_path);
create index if not exists load_events_load_time_idx on public.load_events (load_time_ms);
create index if not exists load_events_is_iphone_idx on public.load_events (is_iphone);
create index if not exists load_events_is_slow_idx on public.load_events (is_slow);
create index if not exists load_events_is_very_slow_idx on public.load_events (is_very_slow);

create index if not exists load_events_tenant_created_idx
on public.load_events (tenant_id, created_at desc);
create index if not exists load_events_tenant_path_created_idx
on public.load_events (tenant_id, page_path, created_at desc);
create index if not exists load_events_tenant_device_created_idx
on public.load_events (tenant_id, device_label, created_at desc);
create index if not exists load_events_tenant_browser_created_idx
on public.load_events (tenant_id, browser, created_at desc);
create index if not exists load_events_tenant_os_created_idx
on public.load_events (tenant_id, os, created_at desc);
create index if not exists load_events_tenant_slow_created_idx
on public.load_events (tenant_id, is_slow, created_at desc);

alter table public.tenants enable row level security;
alter table public.load_events enable row level security;

drop policy if exists "Allow public read load events" on public.load_events;

create table if not exists public.load_summary_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  site text not null,
  period_key text not null,
  period_minutes integer not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  generated_at timestamptz not null default now(),
  total_events integer not null,
  slow_percent numeric,
  very_slow_percent numeric,
  avg_load_ms numeric,
  p75_load_ms numeric,
  p90_load_ms numeric,
  p95_load_ms numeric,
  avg_ttfb_ms numeric,
  avg_dom_ready_ms numeric,
  iphone_slow_percent numeric,
  payload jsonb not null
);

create index if not exists load_summary_snapshots_tenant_period_generated_idx
on public.load_summary_snapshots (tenant_id, period_key, generated_at desc);
create index if not exists load_summary_snapshots_site_period_generated_idx
on public.load_summary_snapshots (site, period_key, generated_at desc);
create index if not exists load_summary_snapshots_generated_idx
on public.load_summary_snapshots (generated_at desc);

alter table public.load_summary_snapshots enable row level security;
