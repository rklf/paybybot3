-- The owner's backup PayByPhone account: when a client's card fails and nothing covers the car, it pays the ticket
-- for the client's plate (the client is billed for it). One row: the account's login token, encrypted by the app,
-- a masked label, and this week's advances (capped). It replaces the backup card added to the clients' accounts.
drop function if exists public.backup_card_set(text, text);
alter table public.service_state drop column if exists backup_card_last4;

create table public.backup_account (
  id          smallint primary key default 1 check (id = 1),
  credential  text,
  label       text,
  week_start  timestamptz,
  week_cents  integer not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.backup_account enable row level security;
revoke all on table public.backup_account from anon, authenticated;
insert into public.backup_account (id) values (1) on conflict do nothing;

create function public.backup_account_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return (select to_jsonb(b) - 'id' from public.backup_account b where id = 1);
end $$;

create function public.backup_account_set(p_token text, p_credential text, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.backup_account set credential = p_credential, label = p_label, updated_at = now() where id = 1;
end $$;

-- One advance of p_cents (negative: given back). The week starts again after 7 days. False when it would go over
-- p_cap: nothing is counted then.
create function public.backup_spend(p_token text, p_cents integer, p_cap integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  b public.backup_account;
begin
  perform private.check_token(p_token);
  select * into b from public.backup_account where id = 1 for update;
  if b.week_start is null or b.week_start < now() - interval '7 days' then
    b.week_start := now();
    b.week_cents := 0;
  end if;
  if p_cents > 0 and b.week_cents + p_cents > p_cap then
    return false;
  end if;
  update public.backup_account
     set week_start = b.week_start, week_cents = greatest(b.week_cents + p_cents, 0), updated_at = now()
   where id = 1;
  return true;
end $$;

revoke all on function public.backup_account_get(text), public.backup_account_set(text, text, text),
  public.backup_spend(text, integer, integer) from public, authenticated;
grant execute on function public.backup_account_get(text), public.backup_account_set(text, text, text),
  public.backup_spend(text, integer, integer) to anon;
