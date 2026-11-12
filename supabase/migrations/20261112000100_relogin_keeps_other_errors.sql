-- Logging in again fixes only what a login fixes: the "reconnect" error (RELOGIN in web.py). Any other state of a
-- renewal is kept as it is: a payment waiting for the bank's validation (else the « Valider » button disappears and a
-- second payment starts), a refused card being retried at its own pace (1h/4h/8h), a suspended renewal.
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
      last_error = case when enabled and last_error like 'Votre connexion PayByPhone a expiré%' then null
                        else last_error end,
      next_check = case when enabled and last_error like 'Votre connexion PayByPhone a expiré%'
                        then least(next_check, now()) else next_check end
  where owner = p_owner;
end $function$;
