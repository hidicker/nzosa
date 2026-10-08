-- Ready every morning, for books on the server.
--
-- The page's side is apps/web/src/nightly.ts; the run itself is the nightly
-- edge function, started by pg_cron (20261011090100_nightly_cron.sql). What it
-- finds -- the bank's new lines, waiting to come in, and suggested codes -- is
-- kept as a part of its own beside the books, never in them.

-- A value added to an enum cannot be used in the transaction that adds it, so
-- this runs on its own before the rest.
alter type public.book_part add value if not exists 'nightly';
