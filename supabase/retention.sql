create extension if not exists pg_cron;

select cron.schedule(
  'purge_load_events',
  '0 3 * * *',
  $$ delete from public.load_events where created_at < now() - interval '7 days' $$
);
