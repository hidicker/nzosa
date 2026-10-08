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
