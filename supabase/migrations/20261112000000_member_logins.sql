-- One PayByPhone account, one PayByBot account: PayByPhone's own id for the account (memberid in its token, kept as
-- an HMAC made by the server, key only on Vercel) gives the login first used with it (encrypted by the server), so
-- typing the phone number another way (0777…, +33 7 77…) finds the same account, renewals and subscription.
-- Nothing readable is stored. Closed to API roles; reached only through the token-checked functions below.

create table public.member_logins (
  key text primary key,
  login text not null,
  created_at timestamptz not null default now()
);
alter table public.member_logins enable row level security;
revoke all on table public.member_logins from anon, authenticated;

create function public.member_login_get(p_token text, p_key text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return (select login from public.member_logins where key = p_key);
end $$;

create function public.member_login_set(p_token text, p_key text, p_login text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  insert into public.member_logins (key, login) values (p_key, p_login) on conflict (key) do nothing;
end $$;

revoke all on function public.member_login_get(text, text), public.member_login_set(text, text, text)
  from public, authenticated;
grant execute on function public.member_login_get(text, text), public.member_login_set(text, text, text) to anon;
