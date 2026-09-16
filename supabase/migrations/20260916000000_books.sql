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
