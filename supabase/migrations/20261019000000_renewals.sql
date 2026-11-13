-- Weekly resident renewals run by the hosted paybybot (Vercel).
-- The table is closed to API roles (RLS on, no policy); the server reaches it only through the
-- functions below, which require a token whose SHA-256 is checked in private.check_token.
-- credential holds a PayByPhone refresh token encrypted by the server (key only on Vercel);
-- owner is an HMAC of the PayByPhone username, never the phone number itself.
--
-- Before applying: replace <sha256 of PAYBYBOT_DB_TOKEN> with the hex SHA-256 of the token you
-- set as PAYBYBOT_DB_TOKEN on the server.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.renewals (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  label text not null default '',
  plate text not null,
  location text not null,
  rate text not null,
  duration numeric not null,
  unit text not null,
  payment_account_id text not null,
  credential text not null,
  enabled boolean not null default true,
  next_check timestamptz not null default now(),
  last_check timestamptz,
  last_payment timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index renewals_owner_idx on public.renewals (owner);
create index renewals_due_idx on public.renewals (next_check) where enabled;
alter table public.renewals enable row level security;
revoke all on table public.renewals from anon, authenticated;

create function private.check_token(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or encode(extensions.digest(p_token, 'sha256'), 'hex')
     <> '<sha256 of PAYBYBOT_DB_TOKEN>' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- Public view of a row: never returns the credential.
create function private.public_row(r public.renewals) returns jsonb
language sql immutable set search_path = '' as $$
  select to_jsonb(r) - 'credential' - 'owner'
$$;

create function public.renewal_save(p_token text, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.renewals;
begin
  perform private.check_token(p_token);
  insert into public.renewals (owner, label, plate, location, rate, duration, unit, payment_account_id, credential)
  values (p_row->>'owner', coalesce(p_row->>'label', ''), p_row->>'plate', p_row->>'location', p_row->>'rate',
          (p_row->>'duration')::numeric, p_row->>'unit', p_row->>'payment_account_id', p_row->>'credential')
  returning * into r;
  return private.public_row(r);
end $$;

create function public.renewal_list(p_token text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return coalesce((select jsonb_agg(private.public_row(r) order by r.created_at)
                   from public.renewals r where r.owner = p_owner), '[]'::jsonb);
end $$;

create function public.renewal_delete(p_token text, p_owner text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  delete from public.renewals where id = p_id and owner = p_owner;
end $$;

-- Hands out the renewals to check now and pushes their next_check, so overlapping runs never
-- process the same row twice.
create function public.renewal_claim_due(p_token text, p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.check_token(p_token);
  with due as (
    select id from public.renewals
    where enabled and next_check <= now()
    order by next_check
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.renewals r set next_check = now() + interval '10 minutes', last_check = now()
    from due where r.id = due.id
    returning r.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into result from claimed;
  return result;
end $$;

create function public.renewal_update(p_token text, p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.renewals set
    credential   = coalesce(p_patch->>'credential', credential),
    next_check   = coalesce((p_patch->>'next_check')::timestamptz, next_check),
    last_payment = case when p_patch ? 'last_payment' then (p_patch->>'last_payment')::timestamptz else last_payment end,
    last_error   = case when p_patch ? 'last_error' then p_patch->>'last_error' else last_error end,
    enabled      = coalesce((p_patch->>'enabled')::boolean, enabled)
  where id = p_id;
end $$;

-- After a new login: fresh credential for all of this owner's renewals, and retry them now.
create function public.renewal_set_credential(p_token text, p_owner text, p_credential text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.renewals
  set credential = p_credential,
      last_error = null,
      next_check = least(next_check, now())
  where owner = p_owner;
end $$;

-- Only the server calls these, with the publishable key and its token.
revoke all on function public.renewal_save(text, jsonb), public.renewal_list(text, text),
  public.renewal_delete(text, text, uuid), public.renewal_claim_due(text, int),
  public.renewal_update(text, uuid, jsonb), public.renewal_set_credential(text, text, text)
  from public, authenticated;
grant execute on function public.renewal_save(text, jsonb), public.renewal_list(text, text),
  public.renewal_delete(text, text, uuid), public.renewal_claim_due(text, int),
  public.renewal_update(text, uuid, jsonb), public.renewal_set_credential(text, text, text) to anon;
