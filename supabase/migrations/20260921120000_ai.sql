-- Asking a model, for books kept on the server.
--
-- The same arrangement the bank feed already has: the key lives in Supabase
-- Vault, the table holds only the id of the secret, and one edge function is
-- the only thing that reads it. The page is told whether a key exists and
-- never what it is.
--
-- Two kinds of key are possible here and they are counted differently. A key
-- somebody brought is theirs: they pay Google for it, and nothing here caps
-- what they spend beyond a batch size that keeps the answers readable. The
-- project's own key, offered so somebody can try this without one, is paid for
-- by whoever runs this installation -- so it is capped three ways, and the one
-- that matters is the last.

create table if not exists public.ai_secrets (
  book uuid primary key references public.books (id) on delete cascade,
  key_secret uuid not null,
  model text not null default 'gemini-3.6-flash',
  models jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_secrets enable row level security;
-- No policies and no grants: nothing reaches this table except the functions
-- below, which say who may do what for themselves.
revoke all on public.ai_secrets from anon, authenticated;

-- What has been asked, and by whom, so a cap can be more than a wish.
create table if not exists public.ai_usage (
  book uuid not null references public.books (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  used integer not null default 0,
  -- Transactions asked about on the project's key, for the life of these
  -- books rather than for a day: a trial is a trial, not a daily allowance.
  demo_used integer not null default 0,
  primary key (book, day)
);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- The whole installation, per day.
--
-- The real protection. Per-book and per-user caps are politeness: sign-up is
-- open, a person may start twenty books, and nothing stops somebody having
-- more than one account. This is the number that decides the worst day
-- possible, and it is chosen here rather than by whoever finds the site.
create table if not exists public.ai_day (
  day date primary key,
  used integer not null default 0
);

alter table public.ai_day enable row level security;
revoke all on public.ai_day from anon, authenticated;

create or replace function public.ai_limits()
returns table (batch integer, per_book integer, per_day integer)
language sql
immutable
as $$
  select 20, 500, 3000;
$$;

/**
 * Keep a key for these books, or replace the one that is there.
 *
 * The key goes into the vault and its id into the table, so a row read by
 * anybody who should not have it is a uuid and nothing else.
 */
create or replace function public.set_ai_key(book uuid, key text, model text default null)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.ai_secrets;
  made uuid;
begin
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;

  select * into held from public.ai_secrets s where s.book = set_ai_key.book;
  if held is null then
    made := vault.create_secret(key, 'ai-key-' || book::text, 'Model API key');
    insert into public.ai_secrets (book, key_secret, model)
    values (book, made, coalesce(model, 'gemini-3.6-flash'));
  else
    perform vault.update_secret(held.key_secret, key);
    update public.ai_secrets s
    set model = coalesce(set_ai_key.model, s.model)
    where s.book = set_ai_key.book;
  end if;
end;
$$;

revoke all on function public.set_ai_key(uuid, text, text) from public;
grant execute on function public.set_ai_key(uuid, text, text) to authenticated;

/** Which model to use, for a key already kept. */
create or replace function public.set_ai_model(book uuid, model text, models jsonb default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;
  update public.ai_secrets s
  set model = set_ai_model.model,
      models = coalesce(set_ai_model.models, s.models)
  where s.book = set_ai_model.book;
end;
$$;

revoke all on function public.set_ai_model(uuid, text, jsonb) from public;
grant execute on function public.set_ai_model(uuid, text, jsonb) to authenticated;

/**
 * Forget the key.
 *
 * The secret goes with the row. Left behind, it would be somebody's live
 * billing key sitting in a vault nothing points at any more.
 */
create or replace function public.clear_ai_key(book uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.ai_secrets;
begin
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;
  select * into held from public.ai_secrets s where s.book = clear_ai_key.book;
  if held is null then
    return;
  end if;
  delete from public.ai_secrets s where s.book = clear_ai_key.book;
  delete from vault.secrets where id = held.key_secret;
end;
$$;

revoke all on function public.clear_ai_key(uuid) from public;
grant execute on function public.clear_ai_key(uuid) to authenticated;

/**
 * What the page may know: that a key exists, which model, and what is left.
 *
 * Never the key. The first characters and the last are enough to recognise
 * which one it is and not enough to use it anywhere.
 */
create or replace function public.ai_state(book uuid)
returns table (
  configured boolean,
  key text,
  model text,
  models jsonb,
  used_today integer,
  demo_used integer,
  batch integer,
  per_book integer
)
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  limits record;
begin
  if not public.has_role(book, array['owner', 'bookkeeper', 'accountant']::public.book_role[]) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;
  select * into limits from public.ai_limits();

  return query
  select
    s.book is not null,
    case
      when s.book is null then ''
      else left(v.decrypted_secret, 6) || '…' || right(v.decrypted_secret, 4)
    end,
    coalesce(s.model, 'gemini-3.6-flash'),
    coalesce(s.models, '[]'::jsonb),
    coalesce((select u.used from public.ai_usage u
              where u.book = ai_state.book and u.day = (now() at time zone 'utc')::date), 0),
    coalesce((select sum(u.demo_used)::integer from public.ai_usage u
              where u.book = ai_state.book), 0),
    limits.batch,
    limits.per_book
  from (select ai_state.book as book) probe
  left join public.ai_secrets s on s.book = probe.book
  left join vault.decrypted_secrets v on v.id = s.key_secret;
end;
$$;

revoke all on function public.ai_state(uuid) from public;
grant execute on function public.ai_state(uuid) to authenticated;

/** The key itself, for the one thing allowed to have it. */
create or replace function public.ai_key_for(book uuid)
returns table (key text, model text)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select v.decrypted_secret, s.model
  from public.ai_secrets s
  join vault.decrypted_secrets v on v.id = s.key_secret
  where s.book = ai_key_for.book;
$$;

revoke all on function public.ai_key_for(uuid) from public, anon, authenticated;

/**
 * Count what is about to be asked, and refuse it if it is too much.
 *
 * Counted before the asking rather than after, because the way a cap fails is
 * a request that spends the money and then discovers it was not allowed to.
 * A refusal raises, so nothing is counted when nothing may proceed.
 */
create or replace function public.ai_take(book uuid, asking integer, demo boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  limits record;
  today date := (now() at time zone 'utc')::date;
  book_total integer;
  day_total integer;
begin
  select * into limits from public.ai_limits();

  if asking < 1 or asking > limits.batch then
    raise exception 'ask about between 1 and % at a time', limits.batch using errcode = 'PT400';
  end if;

  if demo then
    select coalesce(sum(u.demo_used), 0) into book_total
    from public.ai_usage u where u.book = ai_take.book;
    if book_total + asking > limits.per_book then
      raise exception
        'These books have used % of the % transactions the shared key allows. Add a key of your own to carry on.',
        book_total, limits.per_book
        using errcode = 'PT429';
    end if;

    insert into public.ai_day (day, used) values (today, 0)
    on conflict (day) do nothing;
    select d.used into day_total from public.ai_day d where d.day = today for update;
    if day_total + asking > limits.per_day then
      raise exception
        'The shared key has done all it does today. Try tomorrow, or add a key of your own.'
        using errcode = 'PT429';
    end if;
    update public.ai_day d set used = d.used + asking where d.day = today;
  end if;

  insert into public.ai_usage (book, day, used, demo_used)
  values (book, today, asking, case when demo then asking else 0 end)
  on conflict (book, day) do update
  set used = public.ai_usage.used + asking,
      demo_used = public.ai_usage.demo_used + case when demo then asking else 0 end;
end;
$$;

revoke all on function public.ai_take(uuid, integer, boolean) from public, anon, authenticated;

-- Supabase grants anon execute on new functions in public by default. Every
-- one of these refuses an anonymous caller at has_role anyway, but a refusal
-- reached is not the same as a door that was never open.
revoke execute on function public.ai_state(uuid) from anon;
revoke execute on function public.set_ai_key(uuid, text, text) from anon;
revoke execute on function public.set_ai_model(uuid, text, jsonb) from anon;
revoke execute on function public.clear_ai_key(uuid) from anon;
revoke execute on function public.ai_limits() from anon;
