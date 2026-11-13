-- Wake the hosted paybybot every 5 minutes. The endpoint only acts on renewals that are due,
-- so an extra or missed call is harmless. Replace the URL with your deployment.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'paybybot-renew',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://paybybot.vercel.app/api/cron/renew',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 120000
     ) $$
);
