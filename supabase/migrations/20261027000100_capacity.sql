-- Counters for the capacity alerts: e-mails sent per day and per month, and which alerts already went out (one per
-- key). Nothing personal: only keys like 'email:day:2026-10-27' or 'alert:queue:2026-10-27' and a count. Closed to
-- API roles; reached only through the token-checked functions below.

create table public.usage_counters (
  key text primary key,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.usage_counters enable row level security;
revoke all on table public.usage_counters from anon, authenticated;

-- Adds one to each key and returns the new counts, as {key: count}.
create function public.usage_add(p_token text, p_keys text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.check_token(p_token);
  with added as (
    insert into public.usage_counters (key, count) select k, 1 from unnest(p_keys) as k
    on conflict (key) do update set count = public.usage_counters.count + 1, updated_at = now()
    returning key, count
  )
  select coalesce(jsonb_object_agg(key, count), '{}'::jsonb) into result from added;
  return result;
end $$;

-- What the scheduler checks every run: renewals waiting for more than 10 minutes past their time (the queue is
-- behind), the active renewals and the accounts that have one, and the database size.
create function public.capacity_snapshot(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return jsonb_build_object(
    'overdue', (select count(*) from public.renewals where enabled and next_check <= now() - interval '10 minutes'),
    'active', (select count(*) from public.renewals where enabled),
    'owners', (select count(distinct owner) from public.renewals where enabled),
    'db_bytes', pg_database_size(current_database()));
end $$;

revoke all on function public.usage_add(text, text[]), public.capacity_snapshot(text) from public, authenticated;
grant execute on function public.usage_add(text, text[]), public.capacity_snapshot(text) to anon;
