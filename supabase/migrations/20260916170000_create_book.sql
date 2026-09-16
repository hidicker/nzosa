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
