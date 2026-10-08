-- The morning run's two ways into the database, for the nightly function only.

/** Books with "Ready every morning" turned on, and not deleted. */
create or replace function public.nightly_books()
returns table (book_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.book_id
  from public.book_parts p
  join public.books b on b.id = p.book_id
  where p.part = 'decisions'
    and b.deleted_at is null
    and (p.data ->> 'nightly') = 'true';
$$;

/**
 * Write the morning's part. Its own route rather than save_part, which asks
 * who the caller is: the morning run is nobody, and says so -- updated_by is
 * left empty. Only ever the 'nightly' part, never the books themselves.
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
  insert into public.book_parts (book_id, part, version, data, updated_by)
  values (book, 'nightly', 1, value, null)
  on conflict (book_id, part)
  do update set version = public.book_parts.version + 1, data = excluded.data,
    updated_at = now(), updated_by = null
  returning version into next_version;
  return next_version;
end;
$$;

revoke all on function public.nightly_books() from public, anon, authenticated;
revoke all on function public.nightly_put(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.nightly_books() to service_role;
grant execute on function public.nightly_put(uuid, jsonb) to service_role;
