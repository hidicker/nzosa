-- Access that ends on a date, and when each person last signed in.
--
-- An accountant asked in for the year end needs the books for a few weeks,
-- not for ever. An invitation can say until when; accepting it carries the
-- date to the membership, and from the day after it the person is no longer
-- a member: every policy and function asks is_member or has_role, and both
-- now leave out a membership that has ended. Nothing is deleted, so an owner
-- can extend it, and the list of people still shows it, as ended.
--
-- An owner's access never ends: books with no owner able to manage them are
-- the one state worth making impossible.

alter table public.book_invitations add column if not exists access_until date;
alter table public.book_members add column if not exists access_until date;

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
      and (m.access_until is null or m.access_until >= current_date)
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
      and (m.access_until is null or m.access_until >= current_date)
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

/**
 * Until when somebody may use the books: on their invitation if it is still
 * waiting, and on their membership if they are in. Null for no end. Only an
 * owner, and never on an owner.
 */
create or replace function public.set_access_until(book uuid, who text, until date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched integer := 0;
  n integer;
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may say how long somebody has these books' using errcode = '42501';
  end if;
  if until is not null and until < current_date then
    raise exception 'that date has passed' using errcode = 'PT400';
  end if;

  update public.book_invitations
  set access_until = until
  where book_id = book and state = 'pending' and lower(email) = lower(trim(who)) and role <> 'owner';
  get diagnostics n = row_count;
  touched := touched + n;

  update public.book_members m
  set access_until = until
  from auth.users u
  where m.book_id = book and m.user_id = u.id and lower(u.email) = lower(trim(who)) and m.role <> 'owner';
  get diagnostics n = row_count;
  touched := touched + n;

  return case when touched > 0 then 'set' else 'nobody' end;
end;
$$;

/** Taking one up, with its end date if it has one. */
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
  on conflict (book_id, user_id) do update set role = excluded.role, access_until = excluded.access_until;

  update public.book_invitations
  set state = 'accepted', responded_at = now()
  where id = invitation;
  return 'accepted';
end;
$$;

-- The lists gain the date, and the people list when each last signed in.
-- Their shapes change, so they are made again.
drop function if exists public.book_member_list(uuid);
create function public.book_member_list(book uuid)
returns table (
  user_id uuid,
  email text,
  role public.book_role,
  since timestamptz,
  access_until date,
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

drop function if exists public.book_invitation_list(uuid);
create function public.book_invitation_list(book uuid)
returns table (id uuid, email text, role public.book_role, sent timestamptz, access_until date)
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

revoke execute on function public.book_member_list(uuid) from public, anon;
revoke execute on function public.book_invitation_list(uuid) from public, anon;
revoke execute on function public.set_access_until(uuid, text, date) from public, anon;
grant execute on function public.book_member_list(uuid) to authenticated;
grant execute on function public.book_invitation_list(uuid) to authenticated;
grant execute on function public.set_access_until(uuid, text, date) to authenticated;
