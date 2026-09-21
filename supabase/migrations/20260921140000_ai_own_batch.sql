-- A bigger batch for somebody spending their own money.
--
-- Twenty is right for the shared key: it is a trial, and a trial that can be
-- emptied in ten presses is not one. It is the wrong number for somebody who
-- brought their own key, where the only reasons to keep a batch small are
-- reading the answers and the model's attention -- both of which hold up
-- fine at a hundred, and neither of which is this installation's business.

drop function if exists public.ai_take(uuid, integer, boolean);
drop function if exists public.ai_state(uuid);
drop function if exists public.ai_limits();

create or replace function public.ai_limits()
returns table (batch integer, per_person integer, own_batch integer)
language sql
immutable
as $$
  select 20, 1000, 100;
$$;

revoke execute on function public.ai_limits() from anon;

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
  most integer;
  spent integer;
begin
  if who is null then
    raise exception 'not signed in' using errcode = 'PT401';
  end if;
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;

  select * into limits from public.ai_limits();
  most := case when demo then limits.batch else limits.own_batch end;
  if asking < 1 or asking > most then
    raise exception 'ask about between 1 and % at a time', most using errcode = 'PT400';
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

create or replace function public.ai_state(book uuid)
returns table (
  configured boolean,
  key text,
  model text,
  models jsonb,
  used_today integer,
  demo_used integer,
  batch integer,
  per_person integer,
  own_batch integer
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
    limits.per_person,
    limits.own_batch
  from (select ai_state.book as book) probe
  left join public.ai_secrets s on s.book = probe.book
  left join vault.decrypted_secrets v on v.id = s.key_secret;
end;
$$;

revoke all on function public.ai_state(uuid) from public, anon;
grant execute on function public.ai_state(uuid) to authenticated;
