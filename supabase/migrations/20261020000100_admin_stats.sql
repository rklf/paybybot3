-- Counts only, for the owner's admin page: no row content, no identifier ever leaves the database.

create function public.admin_stats(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return jsonb_build_object(
    'accounts', (select count(*) from public.accounts),
    'accounts_7d', (select count(*) from public.accounts where created_at > now() - interval '7 days'),
    'accounts_30d', (select count(*) from public.accounts where created_at > now() - interval '30 days'),
    'renewals', (select count(*) from public.renewals),
    'renewals_active', (select count(*) from public.renewals r where r.enabled
                          and not (r.paused_from is not null and r.paused_from <= now()
                                   and (r.paused_until is null or now() < r.paused_until))),
    'renewals_paused', (select count(*) from public.renewals r where r.paused_from is not null
                          and r.paused_from <= now() and (r.paused_until is null or now() < r.paused_until)),
    'renewals_error', (select count(*) from public.renewals where last_error is not null),
    'paid_7d', (select count(*) from public.renewals where last_payment > now() - interval '7 days'),
    'signups_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
      from (select (created_at at time zone 'Europe/Paris')::date as day, count(*) as n
            from public.accounts where created_at > now() - interval '14 days' group by 1) d), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_stats(text) from public, authenticated;
grant execute on function public.admin_stats(text) to anon;
