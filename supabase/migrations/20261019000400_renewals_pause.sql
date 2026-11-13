-- Vacation pause: no payment between paused_from and paused_until (null = no end date yet).
-- Only scheduling dates, kept in clear like next_check; renewal details (and the optional
-- confirmation e-mail) stay encrypted in data.
alter table public.renewals
  add column paused_from timestamptz,
  add column paused_until timestamptz;

create or replace function public.renewal_update(p_token text, p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.renewals set
    credential   = coalesce(p_patch->>'credential', credential),
    data         = coalesce(p_patch->>'data', data),
    next_check   = coalesce((p_patch->>'next_check')::timestamptz, next_check),
    last_payment = case when p_patch ? 'last_payment' then (p_patch->>'last_payment')::timestamptz else last_payment end,
    last_error   = case when p_patch ? 'last_error' then p_patch->>'last_error' else last_error end,
    enabled      = coalesce((p_patch->>'enabled')::boolean, enabled),
    paused_from  = case when p_patch ? 'paused_from' then (p_patch->>'paused_from')::timestamptz else paused_from end,
    paused_until = case when p_patch ? 'paused_until' then (p_patch->>'paused_until')::timestamptz else paused_until end
  where id = p_id;
end $$;

-- Owner-checked variant for changes asked by the user (pause, e-mail): one can only edit one's own renewals.
-- Never returns the stored credential.
create function public.renewal_update_owned(p_token text, p_owner text, p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.renewals;
begin
  perform private.check_token(p_token);
  if not exists (select 1 from public.renewals where id = p_id and owner = p_owner) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.renewal_update(p_token, p_id, p_patch);
  select * into r from public.renewals where id = p_id;
  return private.public_row(r);
end $$;

revoke all on function public.renewal_update_owned(text, text, uuid, jsonb) from public, authenticated;
grant execute on function public.renewal_update_owned(text, text, uuid, jsonb) to anon;
