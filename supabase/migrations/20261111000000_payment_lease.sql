-- Never two payments at once for one renewal: whatever pays (the scheduler, « Activer », a relaunch, « payer
-- maintenant », « Valider mon paiement ») first takes the renewal's lease, atomically, and lets go after. A lease that
-- was not let go (a function stopped mid-way) ends by itself after p_seconds.
create table if not exists public.leases (
  key text primary key,
  until timestamptz not null
);
alter table public.leases enable row level security;

create function public.lease_take(p_token text, p_key text, p_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare taken text;
begin
  perform private.check_token(p_token);
  insert into public.leases (key, until) values (p_key, now() + make_interval(secs => p_seconds))
  on conflict (key) do update set until = excluded.until where public.leases.until < now()
  returning key into taken;
  delete from public.leases where until < now() - interval '1 day';
  return taken is not null;
end $$;

create function public.lease_drop(p_token text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  delete from public.leases where key = p_key;
end $$;

revoke all on table public.leases from public, anon, authenticated;
revoke all on function public.lease_take(text, text, int), public.lease_drop(text, text) from public, authenticated;
grant execute on function public.lease_take(text, text, int), public.lease_drop(text, text) to anon;
