-- Card payments through Stripe, for books kept on the server.
--
-- Each business connects its own Stripe account with a key it makes there
-- (a restricted key is best: payment links and prices to write, checkout
-- sessions to read). The key goes into Supabase Vault, encrypted, as the
-- Wise and bank feed tokens do; `stripe_accounts` holds only the id of that
-- secret. Every function that can see the key is executable by the service
-- role alone, which only the edge function has. NZOSA never holds the money:
-- the customer pays the business's own Stripe account, and Stripe pays out to
-- the business's bank.

create table if not exists public.stripe_accounts (
  book_id uuid primary key references public.books (id) on delete cascade,
  key_secret uuid not null,
  -- What Stripe calls the account, for saying which one is connected.
  account_name text not null default '',
  connected_at timestamptz not null default now()
);

alter table public.stripe_accounts enable row level security;
revoke all on public.stripe_accounts from anon, authenticated;

/** Store, or replace, the key for a set of books. */
create or replace function public.stripe_store(book uuid, key text, name text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.stripe_accounts%rowtype;
begin
  select * into held from public.stripe_accounts where book_id = book;
  if held.book_id is null then
    insert into public.stripe_accounts (book_id, key_secret, account_name)
    values (book, vault.create_secret(key, 'stripe-' || book::text, 'Stripe API key'), coalesce(name, ''));
  else
    perform vault.update_secret(held.key_secret, key);
    update public.stripe_accounts set account_name = coalesce(name, ''), connected_at = now() where book_id = book;
  end if;
end;
$$;

/** The key, and the account's name. Nothing that is not the edge function may call this. */
create or replace function public.stripe_secret(book uuid)
returns table (key text, account_name text, connected_at timestamptz)
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select s.decrypted_secret, a.account_name, a.connected_at
  from public.stripe_accounts a
  join vault.decrypted_secrets s on s.id = a.key_secret
  where a.book_id = book;
$$;

/** Disconnect: the row goes, and so does the secret behind it. */
create or replace function public.stripe_forget(book uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.stripe_accounts%rowtype;
begin
  select * into held from public.stripe_accounts where book_id = book;
  if held.book_id is null then return; end if;
  delete from public.stripe_accounts where book_id = book;
  delete from vault.secrets where id = held.key_secret;
end;
$$;

revoke execute on function public.stripe_store(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.stripe_secret(uuid) from public, anon, authenticated;
revoke execute on function public.stripe_forget(uuid) from public, anon, authenticated;
grant execute on function public.stripe_store(uuid, text, text) to service_role;
grant execute on function public.stripe_secret(uuid) to service_role;
grant execute on function public.stripe_forget(uuid) to service_role;

-- A set of books deleted takes its Stripe key with it, as it does its other secrets.
create or replace function public.forget_book_secrets()
returns trigger
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  delete from vault.secrets where id in (
    select app_token_secret from public.bank_feeds where book_id = old.id
    union all
    select user_token_secret from public.bank_feeds where book_id = old.id
    union all
    select key_secret from public.ai_secrets where book = old.id
    union all
    select token_secret from public.wise_feeds where book_id = old.id
    union all
    select key_secret from public.stripe_accounts where book_id = old.id
  );
  return old;
end;
$$;

revoke execute on function public.forget_book_secrets() from public, anon, authenticated;
