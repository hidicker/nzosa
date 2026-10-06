-- The balances a fetch saw, kept with the date.
--
-- Akahu gives the balance now and no history, and a single figure proves
-- nothing: a ledger holds the change since it began while a balance is the
-- whole account, so the difference between them is only however much came
-- before. Two of them are worth something. How far a balance moved between one
-- fetch and the next has to equal what the transactions in that window come
-- to, and where it does not, the window says where to look.
--
-- So the app builds the history the bank will not give it, a fetch at a time.
-- The folder version has always done this; without it here, the bank balance
-- check on hosted books would have nothing to check against.

alter table public.bank_feeds
  add column if not exists balances jsonb not null default '[]'::jsonb;

-- Both of these gain columns, and Postgres will not change the shape of what a
-- function returns in place. Dropped and made again in the same migration:
-- they are functions, not data, and nothing is stored in them.
drop function if exists public.feed_secrets(uuid);
drop function if exists public.feed_status(uuid);

/** The tokens, and everything else the feed holds. Service role only. */
create or replace function public.feed_secrets(book uuid)
returns table (
  app_token text,
  user_token text,
  accounts jsonb,
  settings jsonb,
  balances jsonb,
  last_fetch timestamptz
)
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select a.decrypted_secret, u.decrypted_secret, f.accounts, f.settings, f.balances, f.last_fetch
  from public.bank_feeds f
  join vault.decrypted_secrets a on a.id = f.app_token_secret
  join vault.decrypted_secrets u on u.id = f.user_token_secret
  where f.book_id = book;
$$;

/** What a fetch saw: the balances at that moment, and that it happened. */
create or replace function public.feed_record_fetch(book uuid, seen jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.bank_feeds
  set balances = seen, last_fetch = now()
  where book_id = book;
$$;

/** What the page may know: that a feed exists, and what it is pointed at. */
create or replace function public.feed_status(book uuid)
returns table (connected boolean, accounts jsonb, settings jsonb, balances jsonb, last_fetch timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select true, f.accounts, f.settings, f.balances, f.last_fetch
  from public.bank_feeds f
  where f.book_id = book and public.is_member(book);
$$;

revoke execute on function public.feed_secrets(uuid) from public, anon, authenticated;
revoke execute on function public.feed_record_fetch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.feed_secrets(uuid) to service_role;
grant execute on function public.feed_record_fetch(uuid, jsonb) to service_role;
grant execute on function public.feed_status(uuid) to authenticated;
