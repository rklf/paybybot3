-- PayByBot's own state when PayByPhone stops answering (API blocked, down): one row. `failures` counts the
-- renewals in a row PayByPhone did not answer; from the threshold on, the service is marked interrupted (a banner
-- in the app, an alert to the owner). The e-mail to the customers goes out only once the owner confirms it
-- (`notified_at`), and the resume e-mail when the owner ends the interruption. Closed to API roles; reached only
-- through the token-checked functions below.

create table public.service_state (
  id smallint primary key default 1 check (id = 1),
  failures integer not null default 0,
  interrupted_at timestamptz,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.service_state enable row level security;
revoke all on table public.service_state from anon, authenticated;
insert into public.service_state (id) values (1) on conflict do nothing;

create function public.service_state_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return (select to_jsonb(s) - 'id' from public.service_state s where id = 1);
end $$;

-- One more renewal PayByPhone did not answer. `started` is true for the one that crosses the threshold.
create function public.service_outage_hit(p_token text, p_threshold integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.service_state;
  was timestamptz;
begin
  perform private.check_token(p_token);
  select interrupted_at into was from public.service_state where id = 1;
  update public.service_state
     set failures = failures + 1,
         interrupted_at = coalesce(interrupted_at, case when failures + 1 >= p_threshold then now() end),
         updated_at = now()
   where id = 1
  returning * into s;
  return (to_jsonb(s) - 'id') || jsonb_build_object('started', was is null and s.interrupted_at is not null);
end $$;

-- PayByPhone answered: the count of failures in a row starts again (the interruption stays until the owner ends it).
create function public.service_outage_clear(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.service_state set failures = 0, updated_at = now() where id = 1 and failures > 0;
end $$;

-- The owner's actions: 'interrupt', 'notified' (the customers' e-mail is sent), 'resume' (back to normal).
create function public.service_state_set(p_token text, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.service_state;
begin
  perform private.check_token(p_token);
  if p_action = 'interrupt' then
    update public.service_state set interrupted_at = coalesce(interrupted_at, now()), updated_at = now()
     where id = 1 returning * into s;
  elsif p_action = 'notified' then
    update public.service_state set notified_at = coalesce(notified_at, now()), updated_at = now()
     where id = 1 returning * into s;
  elsif p_action = 'resume' then
    update public.service_state set interrupted_at = null, notified_at = null, failures = 0, updated_at = now()
     where id = 1 returning * into s;
  else
    raise exception 'unknown action';
  end if;
  return to_jsonb(s) - 'id';
end $$;

revoke all on function public.service_state_get(text), public.service_outage_hit(text, integer),
  public.service_outage_clear(text), public.service_state_set(text, text) from public, authenticated;
grant execute on function public.service_state_get(text), public.service_outage_hit(text, integer),
  public.service_outage_clear(text), public.service_state_set(text, text) to anon;
