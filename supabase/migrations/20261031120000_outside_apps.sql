-- Outside apps: Claude, ChatGPT and the like, connected through NZOSA's
-- connector (the `mcp` edge function) with Supabase's OAuth server.
--
-- A token Supabase gives an outside app is a sign-in token for the person
-- who allowed it, and would otherwise reach everything the app can: invite
-- members, change settings, read the bank feed's keys, delete books. Such a
-- token carries the app's `client_id`; the app's own tokens never do. So:
--
-- - every request to the database through the API is refused when it comes
--   with one (`refuse_outside_apps`, PostgREST's pre-request hook), and
-- - membership is never granted to one (`is_member`, `has_role`), which also
--   covers storage and anything that asks those two.
--
-- The connector does not go through either: it checks the token with Auth,
-- checks membership itself, and reads and writes with the service key --
-- the books' parts to read, and the one part `suggested` to write.

alter type public.book_part add value if not exists 'suggested';

-- Whether this request came from an outside app. Never fails: a request it
-- cannot read is not one.
create or replace function public.from_outside_app()
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  claims text := current_setting('request.jwt.claims', true);
begin
  if claims is null or claims = '' then
    return false;
  end if;
  return coalesce(claims::jsonb ->> 'client_id', '') <> '';
exception when others then
  return false;
end;
$$;

grant execute on function public.from_outside_app() to anon, authenticated, service_role;

create or replace function public.refuse_outside_apps()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if public.from_outside_app() then
    raise exception using
      errcode = '42501',
      message = 'An app connected through the NZOSA connector can only use the connector.';
  end if;
end;
$$;

grant execute on function public.refuse_outside_apps() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.refuse_outside_apps';
notify pgrst, 'reload config';

-- As in 20261027090000_access_until.sql, and never for an outside app.
create or replace function public.is_member(book uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.from_outside_app() and exists (
    select 1 from public.book_members m
    where m.book_id = book and m.user_id = auth.uid()
      and (m.access_until is null or m.access_until >= current_date)
  );
$$;

create or replace function public.has_role(book uuid, roles public.book_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.from_outside_app() and exists (
    select 1 from public.book_members m
    where m.book_id = book
      and m.user_id = auth.uid()
      and (m.access_until is null or m.access_until >= current_date)
      and (
        m.role = any (roles)
        or (m.role::text = 'accountant' and 'bookkeeper' = any (roles::text[]))
        or (
          'owner' = any (roles::text[])
          and 'bookkeeper' = any (roles::text[])
          and 'accountant' = any (roles::text[])
        )
      )
  );
$$;

-- What an outside app suggests, added to the part `suggested` by the
-- connector only. New sets go in front of those held; a set already held (the
-- same suggestions sent again) is not added twice; the newest 200 are kept.
-- Under the row's lock, so two chats suggesting at once both land.
create or replace function public.suggested_add(p_book uuid, p_sets jsonb, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  held jsonb;
begin
  select data into held from public.book_parts
  where book_id = p_book and part = 'suggested'
  for update;

  if not found then
    insert into public.book_parts (book_id, part, version, data, updated_by)
    values (
      p_book, 'suggested', 1,
      jsonb_build_object('version', 1, 'sets', (
        select coalesce(jsonb_agg(s order by n), '[]'::jsonb)
        from (select s, n from jsonb_array_elements(p_sets) with ordinality as t(s, n) order by n limit 200) kept
      )),
      p_by
    )
    on conflict (book_id, part) do nothing;
    if not found then
      -- Somebody else's first set landed between the two: add to theirs.
      perform public.suggested_add(p_book, p_sets, p_by);
    end if;
    return;
  end if;

  update public.book_parts
  set data = jsonb_build_object('version', 1, 'sets', (
        select coalesce(jsonb_agg(s order by n), '[]'::jsonb)
        from (
          select s, n from (
            select s, n from jsonb_array_elements(p_sets) with ordinality as t(s, n)
            where not exists (
              select 1 from jsonb_array_elements(coalesce(held -> 'sets', '[]'::jsonb)) as h(v)
              where h.v ->> 'id' = t.s ->> 'id'
            )
            union all
            select s, 1000000 + n from jsonb_array_elements(coalesce(held -> 'sets', '[]'::jsonb)) with ordinality as u(s, n)
          ) everything
          order by n
          limit 200
        ) kept
      )),
      version = version + 1,
      updated_at = now(),
      updated_by = p_by
  where book_id = p_book and part = 'suggested';
end;
$$;

revoke execute on function public.suggested_add(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.suggested_add(uuid, jsonb, uuid) to service_role;
