-- The free month is given once: when it starts, keyed fingerprints (HMACs made by the server, key only on Vercel)
-- of the PayByPhone account, the sign-up e-mail and the vehicles' plates are kept with its start date, even after
-- the account is deleted. A new sign-up matching one of them gets the earlier start date, not a new month.
-- Nothing readable is stored. Closed to API roles; reached only through the token-checked functions below.

create table public.trials (
  key text primary key,
  started_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.trials enable row level security;
revoke all on table public.trials from anon, authenticated;

create function public.trial_first(p_token text, p_keys text[]) returns timestamptz
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return (select min(started_at) from public.trials where key = any(p_keys));
end $$;

create function public.trial_mark(p_token text, p_keys text[], p_start timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  insert into public.trials (key, started_at) select k, p_start from unnest(p_keys) as k
  on conflict (key) do update set started_at = least(public.trials.started_at, excluded.started_at);
end $$;

revoke all on function public.trial_first(text, text[]), public.trial_mark(text, text[], timestamptz)
  from public, authenticated;
grant execute on function public.trial_first(text, text[]), public.trial_mark(text, text[], timestamptz) to anon;
