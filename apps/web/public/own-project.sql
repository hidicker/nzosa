-- NZOSA: the tables for books kept in your own Supabase project.
-- Paste all of this into your project's SQL editor and run it once.
-- Made by tools/own-project-sql.mjs from the migrations in supabase/migrations.

-- ============================================================ 20260916000000_books
-- NZOSA hosted: books, who may see them, and how a part is saved.
--
-- The local app keeps one folder per set of books and one file per part. This
-- is the same shape: one row per part, holding the same JSON, so the browser
-- code that reads and writes parts does not have to learn a new model -- only
-- where to send them.
--
-- Two things the folder never had to answer, because a folder on your own
-- computer answers them by existing: who may read these books, and what
-- happens when two people save the same part at once. Both are settled here
-- rather than in the app, because a rule the database enforces holds however
-- somebody arrives -- another tab, another client, a bug in the browser code.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- The books, and who may see them
-- ---------------------------------------------------------------------------

create table public.books (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Cleared books keep a dated copy on disk today. Here, a set of books is
  -- never deleted outright either: it is marked, stops being listed, and can
  -- be brought back until a retention job removes it for good.
  deleted_at timestamptz
);

comment on table public.books is 'One set of books: a company, a rental, a person.';

-- Roles, spelled out rather than a bitfield, because they end up in policies
-- and a policy nobody can read is a policy nobody can check.
--   owner       -- everything, including who else may look
--   bookkeeper  -- codes and saves, cannot change membership
--   accountant  -- reads everything, changes nothing
create type public.book_role as enum ('owner', 'bookkeeper', 'accountant');

