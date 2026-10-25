-- An end date on somebody's access, and when each person last signed in.
--
-- An accountant asked in for the year end, or a bookkeeper covering a month,
-- should not keep the books for good because nobody remembered to take them
-- off. An invitation can now carry the moment access ends; accepting it
-- carries that onto the membership, and an owner can set or clear it on a
-- member later. After it, the person is in the list still, marked, and can see
-- and change nothing: every way in goes through is_member or has_role, and
-- both now leave them out.
--
-- An owner's access never ends: a set of books whose owners have all run out
-- would be out of everybody's reach.
--
-- The member list also says when each person last signed in, from Supabase's
-- own record, so an owner can see who has not been in for a while.

alter table public.book_members add column if not exists access_until timestamptz;
alter table public.book_invitations add column if not exists access_until timestamptz;

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
      and (m.access_until is null or m.access_until > now())
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
    where m.book_id = book
      and m.user_id = auth.uid()
      and (m.access_until is null or m.access_until > now())
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

-- The invitation, with an optional end. Dropped and made again rather than
-- given an overload: two functions that both answer three named arguments
-- would leave PostgREST unable to choose.
drop function if exists public.invite_to_book(uuid, text, public.book_role);

create or replace function public.invite_to_book(
  book uuid,
  who text,
  as_role public.book_role,
  until timestamptz default null
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
  if until is not null and as_role::text = 'owner' then
    raise exception 'an owner''s access does not end' using errcode = 'PT400';
  end if;
  if until is not null and until <= now() then
    raise exception 'the end of access has to be later than now' using errcode = 'PT400';
  end if;

  insert into public.book_invitations (book_id, email, role, invited_by, access_until)
  values (book, trim(who), as_role, auth.uid(), until)
  on conflict (book_id, lower(email)) where state = 'pending'
  do update set role = excluded.role, created_at = now(), invited_by = auth.uid(),
    access_until = excluded.access_until;

  return 'invited';
end;
$$;

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

  insert into public.book_members (book_id, user_id, role, added_by, access_until)
  values (held.book_id, auth.uid(), held.role, held.invited_by, held.access_until)
  on conflict (book_id, user_id) do update
    set role = excluded.role, access_until = excluded.access_until;

  update public.book_invitations
  set state = 'accepted', responded_at = now()
  where id = invitation;
  return 'accepted';
end;
$$;

-- The lists, with the end date and the last sign-in. Their columns change, so
-- they are dropped first.
drop function if exists public.book_invitation_list(uuid);

create or replace function public.book_invitation_list(book uuid)
returns table (id uuid, email text, role public.book_role, sent timestamptz, access_until timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.email, i.role, i.created_at, i.access_until
  from public.book_invitations i
  where i.book_id = book and i.state = 'pending' and public.is_member(book)
  order by i.created_at;
$$;

drop function if exists public.book_member_list(uuid);

create or replace function public.book_member_list(book uuid)
returns table (
  user_id uuid,
  email text,
  role public.book_role,
  since timestamptz,
  access_until timestamptz,
  last_sign_in timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.user_id, u.email::text, m.role, m.created_at, m.access_until, u.last_sign_in_at
  from public.book_members m
  join auth.users u on u.id = m.user_id
  where m.book_id = book and public.is_member(book)
  order by m.created_at;
$$;

/** Set, move or clear when a member's access ends. An owner only, and never on an owner. */
create or replace function public.set_member_access_until(book uuid, who uuid, until timestamptz)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  their_role public.book_role;
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may change somebody''s access' using errcode = '42501';
  end if;
  select role into their_role from public.book_members where book_id = book and user_id = who;
  if their_role is null then
    return 'not a member';
  end if;
  if their_role::text = 'owner' and until is not null then
    raise exception 'an owner''s access does not end' using errcode = 'PT400';
  end if;
  update public.book_members set access_until = until where book_id = book and user_id = who;
  return case when until is null then 'cleared' else 'set' end;
end;
$$;

revoke execute on function public.invite_to_book(uuid, text, public.book_role, timestamptz) from public, anon;
revoke execute on function public.book_invitation_list(uuid) from public, anon;
revoke execute on function public.book_member_list(uuid) from public, anon;
revoke execute on function public.set_member_access_until(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.invite_to_book(uuid, text, public.book_role, timestamptz) to authenticated;
grant execute on function public.book_invitation_list(uuid) to authenticated;
grant execute on function public.book_member_list(uuid) to authenticated;
grant execute on function public.set_member_access_until(uuid, uuid, timestamptz) to authenticated;
