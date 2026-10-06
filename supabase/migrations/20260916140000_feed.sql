-- The bank feed's credentials, kept where no page can reach them.
--
-- The local server keeps Akahu's two tokens in a file beside the ledgers and
-- never lets the page see them: the browser is told whether a connection
-- exists and nothing more. This is the same arrangement on a server. The
-- tokens go into Supabase Vault, which stores them encrypted; `bank_feeds`
-- holds only the ids of those secrets; and every function that can see a token
-- is executable by the service role alone.
--
-- That last part is the whole point, so it is done explicitly rather than
-- trusted to a default: Postgres grants EXECUTE on a new function to PUBLIC,
-- which would put a signed-in user one request away from somebody's bank
-- credentials. Each one is revoked and then granted to the service role, which
-- only the edge function has.

/** Store, or replace, the two tokens for a set of books. */
create or replace function public.feed_store(book uuid, app_token text, user_token text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.bank_feeds%rowtype;
  app_secret uuid;
  user_secret uuid;
begin
  select * into held from public.bank_feeds where book_id = book;

  if held.book_id is null then
    app_secret := vault.create_secret(app_token, 'akahu-app-' || book::text, 'Akahu app token');
    user_secret := vault.create_secret(user_token, 'akahu-user-' || book::text, 'Akahu user token');
    insert into public.bank_feeds (book_id, app_token_secret, user_token_secret)
    values (book, app_secret, user_secret);
  else
    perform vault.update_secret(held.app_token_secret, app_token);
    perform vault.update_secret(held.user_token_secret, user_token);
  end if;
end;
$$;

/** The tokens themselves. Nothing that is not the edge function may call this. */
create or replace function public.feed_secrets(book uuid)
returns table (app_token text, user_token text, accounts jsonb, settings jsonb)
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select a.decrypted_secret, u.decrypted_secret, f.accounts, f.settings
  from public.bank_feeds f
  join vault.decrypted_secrets a on a.id = f.app_token_secret
  join vault.decrypted_secrets u on u.id = f.user_token_secret
  where f.book_id = book;
$$;

/** Disconnect: the row goes, and so do the secrets behind it. */
create or replace function public.feed_forget(book uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.bank_feeds%rowtype;
begin
  select * into held from public.bank_feeds where book_id = book;
  if held.book_id is null then return; end if;

  delete from public.bank_feeds where book_id = book;
  -- Left behind, these would be somebody's live bank tokens sitting in a vault
  -- nothing points at any more.
  delete from vault.secrets where id in (held.app_token_secret, held.user_token_secret);
end;
$$;

/** Which of their accounts is which of ours, and how often to look. */
create or replace function public.feed_accounts_set(book uuid, mapping jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.bank_feeds set accounts = mapping where book_id = book;
$$;

create or replace function public.feed_settings_set(book uuid, wanted jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.bank_feeds set settings = wanted where book_id = book;
$$;

create or replace function public.feed_touch(book uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.bank_feeds set last_fetch = now() where book_id = book;
$$;

-- Nobody signed in, ever. Only the service role, which lives in the edge
-- function's environment and never reaches a browser.
revoke execute on function public.feed_store(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.feed_secrets(uuid) from public, anon, authenticated;
revoke execute on function public.feed_forget(uuid) from public, anon, authenticated;
revoke execute on function public.feed_accounts_set(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.feed_settings_set(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.feed_touch(uuid) from public, anon, authenticated;

grant execute on function public.feed_store(uuid, text, text) to service_role;
grant execute on function public.feed_secrets(uuid) to service_role;
grant execute on function public.feed_forget(uuid) to service_role;
grant execute on function public.feed_accounts_set(uuid, jsonb) to service_role;
grant execute on function public.feed_settings_set(uuid, jsonb) to service_role;
grant execute on function public.feed_touch(uuid) to service_role;
