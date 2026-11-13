-- The owner's client list on the admin page: each account's encrypted data (only the server can read it), its
-- sign-up date and how many renewals it has. Token-checked like the other functions.

create function public.admin_accounts(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'owner', a.owner,
      'data', a.data,
      'created_at', a.created_at,
      'renewals', (select count(*) from public.renewals r where r.owner = a.owner),
      'renewals_active', (select count(*) from public.renewals r where r.owner = a.owner and r.enabled)
    ) order by a.created_at desc)
    from public.accounts a), '[]'::jsonb);
end $$;

revoke all on function public.admin_accounts(text) from public, authenticated;
grant execute on function public.admin_accounts(text) to anon;
