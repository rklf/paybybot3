-- Hardening: renewal details encrypted by the server, login rate limiting, data deletion,
-- and an authenticated scheduler call whose token is generated here and never leaves the database.
-- After applying, set PAYBYBOT_CRON_TOKEN_SHA256 on the server to:
--   select encode(extensions.digest(decrypted_secret, 'sha256'), 'hex')
--   from vault.decrypted_secrets where name = 'paybybot_cron_token';

-- 1. Details (plate, zone, rate, duration, card id) become one server-encrypted field.
alter table public.renewals
  drop column label, drop column plate, drop column location, drop column rate,
  drop column duration, drop column unit, drop column payment_account_id,
  add column data text not null;

create or replace function public.renewal_save(p_token text, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.renewals;
begin
  perform private.check_token(p_token);
  insert into public.renewals (owner, data, credential)
  values (p_row->>'owner', p_row->>'data', p_row->>'credential')
  returning * into r;
  return private.public_row(r);
end $$;

create function public.renewal_delete_owner(p_token text, p_owner text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  delete from public.renewals where owner = p_owner;
end $$;

-- 2. Login attempts, keyed by HMACs computed by the server (no IP or phone number stored).
create table private.rate_hits (
  key text not null,
  at timestamptz not null default now()
);
create index rate_hits_key_at_idx on private.rate_hits (key, at);

create function public.rate_hit(p_token text, p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare recent int;
begin
  perform private.check_token(p_token);
  delete from private.rate_hits where at < now() - interval '1 day';
  select count(*) into recent from private.rate_hits
  where key = p_key and at > now() - make_interval(secs => p_window_seconds);
  if recent >= p_max then
    return false;
  end if;
  insert into private.rate_hits (key) values (p_key);
  return true;
end $$;

revoke all on function public.renewal_delete_owner(text, text), public.rate_hit(text, text, int, int)
  from public, authenticated;
grant execute on function public.renewal_delete_owner(text, text), public.rate_hit(text, text, int, int) to anon;

-- 3. Scheduler token: random, kept in Vault, sent as a bearer token on each call.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'paybybot_cron_token',
                           'Bearer token for https://paybybot.vercel.app/api/cron/renew');

select cron.unschedule('paybybot-renew');
select cron.schedule(
  'paybybot-renew',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://paybybot.vercel.app/api/cron/renew',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                        where name = 'paybybot_cron_token')),
       body := '{}'::jsonb,
       timeout_milliseconds := 120000
     ) $$
);
