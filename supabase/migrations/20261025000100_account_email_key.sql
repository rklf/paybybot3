-- One e-mail per PayByBot account: each account keeps a keyed fingerprint of its e-mail (an HMAC made by the
-- server, key only on Vercel; normalised: lower case, no +tag, no dots for Gmail). A sign-up or an e-mail change
-- using a fingerprint another account already has is refused. Nothing readable is stored.

alter table public.accounts add column email_key text;
create index accounts_email_key on public.accounts (email_key);

-- The account (owner) already using this e-mail fingerprint, or null.
create function public.account_email_owner(p_token text, p_key text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return (select owner from public.accounts where email_key = p_key limit 1);
end $$;

create function public.account_set_email_key(p_token text, p_owner text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  update public.accounts set email_key = p_key where owner = p_owner;
end $$;

revoke all on function public.account_email_owner(text, text), public.account_set_email_key(text, text, text)
  from public, authenticated;
grant execute on function public.account_email_owner(text, text), public.account_set_email_key(text, text, text)
  to anon;
