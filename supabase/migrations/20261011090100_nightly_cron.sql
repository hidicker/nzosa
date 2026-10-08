-- The morning, on the database's clock.
--
-- pg_cron starts the nightly edge function once a day; pg_net is how it
-- calls out. 17:30 UTC is 6:30am in a New Zealand summer and 5:30am in winter,
-- so "around six" either way. The key it sends is kept in the vault as
-- 'nightly-key' (and as the function's NIGHTLY_KEY secret), never in this
-- file: it is made when the function is first deployed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'nzosa-morning';

select cron.schedule(
  'nzosa-morning',
  '30 17 * * *',
  $$
  select net.http_post(
    url := 'https://ronancqtbbqmsiatxmfn.supabase.co/functions/v1/nightly',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-nightly-key', (select decrypted_secret from vault.decrypted_secrets where name = 'nightly-key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
