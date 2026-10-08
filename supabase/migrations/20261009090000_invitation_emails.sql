-- Invitations by email.
--
-- An invitation used to wait silently on the invited person's Books page until
-- they happened to sign in. Now the invite function also emails them. Each
-- email sent is written down here, so one set of books cannot be used to send
-- mail to strangers without end: a few a day to one address, and a modest
-- number a day from one set of books in all.

create table if not exists public.invitation_emails (
  id bigint generated always as identity primary key,
  book_id uuid not null references public.books (id) on delete cascade,
  email text not null,
  sent_at timestamptz not null default now()
);

create index if not exists invitation_emails_recent
  on public.invitation_emails (book_id, sent_at);

alter table public.invitation_emails enable row level security;
-- Nobody reads this but the invite function, through the service role.
revoke all on public.invitation_emails from anon, authenticated;

/**
 * May an invitation email go to this address now, and if so record that it
 * did. For the invite function only: it has already checked that the caller
 * owns these books.
 *
 * Answers ok, or why not -- no invitation waiting for that address, the
 * address's daily limit, or the books' daily limit -- with the books' name
 * and the role, which the email needs.
 */
create or replace function public.invitation_email_take(book uuid, who text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  waiting public.book_invitations;
  books_name text;
  to_address integer;
  from_books integer;
begin
  select * into waiting from public.book_invitations
  where book_id = book and lower(email) = lower(trim(who)) and state = 'pending';
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no-invitation');
  end if;
  select name into books_name from public.books where id = book;

  select count(*) into to_address from public.invitation_emails
  where book_id = book and lower(email) = lower(trim(who)) and sent_at > now() - interval '1 day';
  if to_address >= 3 then
    return jsonb_build_object('ok', false, 'why', 'address-limit');
  end if;

  select count(*) into from_books from public.invitation_emails
  where book_id = book and sent_at > now() - interval '1 day';
  if from_books >= 20 then
    return jsonb_build_object('ok', false, 'why', 'books-limit');
  end if;

  insert into public.invitation_emails (book_id, email) values (book, trim(who));
  return jsonb_build_object('ok', true, 'books', books_name, 'role', waiting.role, 'email', waiting.email);
end;
$$;

revoke all on function public.invitation_email_take(uuid, text) from public, anon, authenticated;
grant execute on function public.invitation_email_take(uuid, text) to service_role;
