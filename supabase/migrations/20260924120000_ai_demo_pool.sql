-- The online demo's allowance of AI suggestions: one pool for every visitor,
-- reset by hand.
--
-- The demo has no sign-in, so there is nobody to count per person. It shares
-- one allowance instead, counted in lines like every other allowance here,
-- and it does not refill on its own: whoever runs the site says when. That
-- makes the bill a number somebody chose rather than one that depends on how
-- many identities a visitor can make.
--
-- Nothing here is reachable by the public or by signed-in users. Only the
-- gemini-demo function can take from the pool, as the service role, and only
-- somebody with access to this project can reset it:
--
--   update public.ai_demo_pool set used = 0, reset_at = now();

create table public.ai_demo_pool (
  id       boolean primary key default true check (id),   -- exactly one row
  used     integer not null default 0,
  cap      integer not null default 1000,
  reset_at timestamptz not null default now()
);
insert into public.ai_demo_pool default values;
alter table public.ai_demo_pool enable row level security;
revoke all on public.ai_demo_pool from anon, authenticated;

-- Take lines from the pool, or refuse. One statement, so two presses at the
-- same moment cannot both squeeze past the cap.
create function public.ai_demo_take(asking integer) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare left_after integer;
begin
  if asking < 1 or asking > 20 then
    raise exception 'ask about between 1 and 20 at a time' using errcode = 'PT400';
  end if;
  update public.ai_demo_pool set used = used + asking
   where id and used + asking <= cap
   returning cap - used into left_after;
  if left_after is null then
    raise exception 'The demo has used its allowance of AI suggestions. Copy a prompt instead, or run NZOSA with a key of your own.'
      using errcode = 'PT429';
  end if;
  return left_after;
end $$;

create function public.ai_demo_left() returns integer
language sql security definer set search_path = public, pg_temp as $$
  select greatest(cap - used, 0) from public.ai_demo_pool where id;
$$;

revoke all on function public.ai_demo_take(integer) from public, anon, authenticated;
revoke all on function public.ai_demo_left()        from public, anon, authenticated;
