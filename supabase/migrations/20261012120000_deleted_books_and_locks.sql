-- Test run, 12 October 2026: deleted books, lock dates, and book names.
--
-- 1. A deleted set of books was hidden from the books list and nothing else.
--    Its parts and their history could still be read, and save_part still
--    wrote to it, by anybody who knew its id. Now reading either table and
--    saving refuse a set with deleted_at set. Deleted sets and Restore are
--    unchanged: they ask has_role, not these, and read only the books row.
--
-- 2. Lock dates were enforced in the page alone, so a bookkeeper's save could
--    move them. save_part now refuses a decisions save that changes lockDates
--    from what the server holds unless the caller is an owner or accountant.
--    Only a change is refused: nearly every tick saves decisions, with the
--    lock dates in it unchanged. This is the lock dates themselves, not what
--    they lock -- refusing a change to a locked period's figures on the
--    server is on the backlog.
--
-- 3. A set's name went into the invitation email's subject as it was, and a
--    line break there is a header of the sender's choosing. The function
--    strips them now; this keeps new ones out of the name itself.
--
-- Apply in the SQL editor, as the others were.

-- ---------------------------------------------------------------------------
-- 1. Deleted books
-- ---------------------------------------------------------------------------

/** Whether a set of books exists and has not been deleted. */
create or replace function public.book_live(book uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.books b where b.id = book and b.deleted_at is null);
$$;

revoke all on function public.book_live(uuid) from public, anon;
grant execute on function public.book_live(uuid) to authenticated, service_role;

drop policy if exists parts_read on public.book_parts;
create policy parts_read on public.book_parts
  for select to authenticated
  using (public.is_member(book_id) and public.book_live(book_id));

drop policy if exists history_read on public.book_part_history;
create policy history_read on public.book_part_history
  for select to authenticated
  using (public.is_member(book_id) and public.book_live(book_id));

/**
 * The morning's part, as before, except for a set deleted since the run
 * listed it: skipped, answering null, rather than written to or failed.
 */
create or replace function public.nightly_put(book uuid, value jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_version bigint;
begin
  if not public.book_live(book) then
    return null;
  end if;
  insert into public.book_parts (book_id, part, version, data, updated_by)
  values (book, 'nightly', 1, value, null)
  on conflict (book_id, part)
  do update set version = public.book_parts.version + 1, data = excluded.data,
    updated_at = now(), updated_by = null
  returning version into next_version;
  return next_version;
end;
$$;

revoke all on function public.nightly_put(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.nightly_put(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 1 and 2. save_part
-- ---------------------------------------------------------------------------

/** Lock dates as compared: no key, null, {} and nulls inside all mean "none". */
create or replace function public.lock_dates_of(decisions jsonb)
returns jsonb
language sql
immutable
as $$
  select nullif(nullif(jsonb_strip_nulls(decisions -> 'lockDates'), '{}'::jsonb), 'null'::jsonb);
$$;

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
  current_data jsonb;
  next_version bigint;
  -- The service role (a function working for the books, not a person) is not
  -- a member of anything, and moves no lock a person did not.
  as_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not as_service
     and not public.has_role(p_book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not allowed to write these books' using errcode = '42501';
  end if;

  -- PT410 reaches the page as HTTP 410, with this message.
  if not public.book_live(p_book) then
    raise exception 'These books have been deleted. An owner can restore them from the Books page.'
      using errcode = 'PT410';
  end if;

  select version, data into current_version, current_data
  from public.book_parts
  where book_id = p_book and part = p_part
  for update;

  if p_part = 'decisions'
     and not as_service
     and public.lock_dates_of(p_data) is distinct from public.lock_dates_of(current_data)
     and not public.has_role(p_book, array['owner', 'accountant']::public.book_role[]) then
    raise exception 'Only an owner or the accountant can change the lock dates.'
      using errcode = 'PT403';
  end if;

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

revoke execute on function public.save_part(uuid, public.book_part, jsonb, bigint) from public, anon;
grant execute on function public.save_part(uuid, public.book_part, jsonb, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A book's name is one line
-- ---------------------------------------------------------------------------

-- NOT VALID: checked on every new name and rename, without refusing this
-- migration over a name already there. The invitation strips line breaks
-- from those either way.
alter table public.books drop constraint if exists books_name_one_line;
alter table public.books
  add constraint books_name_one_line check (name !~ '[\r\n]') not valid;
