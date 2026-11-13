-- The backup PayByPhone account is gone: its stored login token, its weekly count and its functions with it.
drop function if exists public.backup_account_get(text);
drop function if exists public.backup_account_set(text, text, text);
drop function if exists public.backup_spend(text, integer, integer);
drop function if exists public.backup_card_set(text, text);
drop table if exists public.backup_account;
alter table public.service_state drop column if exists backup_card_last4;
