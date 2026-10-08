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
