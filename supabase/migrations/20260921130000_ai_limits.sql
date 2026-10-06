-- The shared key's allowance, counted per person for good.
--
-- It was a daily ceiling for the whole site with a per-book total under it.
-- Per book is the wrong unit -- one person may start twenty -- and a daily
-- ceiling is an allowance that refills, which is not what a trial is. One
-- number now: a thousand transactions per person, ever.
--
-- Counting per person means knowing who is asking, so this runs as the caller
-- rather than as the service role. auth.uid() is then the person's own, taken
-- from their token by the database, and nothing the function passes in can
-- claim to be somebody else.

-- The shape of what these return is changing, and Postgres will not replace a
-- function whose OUT columns differ. Dropped first, by name.
drop function if exists public.ai_take(uuid, integer, boolean);
drop function if exists public.ai_state(uuid);
drop function if exists public.ai_limits();
drop table if exists public.ai_usage;

create table public.ai_usage (
  person uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  used integer not null default 0,
  -- Asked on the shared key. Kept for the life of the account rather than the
  -- day, because a trial is a trial and not a daily allowance.
  demo_used integer not null default 0,
  primary key (person, day)
);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.ai_limits()
returns table (batch integer, per_person integer)
language sql
immutable
as $$
  select 20, 1000;
$$;

revoke execute on function public.ai_limits() from anon;

/**
 * Count what is about to be asked, and refuse it if it is too much.
 *
 * Counted before the asking, because the way a cap fails is a request that
 * spends the money and then finds out it was not allowed to. A refusal
 * raises, so nothing is counted where nothing may proceed.
 *
 * The allowance is the person's, so it is not escaped by starting another set
 * of books. It is escaped by making another account, which is what open
 * sign-up means -- the ledger of what has been spent is here if that ever
 * needs answering with a number.
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
  who uuid := auth.uid();
  spent integer;
begin
  if who is null then
    raise exception 'not signed in' using errcode = 'PT401';
  end if;
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;

  select * into limits from public.ai_limits();
  if asking < 1 or asking > limits.batch then
    raise exception 'ask about between 1 and % at a time', limits.batch using errcode = 'PT400';
  end if;

  if demo then
    select coalesce(sum(u.demo_used), 0) into spent
    from public.ai_usage u where u.person = who;
    if spent + asking > limits.per_person then
      raise exception
        'You have used % of the % transactions the shared key allows. Add a key of your own to carry on.',
        spent, limits.per_person
        using errcode = 'PT429';
    end if;
  end if;

  insert into public.ai_usage (person, day, used, demo_used)
  values (who, today, asking, case when demo then asking else 0 end)
  on conflict (person, day) do update
  set used = public.ai_usage.used + asking,
      demo_used = public.ai_usage.demo_used + case when demo then asking else 0 end;
end;
$$;

revoke all on function public.ai_take(uuid, integer, boolean) from public, anon;
grant execute on function public.ai_take(uuid, integer, boolean) to authenticated;

/** What the page may know. Never the key itself. */
create or replace function public.ai_state(book uuid)
returns table (
  configured boolean,
  key text,
  model text,
  models jsonb,
  used_today integer,
  demo_used integer,
  batch integer,
  per_person integer
)
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  limits record;
  who uuid := auth.uid();
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
              where u.person = who and u.day = (now() at time zone 'utc')::date), 0),
    coalesce((select sum(u.demo_used)::integer from public.ai_usage u
              where u.person = who), 0),
    limits.batch,
    limits.per_person
  from (select ai_state.book as book) probe
  left join public.ai_secrets s on s.book = probe.book
  left join vault.decrypted_secrets v on v.id = s.key_secret;
end;
$$;

revoke all on function public.ai_state(uuid) from public, anon;
grant execute on function public.ai_state(uuid) to authenticated;

-- Kept as a record of what the shared key has done each day, so a question
-- about the bill has a number to answer it. Nothing is refused on it.
comment on table public.ai_day is
  'What the shared key was asked for, by day. A record, not a limit.';
