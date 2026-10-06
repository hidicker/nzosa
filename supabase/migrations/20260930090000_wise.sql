-- Wise, for books kept on the server.
--
-- The desktop app keeps a Wise API token in a file beside the ledgers and
-- never lets the page see it. This is the same arrangement on the server, as
-- the bank feed's is: the token goes into Supabase Vault, encrypted;
-- `wise_feeds` holds only the id of that secret, which balances come in, and
-- the day to fetch from; and every function that can see the token is
-- executable by the service role alone, which only the edge function has.

create table if not exists public.wise_feeds (
  book_id uuid primary key references public.books (id) on delete cascade,
  token_secret uuid not null,
  -- Wise balance id to the bank account in these books it comes in as, or ''.
  accounts jsonb not null default '{}'::jsonb,
  -- The day to fetch from, when the balance was used for other things before.
  from_date date,
  connected_at timestamptz not null default now(),
  last_fetch timestamptz
);

alter table public.wise_feeds enable row level security;
-- No policies, and nothing granted: every signed-in user is refused, and only
-- the service role reaches it.
revoke all on public.wise_feeds from anon, authenticated;

/** Store, or replace, the token for a set of books. */
create or replace function public.wise_store(book uuid, token text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.wise_feeds%rowtype;
begin
  select * into held from public.wise_feeds where book_id = book;
  if held.book_id is null then
    insert into public.wise_feeds (book_id, token_secret)
    values (book, vault.create_secret(token, 'wise-' || book::text, 'Wise API token'));
  else
    perform vault.update_secret(held.token_secret, token);
  end if;
end;
$$;

/** The token and everything beside it. Nothing that is not the edge function may call this. */
create or replace function public.wise_secret(book uuid)
returns table (token text, accounts jsonb, from_date date, last_fetch timestamptz)
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select s.decrypted_secret, w.accounts, w.from_date, w.last_fetch
  from public.wise_feeds w
  join vault.decrypted_secrets s on s.id = w.token_secret
  where w.book_id = book;
$$;

/** Disconnect: the row goes, and so does the secret behind it. */
create or replace function public.wise_forget(book uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.wise_feeds%rowtype;
begin
  select * into held from public.wise_feeds where book_id = book;
  if held.book_id is null then return; end if;
  delete from public.wise_feeds where book_id = book;
  delete from vault.secrets where id = held.token_secret;
end;
$$;

/** Which balances come in, and from when. A null day leaves the day as it was. */
create or replace function public.wise_set(book uuid, mapping jsonb, from_day date)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.wise_feeds
  set accounts = coalesce(mapping, accounts),
      from_date = coalesce(from_day, from_date)
  where book_id = book;
$$;

create or replace function public.wise_touch(book uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.wise_feeds set last_fetch = now() where book_id = book;
$$;

revoke execute on function public.wise_store(uuid, text) from public, anon, authenticated;
revoke execute on function public.wise_secret(uuid) from public, anon, authenticated;
revoke execute on function public.wise_forget(uuid) from public, anon, authenticated;
revoke execute on function public.wise_set(uuid, jsonb, date) from public, anon, authenticated;
revoke execute on function public.wise_touch(uuid) from public, anon, authenticated;

grant execute on function public.wise_store(uuid, text) to service_role;
grant execute on function public.wise_secret(uuid) to service_role;
grant execute on function public.wise_forget(uuid) to service_role;
grant execute on function public.wise_set(uuid, jsonb, date) to service_role;
grant execute on function public.wise_touch(uuid) to service_role;

-- A set of books deleted takes its secrets with it.
--
-- Deleting a book cascades its bank feed, AI key and Wise rows, but the vault
-- entries those rows point at are not rows of theirs, and were left behind:
-- somebody's live bank tokens and API keys, in a vault nothing pointed at any
-- more. Removed here, before the cascade takes the rows that name them.
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
  );
  return old;
end;
$$;

revoke execute on function public.forget_book_secrets() from public, anon, authenticated;

drop trigger if exists books_forget_secrets on public.books;
create trigger books_forget_secrets
  before delete on public.books
  for each row execute function public.forget_book_secrets();
