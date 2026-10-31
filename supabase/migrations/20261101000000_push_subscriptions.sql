-- Phones that accepted PayByBot's alerts (Web Push): the browser's address and keys, encrypted by the app.
create table public.push_subscriptions (
  key        text primary key,
  owner      text not null,
  data       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create index on public.push_subscriptions (owner);

create function public.push_save(p_token text, p_owner text, p_key text, p_data text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  insert into public.push_subscriptions (key, owner, data) values (p_key, p_owner, p_data)
    on conflict (key) do update set owner = excluded.owner, data = excluded.data;
end $$;

create function public.push_list(p_token text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return coalesce((select jsonb_agg(data) from public.push_subscriptions where owner = p_owner), '[]'::jsonb);
end $$;

create function public.push_delete(p_token text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  delete from public.push_subscriptions where key = p_key;
end $$;

create function public.push_delete_owner(p_token text, p_owner text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  delete from public.push_subscriptions where owner = p_owner;
end $$;

revoke all on function public.push_save(text, text, text, text), public.push_list(text, text),
  public.push_delete(text, text), public.push_delete_owner(text, text) from public, authenticated;
grant execute on function public.push_save(text, text, text, text), public.push_list(text, text),
  public.push_delete(text, text), public.push_delete_owner(text, text) to anon;
