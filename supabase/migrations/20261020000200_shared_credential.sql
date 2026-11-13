-- PayByPhone may replace the refresh token each time it is used. The login cookie and an account's renewals
-- must then share the newest one: read it, or store it on every renewal of the account without re-running them.

create function public.renewal_get_credential(p_token text, p_owner text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return (select credential from public.renewals where owner = p_owner order by last_check desc nulls last limit 1);
end $$;

create function public.renewal_put_credential(p_token text, p_owner text, p_credential text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.renewals set credential = p_credential where owner = p_owner;
end $$;

revoke all on function public.renewal_get_credential(text, text), public.renewal_put_credential(text, text, text)
  from public, authenticated;
grant execute on function public.renewal_get_credential(text, text), public.renewal_put_credential(text, text, text)
  to anon;
