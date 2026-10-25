-- Attachments for books kept online: the receipt for a bank line, the bill as
-- it arrived, kept in Supabase Storage beside the books.
--
-- One private bucket. Each file is kept under its books' id -- a path of
-- "<book id>/<attachment id>" -- and the policies read that first folder:
-- anybody in the books may open a file, and anybody who may change the books
-- (an owner, a bookkeeper or the accountant, not read only) may add, replace
-- or remove one. Whether somebody is in the books is decided by is_member and
-- has_role, the same as for every other part of them, so access that has
-- ended (see access_until) ends here too. A path whose first folder is not a
-- set of books' id is refused rather than guessed at.
--
-- Which file belongs to which document is kept in the books themselves; this
-- holds only the bytes.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

/** The books a stored file's path names, or null where its first folder is not an id. */
create or replace function public.attachment_book(path text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  folder text := split_part(path, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return folder::uuid;
end;
$$;

grant execute on function public.attachment_book(text) to authenticated;

drop policy if exists attachments_read on storage.objects;
drop policy if exists attachments_add on storage.objects;
drop policy if exists attachments_change on storage.objects;
drop policy if exists attachments_remove on storage.objects;

create policy attachments_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(public.attachment_book(name)));

create policy attachments_add on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  );

create policy attachments_change on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  )
  with check (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  );

create policy attachments_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  );
