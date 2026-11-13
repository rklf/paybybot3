-- A PaybyBot account per PayByPhone account: the e-mail given at sign-up and the home zone the user
-- added by hand. Both live in data, encrypted by the server (key only on Vercel); owner is the same
-- HMAC of the PayByPhone username as in renewals, never the phone number itself.
-- Closed to API roles like renewals: reached only through the functions below (private.check_token).

create table public.accounts (
  owner text primary key,
  data text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.accounts enable row level security;
revoke all on table public.accounts from anon, authenticated;

create function public.account_get(p_token text, p_owner text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return (select data from public.accounts where owner = p_owner);
end $$;

create function public.account_save(p_token text, p_owner text, p_data text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  insert into public.accounts (owner, data) values (p_owner, p_data)
  on conflict (owner) do update set data = excluded.data, updated_at = now();
end $$;

create function public.account_delete(p_token text, p_owner text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  delete from public.accounts where owner = p_owner;
end $$;

revoke all on function public.account_get(text, text), public.account_save(text, text, text),
  public.account_delete(text, text) from public, authenticated;
grant execute on function public.account_get(text, text), public.account_save(text, text, text),
  public.account_delete(text, text) to anon;
