-- A private-link open is one « Activité » row updated as the visitor goes on (steps, time spent):
-- the add returns the row id, and only rows of that event can be rewritten.
create function public.activity_add_id(p_token text, p_event text, p_data text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare new_id bigint;
begin
  perform private.check_token(p_token);
  insert into public.activity (event, data) values (left(p_event, 120), p_data) returning id into new_id;
  delete from public.activity where at < now() - interval '90 days';
  return new_id;
end $$;

create function public.activity_update_link(p_token text, p_id bigint, p_data text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.activity set data = p_data where id = p_id and event = 'Lien privé ouvert';
end $$;

revoke all on function public.activity_add_id(text, text, text), public.activity_update_link(text, bigint, text)
  from public, authenticated;
grant execute on function public.activity_add_id(text, text, text), public.activity_update_link(text, bigint, text) to anon;
