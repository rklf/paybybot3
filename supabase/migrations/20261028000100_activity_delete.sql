-- The owner can clean « Activité »: the list now gives each action's id, and one action (or all) can be deleted.

create or replace function public.activity_list(p_token text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'event', a.event, 'data', a.data) order by a.at desc)
                     from (select * from public.activity order by at desc limit least(greatest(p_limit, 1), 500)) a),
                  '[]'::jsonb);
end $$;

-- p_id null: everything.
create function public.activity_delete(p_token text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  if p_id is null then
    delete from public.activity where true;
  else
    delete from public.activity where id = p_id;
  end if;
end $$;

revoke all on function public.activity_delete(text, bigint) from public, authenticated;
grant execute on function public.activity_delete(text, bigint) to anon;
