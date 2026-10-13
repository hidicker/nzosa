-- A ceiling on how many people may have an account on the hosted NZOSA.
--
-- The home page says online accounts are limited to 10 at this stage. The
-- ceiling enforced here is 15, which leaves room for the owner's own
-- accounts. A sign-up that would pass it is refused; people already signed up
-- are not affected, and raising the ceiling is a change of the number below.

create or replace function public.limit_accounts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from auth.users) >= 15 then
    raise exception 'Online accounts are limited at this stage. Please contact nzosa@proton.me.'
      using errcode = 'PT429';
  end if;
  return new;
end;
$$;

revoke all on function public.limit_accounts() from public, anon, authenticated;

drop trigger if exists limit_accounts on auth.users;
create trigger limit_accounts
  before insert on auth.users
  for each row execute function public.limit_accounts();
