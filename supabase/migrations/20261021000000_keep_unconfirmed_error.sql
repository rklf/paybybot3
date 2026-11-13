-- Logging in again clears the "reconnect" error of the account's renewals, but must not clear the error of a
-- renewal suspended because PayByPhone did not confirm a payment (enabled = false): the user has to check
-- PayByPhone before it is resumed, and the dashboard must keep saying so.
create or replace function public.renewal_set_credential(p_token text, p_owner text, p_credential text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.check_token(p_token);
  update public.renewals
  set credential = p_credential,
      last_error = case when enabled then null else last_error end,
      next_check = case when enabled then least(next_check, now()) else next_check end
  where owner = p_owner;
end $function$;
