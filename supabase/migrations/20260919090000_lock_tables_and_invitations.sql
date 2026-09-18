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
