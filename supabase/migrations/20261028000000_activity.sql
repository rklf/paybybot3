-- What users do (sign-up, sign-in, invitation opened, renewal on or off, subscription…), shown to the owner in the
-- admin's « Activité ». `event` is a short label; `data` holds who did it and the details, encrypted by the server
-- (Fernet, like the accounts). Kept 90 days. Closed to API roles; reached only through the token-checked functions.

create table public.activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null,
  data text
);
create index activity_at on public.activity (at desc);
alter table public.activity enable row level security;
revoke all on table public.activity from anon, authenticated;

-- One more action; the ones older than 90 days are cleared on the way.
create function public.activity_add(p_token text, p_event text, p_data text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  insert into public.activity (event, data) values (left(p_event, 120), p_data);
  delete from public.activity where at < now() - interval '90 days';
end $$;

-- The latest actions, newest first.
create function public.activity_list(p_token text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'event', a.event, 'data', a.data) order by a.at desc)
                     from (select * from public.activity order by at desc limit least(greatest(p_limit, 1), 500)) a),
                  '[]'::jsonb);
end $$;

revoke all on function public.activity_add(text, text, text), public.activity_list(text, integer)
  from public, authenticated;
grant execute on function public.activity_add(text, text, text), public.activity_list(text, integer) to anon;
