-- The morning run reads two tables directly rather than through a function.
--
-- supabase/functions/nightly reads public.book_parts and public.books over the
-- Data API with the service role key. Nothing here ever granted the service
-- role those tables: it worked because Supabase granted it every new table in
-- "public" on its own. From 30 Oct 2026 it stops doing that, so a project built
-- from these migrations afterwards (a new project, a preview branch, a local
-- `supabase db reset`) would answer "permission denied" and every morning
-- would stop at the first set of books.
--
-- Reading only: everything the run writes goes through nightly_put() and the
-- other functions already granted to the service role. Already true on the live
-- project, so running this there changes nothing.

grant select on public.books, public.book_parts to service_role;
