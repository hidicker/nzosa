-- Invitation emails: a limit per person, and a word to the site's owner.
--
-- The limits so far were per set of books (20 a day) and per address (3 a
-- day). Sets of books cost nothing to make, so one person with fifty of them
-- could send a thousand emails a day from NZOSA's mailbox, each carrying a
-- name they chose. Now one person may send at most 100 a day across all their
-- books, and when somebody passes 10 in a day the invite function tells the
-- site's owner, once that day, so a misuse is seen while it is happening.

alter table public.invitation_emails
  add column if not exists invited_by uuid references auth.users (id) on delete set null;

create index if not exists invitation_emails_by_person
  on public.invitation_emails (invited_by, sent_at);

drop function if exists public.invitation_email_take(uuid, text);

/**
 * May an invitation email go to this address now, and if so record that it
 * did. For the invite function only: it has already checked that the caller
 * owns these books, and says who the caller is.
 *
 * Answers ok, or why not -- no invitation waiting for that address, the
 * address's daily limit, the books' daily limit, or the person's -- with the
 * books' name and the role, which the email needs, and how many the person has
 * now sent today, so the function can raise the alarm on the eleventh.
 */
create or replace function public.invitation_email_take(book uuid, who text, inviter uuid)
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
  from_person integer;
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

  select count(*) into from_person from public.invitation_emails
  where invited_by = inviter and sent_at > now() - interval '1 day';
  if from_person >= 100 then
    return jsonb_build_object('ok', false, 'why', 'person-limit', 'sent_today', from_person);
  end if;

  insert into public.invitation_emails (book_id, email, invited_by) values (book, trim(who), inviter);
  return jsonb_build_object(
    'ok', true, 'books', books_name, 'role', waiting.role, 'email', waiting.email,
    'sent_today', from_person + 1
  );
end;
$$;

revoke all on function public.invitation_email_take(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.invitation_email_take(uuid, text, uuid) to service_role;
