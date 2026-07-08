create extension if not exists pgcrypto;

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
  raw jsonb
);

create index if not exists load_events_created_at_idx on public.load_events (created_at desc);
create index if not exists load_events_site_idx on public.load_events (site);
create index if not exists load_events_page_path_idx on public.load_events (page_path);
create index if not exists load_events_load_time_idx on public.load_events (load_time_ms);
create index if not exists load_events_is_iphone_idx on public.load_events (is_iphone);
create index if not exists load_events_is_slow_idx on public.load_events (is_slow);
create index if not exists load_events_is_very_slow_idx on public.load_events (is_very_slow);

alter table public.load_events enable row level security;

create policy "Allow public read load events"
on public.load_events
for select
to anon
using (true);
