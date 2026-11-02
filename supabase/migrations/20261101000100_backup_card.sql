-- The owner's backup card: only its last four digits, set on the admin page. The renewals fall back on it when the
-- client's own cards fail. Kept with the service state (one row), so service_state_get returns it too.
alter table public.service_state
  add column backup_card_last4 text check (backup_card_last4 ~ '^[0-9]{4}$');

create function public.backup_card_set(p_token text, p_last4 text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.service_state;
begin
  perform private.check_token(p_token);
  update public.service_state set backup_card_last4 = nullif(p_last4, ''), updated_at = now()
   where id = 1 returning * into s;
  return to_jsonb(s) - 'id';
end $$;

revoke all on function public.backup_card_set(text, text) from public, authenticated;
grant execute on function public.backup_card_set(text, text) to anon;
