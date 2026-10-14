-- Tell the owner when somebody signs up.
--
-- An insert on auth.users calls the signup-alert edge function through
-- pg_net, with the key the morning run uses (in the vault as 'nightly-key').
-- The call is queued and answered later, and anything that goes wrong in
-- making it is swallowed: an account is never refused, or slowed, because a
-- notification could not be sent.

create extension if not exists pg_net;

create or replace function public.tell_owner_of_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform net.http_post(
      url := 'https://ronancqtbbqmsiatxmfn.supabase.co/functions/v1/signup-alert',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-nightly-key', (select decrypted_secret from vault.decrypted_secrets where name = 'nightly-key')
      ),
      body := jsonb_build_object(
        'email', new.email,
        'name', coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
        'provider', coalesce(new.raw_app_meta_data->>'provider', 'email'),
        'total', (select count(*) from auth.users) + 0,
        'ceiling', 15
      ),
      timeout_milliseconds := 10000
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function public.tell_owner_of_signup() from public, anon, authenticated;

drop trigger if exists tell_owner_of_signup on auth.users;
create trigger tell_owner_of_signup
  after insert on auth.users
  for each row execute function public.tell_owner_of_signup();