create table public.book_members (
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.book_role not null default 'bookkeeper',
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

create index book_members_user_idx on public.book_members (user_id);

-- ---------------------------------------------------------------------------
-- The parts, which are the books themselves
-- ---------------------------------------------------------------------------

-- The same list the folder writes, so a set of books can move between the two
-- without translation. A part not on this list is a bug, not a new feature.
create type public.book_part as enum (
  'transactions', 'decisions', 'chart', 'entities', 'rules', 'invoices',
  'allocations', 'assets', 'journals', 'reference', 'rulesarchive', 'filed',
  'events'
);

create table public.book_parts (
  book_id uuid not null references public.books (id) on delete cascade,
  part public.book_part not null,
  -- Counts up on every save. A save that does not know the version it is
  -- replacing is refused: see save_part below.
  version bigint not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (book_id, part)
);

-- What each save replaced, kept for a while.
--
-- The local app promises that clearing is reversible and that History can put
-- a change back. Neither survives a move to a server unless the server keeps
-- what it overwrote, so it does: every save writes the old row here first.
-- A retention job trims this; nothing in the app reads it except a restore.
create table public.book_part_history (
  id bigserial primary key,
  book_id uuid not null references public.books (id) on delete cascade,
  part public.book_part not null,
  version bigint not null,
  data jsonb not null,
  replaced_at timestamptz not null default now(),
  replaced_by uuid references auth.users (id) on delete set null
);

create index book_part_history_book_idx
  on public.book_part_history (book_id, part, version desc);

-- ---------------------------------------------------------------------------
-- Membership tests
--
-- Security definer, so they read the membership table without the policies
-- that are themselves defined in terms of this -- which would otherwise
-- recurse until Postgres gave up. search_path is pinned for the same reason
-- any definer function pins it: so a caller cannot put its own table in front
-- of the one meant here.
-- ---------------------------------------------------------------------------

create or replace function public.is_member(book uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.book_members m
    where m.book_id = book and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_role(book uuid, roles public.book_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.book_members m
    where m.book_id = book and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.book_role[]) to authenticated;

-- Whoever makes a set of books owns it. Done here rather than in the app
-- because a book with no members is unreachable by anybody, including the
-- person who just made it.
create or replace function public.claim_new_book()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.book_members (book_id, user_id, role, added_by)
  values (new.id, new.created_by, 'owner', new.created_by);
  return new;
end;
$$;

create trigger books_claim_owner
  after insert on public.books
  for each row execute function public.claim_new_book();

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

alter table public.books enable row level security;
alter table public.book_members enable row level security;
alter table public.book_parts enable row level security;
alter table public.book_part_history enable row level security;

-- Books: members see them; anybody signed in may start one; owners rename and
-- retire them.
create policy books_read on public.books
  for select to authenticated
  using (deleted_at is null and public.is_member(id));

create policy books_create on public.books
  for insert to authenticated
  with check (created_by = auth.uid());

create policy books_update on public.books
  for update to authenticated
  using (public.has_role(id, array['owner']::public.book_role[]))
  with check (public.has_role(id, array['owner']::public.book_role[]));

-- No delete policy at all: a set of books is retired by setting deleted_at,
-- and only a retention job running as the service role ever removes one.

-- Membership: everybody in a set of books can see who else is; only an owner
-- changes it.
create policy members_read on public.book_members
  for select to authenticated
  using (public.is_member(book_id));

create policy members_write on public.book_members
  for all to authenticated
  using (public.has_role(book_id, array['owner']::public.book_role[]))
  with check (public.has_role(book_id, array['owner']::public.book_role[]));

-- Parts: members read; owners and bookkeepers write. The accountant's read-only
-- role is the whole reason writing is named separately from reading.
create policy parts_read on public.book_parts
  for select to authenticated
  using (public.is_member(book_id));

create policy parts_write on public.book_parts
  for all to authenticated
  using (public.has_role(book_id, array['owner', 'bookkeeper']::public.book_role[]))
  with check (public.has_role(book_id, array['owner', 'bookkeeper']::public.book_role[]));

-- History is readable by members and written only by save_part, which runs as
-- its definer. Nobody edits what was overwritten.
create policy history_read on public.book_part_history
  for select to authenticated
  using (public.is_member(book_id));

-- ---------------------------------------------------------------------------
-- Saving a part
--
-- The folder writes a whole part at a time and gets away with it: one person,
-- one computer, and a rename that either happened or did not. On a server two
-- people can hold the same part, and a plain write would let the second save
-- throw away the first without either of them noticing -- the coding somebody
-- did this morning, gone, with nothing on screen to say so.
--
-- So a save says which version it is replacing. If that is no longer the
-- version on the row, the save is refused and the app has to reload and try
-- again. Refusing is the only honest answer: the server cannot merge two
-- people's decisions about the same transactions.
-- ---------------------------------------------------------------------------

create or replace function public.save_part(
  p_book uuid,
  p_part public.book_part,
  p_data jsonb,
  p_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version bigint;
  next_version bigint;
begin
  if not public.has_role(p_book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not allowed to write these books' using errcode = '42501';
  end if;

  select version into current_version
  from public.book_parts
  where book_id = p_book and part = p_part
  for update;

  if current_version is null then
    -- A part saved for the first time. 0 means "there was nothing here";
    -- anything else means the caller thinks it is replacing something.
    if coalesce(p_version, 0) <> 0 then
      raise exception 'version % does not exist for %', p_version, p_part
        using errcode = '40001';
    end if;
    insert into public.book_parts (book_id, part, version, data, updated_by)
    values (p_book, p_part, 1, p_data, auth.uid());
    return 1;
  end if;

  if p_version is distinct from current_version then
    raise exception 'these books changed since you loaded them (% is now %)',
      p_part, current_version using errcode = '40001';
  end if;

  insert into public.book_part_history (book_id, part, version, data, replaced_by)
  select book_id, part, version, data, auth.uid()
  from public.book_parts
  where book_id = p_book and part = p_part;

  next_version := current_version + 1;
  update public.book_parts
  set version = next_version, data = p_data, updated_at = now(), updated_by = auth.uid()
  where book_id = p_book and part = p_part;

  return next_version;
end;
$$;

grant execute on function public.save_part(uuid, public.book_part, jsonb, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Bank feed credentials
--
-- The local server keeps Akahu's tokens in a file beside the books and never
-- lets the page see them. Here they are held by Supabase Vault, which stores
-- them encrypted, and this table keeps only the ids of those secrets. Nothing
-- signed in can read this table at all: the edge function that talks to Akahu
-- runs as the service role, and that is the only way to the tokens.
-- ---------------------------------------------------------------------------

create table public.bank_feeds (
  book_id uuid primary key references public.books (id) on delete cascade,
  app_token_secret uuid not null,
  user_token_secret uuid not null,
  -- Which of Akahu's accounts is which of ours, and how far back to ask.
  accounts jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  last_fetch timestamptz
);

alter table public.bank_feeds enable row level security;
-- No policies. With row level security on and nothing granted, every signed-in
-- user is refused, and only the service role reaches it. That is deliberate:
-- a token that reaches somebody's bank data has no business being readable by
-- the browser that asked for it.

-- Whether a set of books has a feed connected is a fact the app needs and the
-- tokens are not. This says that much and nothing more.
create or replace function public.feed_status(book uuid)
returns table (connected boolean, accounts jsonb, settings jsonb, last_fetch timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select true, f.accounts, f.settings, f.last_fetch
  from public.bank_feeds f
  where f.book_id = book and public.is_member(book);
$$;

grant execute on function public.feed_status(uuid) to authenticated;

-- ============================================================ 20260916120000_members
-- Letting somebody else into a set of books, and seeing who is already there.
--
-- Both need something a signed-in client cannot be given directly: the ability
-- to look somebody up by email. Nobody should be able to ask this system
-- whether an address has an account, let alone list the people on it, so the
-- lookup happens inside functions that run as their definer and check what the
-- caller is entitled to before doing anything.
--
-- What these do not do is invite a stranger. Adding somebody who has no account
-- would mean sending mail on an owner's behalf to an address the system has
-- never verified, which is a different feature with different risks. Until then
-- the honest answer is that the person needs an account first, and it is said
-- plainly rather than by appearing to work.

/**
 * Who is in this set of books.
 *
 * Emails are shown, because a list of anonymous ids is no use to somebody
 * deciding whether to remove a person -- and these are people who already
 * share the books being listed.
 */
create or replace function public.book_member_list(book uuid)
returns table (user_id uuid, email text, role public.book_role, since timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.book_members m
  join auth.users u on u.id = m.user_id
  where m.book_id = book and public.is_member(book)
  order by m.created_at;
$$;

/**
 * Add somebody, or change what they may do.
 *
 * Only an owner, and only to books that owner is in. The reply says which of
 * the three things happened rather than raising: "there is no account for that
 * address" is an ordinary answer to give somebody typing an email, not a fault.
 */
create or replace function public.add_book_member(
  book uuid,
  who text,
  as_role public.book_role
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may add somebody to these books' using errcode = '42501';
  end if;

  select id into target from auth.users where lower(email) = lower(trim(who)) limit 1;
  if target is null then
    return 'no account';
  end if;

  insert into public.book_members (book_id, user_id, role, added_by)
  values (book, target, as_role, auth.uid())
  on conflict (book_id, user_id) do update set role = excluded.role;

  return 'added';
end;
$$;

/**
 * Take somebody out again.
 *
 * The last owner cannot be removed or demoted. A set of books with nobody able
 * to manage it is not a safety measure, it is a set of books that has to be
 * rescued by whoever runs the server -- and on a system whose whole promise is
 * that the owner is in charge, that is the one state worth making impossible.
 */
create or replace function public.remove_book_member(book uuid, who uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owners integer;
  their_role public.book_role;
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may remove somebody from these books' using errcode = '42501';
  end if;

  select role into their_role from public.book_members
  where book_id = book and user_id = who;
  if their_role is null then
    return 'not a member';
  end if;

  select count(*) into owners from public.book_members
  where book_id = book and role = 'owner';
  if their_role = 'owner' and owners <= 1 then
    return 'last owner';
  end if;

  delete from public.book_members where book_id = book and user_id = who;
  return 'removed';
end;
$$;

grant execute on function public.book_member_list(uuid) to authenticated;
grant execute on function public.add_book_member(uuid, text, public.book_role) to authenticated;
grant execute on function public.remove_book_member(uuid, uuid) to authenticated;

-- ============================================================ 20260916170000_create_book
-- Starting a set of books, in one answer.
--
-- Inserting straight into `books` works and then appears not to. The row is
-- created, the trigger makes the person its owner, and the insert still comes
-- back empty: what an insert returns is filtered by the read policy, that
-- policy asks whether the caller is a member, and the trigger that makes them
-- one has not fired yet at that moment. So the page is told nothing was made,
-- while something was -- the worst of both, and the kind of thing somebody
-- then does three times.
--
-- Doing the whole thing in one function settles it. The ownership row is
-- written before anything is returned, and the caller gets the books back.

create or replace function public.create_book(wanted text)
returns setof public.books
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  made public.books;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(trim(wanted), '') = '' then
    raise exception 'a set of books needs a name' using errcode = '22023';
  end if;

  insert into public.books (name, created_by)
  values (trim(wanted), me)
  returning * into made;

  -- The trigger on `books` has already made the caller its owner. Said here
  -- because the next person to read this will wonder, and because if that
  -- trigger ever goes, this is where the books would quietly become
  -- unreachable.
  return query select * from public.books b where b.id = made.id;
end;
$$;

grant execute on function public.create_book(text) to authenticated;

-- ============================================================ 20260916190000_conflict_code
-- A stale save has to reach the page as a refusal, not as a timeout.
--
-- save_part refused a save built on an old version with SQLSTATE 40001. That is
-- Postgres's serialization_failure, and PostgREST treats it as a transient
-- error worth retrying -- so it retried the refusal, over and over, until the
-- gateway gave up and answered 504 after the better part of a minute. The page
-- never saw the code it looks for, the banner that says "these books changed
-- somewhere else" could never appear, and a conflicting save just hung.
--
-- PT409 is PostgREST's own convention: a code starting PT is passed through
-- untouched, with the rest as the HTTP status. So a stale save is now an
-- immediate 409 carrying code PT409, and nothing retries it.

create or replace function public.save_part(
  p_book uuid,
  p_part public.book_part,
  p_data jsonb,
  p_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version bigint;
  next_version bigint;
begin
  if not public.has_role(p_book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not allowed to write these books' using errcode = '42501';
  end if;

  select version into current_version
  from public.book_parts
  where book_id = p_book and part = p_part
  for update;

  if current_version is null then
    if coalesce(p_version, 0) <> 0 then
      raise exception 'version % does not exist for %', p_version, p_part
        using errcode = 'PT409';
    end if;
    insert into public.book_parts (book_id, part, version, data, updated_by)
    values (p_book, p_part, 1, p_data, auth.uid());
    return 1;
  end if;

  if p_version is distinct from current_version then
    raise exception 'these books changed since you loaded them (% is now %)',
      p_part, current_version using errcode = 'PT409';
  end if;

  insert into public.book_part_history (book_id, part, version, data, replaced_by)
  select book_id, part, version, data, auth.uid()
  from public.book_parts
  where book_id = p_book and part = p_part;

  next_version := current_version + 1;
  update public.book_parts
  set version = next_version, data = p_data, updated_at = now(), updated_by = auth.uid()
  where book_id = p_book and part = p_part;

  return next_version;
end;
$$;

grant execute on function public.save_part(uuid, public.book_part, jsonb, bigint) to authenticated;

-- ============================================================ 20260919090000_lock_tables_and_invitations
-- Security review, 16 September 2026: the findings that were code, not advice.
--
-- 1. The tables were writable directly. Every safeguard worth having lived in a
--    function -- version checks, kept history, "the last owner cannot leave" --
--    and a member could simply not use them: a bookkeeper overwrote a part with
--    no history kept, deleted every part of a set of books, and an owner
--    removed the last owner, all through plain table writes. Reading stays as
--    it was; writing now has one door.
--
-- 2. Adding somebody by email answered "added" or "no account", which turns
--    this into a service for testing whether an address has an account -- and
--    an accepted add put a stranger's books into that person's list unasked.
--    Invitations replace it: the answer never varies, and the person decides.
--
-- 3. Nothing limited how many sets of books one account could make. Twenty-five
--    in a row succeeded, which on a free plan is a way to fill the database.

-- ---------------------------------------------------------------------------
-- 1. One door for writing
-- ---------------------------------------------------------------------------

drop policy if exists parts_write on public.book_parts;
drop policy if exists members_write on public.book_members;
drop policy if exists books_create on public.books;

revoke insert, update, delete, truncate, references
  on public.book_parts, public.book_members, public.book_part_history,
     public.bank_feeds, public.books
  from anon, authenticated;

-- Renaming a set of books, and retiring one, stay with its owner: those are the
-- only two columns anybody has a reason to change, and a column grant says so
-- in a way a policy cannot.
grant update (name, deleted_at) on public.books to authenticated;

-- Reading is unchanged, and still filtered by the policies beside each table.
grant select on public.books, public.book_parts, public.book_members,
                public.book_part_history to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Invitations, rather than adding somebody to your books unasked
-- ---------------------------------------------------------------------------

create table if not exists public.book_invitations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  -- As typed, for showing back; matched case-insensitively.
  email text not null check (length(trim(email)) between 3 and 320),
  role public.book_role not null default 'bookkeeper',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  state text not null default 'pending'
    check (state in ('pending', 'accepted', 'declined', 'cancelled'))
);

-- One live invitation per person per set of books; inviting again updates it.
create unique index if not exists book_invitations_pending
  on public.book_invitations (book_id, lower(email))
  where state = 'pending';

create index if not exists book_invitations_email
  on public.book_invitations (lower(email)) where state = 'pending';

alter table public.book_invitations enable row level security;
-- No policies and no grants: every road in is a function below, each of which
-- checks who is asking first. A table anybody could read is a list of which
-- addresses have been invited to what.
revoke all on public.book_invitations from anon, authenticated;

/** The address on the caller's own token. Invitations are matched on it. */
create or replace function public.my_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

/**
 * Invite somebody to a set of books.
 *
 * Always answers the same, whether or not that address has an account: the old
 * version answered "added" or "no account", which let anybody signed in ask
 * this system whether an email address is registered. Nothing is shared until
 * the person accepts.
 */
create or replace function public.invite_to_book(
  book uuid,
  who text,
  as_role public.book_role
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may invite somebody to these books'
      using errcode = '42501';
  end if;
  if coalesce(trim(who), '') = '' or position('@' in who) = 0 then
    raise exception 'that is not an email address' using errcode = 'PT400';
  end if;

  insert into public.book_invitations (book_id, email, role, invited_by)
  values (book, trim(who), as_role, auth.uid())
  on conflict (book_id, lower(email)) where state = 'pending'
  do update set role = excluded.role, created_at = now(), invited_by = auth.uid();

  return 'invited';
end;
$$;

/** Invitations still waiting on an answer, for the owner who sent them. */
create or replace function public.book_invitation_list(book uuid)
returns table (id uuid, email text, role public.book_role, sent timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.email, i.role, i.created_at
  from public.book_invitations i
  where i.book_id = book and i.state = 'pending' and public.is_member(book)
  order by i.created_at;
$$;

/** What is waiting for the person signed in, wherever it came from. */
create or replace function public.my_invitations()
returns table (id uuid, books text, role public.book_role, invited_by text, sent timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, b.name, i.role, coalesce(u.email::text, ''), i.created_at
  from public.book_invitations i
  join public.books b on b.id = i.book_id
  left join auth.users u on u.id = i.invited_by
  where i.state = 'pending'
    and lower(i.email) = public.my_email()
    and public.my_email() <> ''
    and b.deleted_at is null
  order by i.created_at;
$$;

/** Taking one up. Only the person the invitation was addressed to. */
create or replace function public.accept_invitation(invitation uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  held public.book_invitations;
begin
  select * into held from public.book_invitations
  where id = invitation and state = 'pending' and lower(email) = public.my_email();
  if held.id is null then
    return 'not yours';
  end if;

  insert into public.book_members (book_id, user_id, role, added_by)
  values (held.book_id, auth.uid(), held.role, held.invited_by)
  on conflict (book_id, user_id) do update set role = excluded.role;

  update public.book_invitations
  set state = 'accepted', responded_at = now()
  where id = invitation;
  return 'accepted';
end;
$$;

/** Turning one down, which is also how somebody stops being asked. */
create or replace function public.decline_invitation(invitation uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.book_invitations
  set state = 'declined', responded_at = now()
  where id = invitation and state = 'pending' and lower(email) = public.my_email();
  return case when found then 'declined' else 'not yours' end;
end;
$$;

/** Withdrawing one, for the owner who sent it. */
create or replace function public.cancel_invitation(invitation uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  held public.book_invitations;
begin
  select * into held from public.book_invitations where id = invitation;
  if held.id is null then return 'not found'; end if;
  if not public.has_role(held.book_id, array['owner']::public.book_role[]) then
    raise exception 'only an owner may withdraw an invitation' using errcode = '42501';
  end if;
  update public.book_invitations
  set state = 'cancelled', responded_at = now()
  where id = invitation and state = 'pending';
  return 'cancelled';
end;
$$;

-- The old way in, which told anybody whether an address had an account.
drop function if exists public.add_book_member(uuid, text, public.book_role);

-- ---------------------------------------------------------------------------
-- 3. A limit on how many sets of books one account may start
-- ---------------------------------------------------------------------------

create or replace function public.create_book(wanted text)
returns setof public.books
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  made public.books;
  held integer;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(trim(wanted), '') = '' then
    raise exception 'a set of books needs a name' using errcode = '22023';
  end if;

  select count(*) into held from public.books
  where created_by = me and deleted_at is null;
  if held >= 20 then
    raise exception 'that is twenty sets of books already; retire one first'
      using errcode = 'PT429';
  end if;

  insert into public.books (name, created_by)
  values (trim(wanted), me)
  returning * into made;

  return query select * from public.books b where b.id = made.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function public.my_email() from public, anon;
revoke execute on function public.invite_to_book(uuid, text, public.book_role) from public, anon;
revoke execute on function public.book_invitation_list(uuid) from public, anon;
revoke execute on function public.my_invitations() from public, anon;
revoke execute on function public.accept_invitation(uuid) from public, anon;
revoke execute on function public.decline_invitation(uuid) from public, anon;
revoke execute on function public.cancel_invitation(uuid) from public, anon;
revoke execute on function public.create_book(text) from public, anon;
revoke execute on function public.save_part(uuid, public.book_part, jsonb, bigint) from public, anon;
revoke execute on function public.remove_book_member(uuid, uuid) from public, anon;
revoke execute on function public.book_member_list(uuid) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, public.book_role[]) from public, anon;
revoke execute on function public.feed_status(uuid) from public, anon;

grant execute on function public.my_email() to authenticated;
grant execute on function public.invite_to_book(uuid, text, public.book_role) to authenticated;
grant execute on function public.book_invitation_list(uuid) to authenticated;
grant execute on function public.my_invitations() to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;
grant execute on function public.cancel_invitation(uuid) to authenticated;
grant execute on function public.create_book(text) to authenticated;
grant execute on function public.save_part(uuid, public.book_part, jsonb, bigint) to authenticated;
grant execute on function public.remove_book_member(uuid, uuid) to authenticated;
grant execute on function public.book_member_list(uuid) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.book_role[]) to authenticated;
grant execute on function public.feed_status(uuid) to authenticated;

-- ============================================================ 20261008090000_roles
-- Roles: the accountant works in the books, and a read-only role to look.
--
-- The accountant was read-only. Every other accounting system has it the
-- other way round -- the person who signs the year off can do the most -- and
-- a read-only accountant could not move a lock date, make a year-end
-- adjustment or correct a coding. So:
--
--   owner       everything, including who else is a member
--   accountant  everything in the books, including lock dates; not members
--   bookkeeper  the daily work; cannot move a lock (enforced in the app)
--   readonly    sees everything, changes nothing
--
-- Done in has_role, which every policy, function and edge function asks,
-- rather than by rewriting each of their role lists:
--
--   * A list that admits bookkeepers admits accountants too: an accountant
--     may do whatever a bookkeeper may.
--   * A list naming owner, bookkeeper and accountant together is the existing
--     way of saying "any member" -- the status checks -- and admits read-only
--     members as well.
--   * Anything else is exact. ['owner'] is the owner alone, and
--     ['owner', 'accountant'] -- moving a lock -- is not a bookkeeper or a
--     read-only member.
--
-- Compared as text so that nothing here uses the new enum value in the same
-- transaction that adds it.

alter type public.book_role add value if not exists 'readonly';

create or replace function public.has_role(book uuid, roles public.book_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.book_members m
    where m.book_id = book
      and m.user_id = auth.uid()
      and (
        m.role = any (roles)
        or (m.role::text = 'accountant' and 'bookkeeper' = any (roles::text[]))
        or (
          'owner' = any (roles::text[])
          and 'bookkeeper' = any (roles::text[])
          and 'accountant' = any (roles::text[])
        )
      )
  );
$$;

revoke execute on function public.has_role(uuid, public.book_role[]) from public, anon;
grant execute on function public.has_role(uuid, public.book_role[]) to authenticated;

-- ============================================================ 20261010090000_delete_books
-- Deleting a set of books, safely.
--
-- A set is never erased here. Deleting marks it (books.deleted_at, there
-- since the first migration), and the read policy already hides a marked set
-- from everybody, members included. Everything in it stays, and an owner can
-- bring it back from the Books page. Nothing removes a set for good yet: that
-- would be a retention job, and it would have to take the set's vault secrets
-- with it (they do not cascade).
--
-- Functions rather than an update from the page, because a marked row can no
-- longer be read back -- the read policy hides it -- so an update asking for
-- the row would be refused, and a list of deleted sets has to step around that
-- policy on purpose, for owners only.

create or replace function public.delete_book(book uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may delete these books' using errcode = '42501';
  end if;
  update public.books set deleted_at = now() where id = book and deleted_at is null;
  return 'deleted';
end;
$$;

/** Sets the caller owns that have been deleted, newest first. */
create or replace function public.deleted_books()
returns table (id uuid, name text, deleted_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.name, b.deleted_at
  from public.books b
  where b.deleted_at is not null
    and public.has_role(b.id, array['owner']::public.book_role[])
  order by b.deleted_at desc;
$$;

create or replace function public.restore_book(book uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may restore these books' using errcode = '42501';
  end if;
  update public.books set deleted_at = null where id = book;
  return 'restored';
end;
$$;

revoke all on function public.delete_book(uuid) from public, anon;
revoke all on function public.deleted_books() from public, anon;
revoke all on function public.restore_book(uuid) from public, anon;
grant execute on function public.delete_book(uuid) to authenticated;
grant execute on function public.deleted_books() to authenticated;
grant execute on function public.restore_book(uuid) to authenticated;

-- ============================================================ parts added later
alter type public.book_part add value if not exists 'payroll';
alter type public.book_part add value if not exists 'nightly';
