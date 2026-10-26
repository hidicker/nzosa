-- Files attached to documents, journals, contacts and register lines, for
-- books kept online.
--
-- A private bucket, one folder a set of books: `<book id>/<attachment id>`.
-- The books themselves say what each file is; this keeps the bytes. Access
-- follows the book, through has_role as everything else does:
--
--   read          any member, read-only members included
--   add, remove   those who may change the books (owner, bookkeeper, and so
--                 an accountant); a read-only member cannot
--
-- A folder name that is not a book id is no book's, and so nobody's.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- The book an object belongs to, from the first part of its name; null when
-- that is not a book id, so a policy asking about it is simply false.
create or replace function public.attachment_book(object_name text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(object_name, '/', 2) ~ '^att-[0-9a-f]{16}$'
      and split_part(object_name, '/', 3) = ''
    then split_part(object_name, '/', 1)::uuid
  end;
$$;

revoke execute on function public.attachment_book(text) from public, anon;
grant execute on function public.attachment_book(text) to authenticated;

drop policy if exists "attachments: members read" on storage.objects;
create policy "attachments: members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper', 'accountant']::public.book_role[])
  );

drop policy if exists "attachments: writers add" on storage.objects;
create policy "attachments: writers add" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  );

-- Replacing a file of the same id: the upload asks to overwrite.
drop policy if exists "attachments: writers replace" on storage.objects;
create policy "attachments: writers replace" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  )
  with check (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  );

drop policy if exists "attachments: writers remove" on storage.objects;
create policy "attachments: writers remove" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
  );
