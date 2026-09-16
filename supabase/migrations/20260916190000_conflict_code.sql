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
