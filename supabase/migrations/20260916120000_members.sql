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
