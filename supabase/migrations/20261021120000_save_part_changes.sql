-- Saving only what changed.
--
-- A save used to send a part of the books whole: the codings, the history,
-- the bank lines. A tick on the Reconcile page changes a few hundred bytes and
-- sent most of a megabyte. Now the page sends a short list of changes, and
-- the database applies it to the part it already holds. Parts are stored
-- exactly as before; only the sending is smaller.
--
-- 1. apply_part_ops: the changes, applied. The same rules as applyPartOps in
--    packages/core/src/part-changes.ts, which the tests hold it to.
-- 2. save_part_changes: one call for every part a change touched, applied
--    together or not at all, with the same checks as save_part.
-- 3. The history of what each save replaced keeps the change rather than a
--    whole copy, with a whole copy at most once a day for each part. Whole
--    copies on every save were three quarters of the database.
-- 4. prune_part_history: trims that history, keeping it rebuildable. For the
--    project's owner to run; nothing calls it.

-- ---------------------------------------------------------------------------
-- 1. Applying changes
-- ---------------------------------------------------------------------------

-- Changes, in order, each one of:
--   {"set": [key] | [key, key], "value": v}
--   {"del": [key] | [key, key]}
--   {"splice": [] | [key], "at": n, "remove": n, "insert": [...]}
create or replace function public.apply_part_ops(p_data jsonb, p_ops jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  op jsonb;
  result jsonb := coalesce(p_data, 'null'::jsonb);
  path text[];
  list jsonb;
  at_ int;
  remove_ int;
begin
  for op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    if op ? 'set' then
      path := array(select jsonb_array_elements_text(op -> 'set'));
      if jsonb_typeof(result) is distinct from 'object' then result := '{}'::jsonb; end if;
      if cardinality(path) = 2 and jsonb_typeof(result -> path[1]) is distinct from 'object' then
        result := jsonb_set(result, path[1:1], '{}'::jsonb, true);
      end if;
      if cardinality(path) not in (1, 2) then
        raise exception 'a change names one or two keys' using errcode = '22023';
      end if;
      result := jsonb_set(result, path, coalesce(op -> 'value', 'null'::jsonb), true);

    elsif op ? 'del' then
      path := array(select jsonb_array_elements_text(op -> 'del'));
      if jsonb_typeof(result) = 'object' then
        if cardinality(path) = 1 then
          result := result - path[1];
        elsif cardinality(path) = 2 and jsonb_typeof(result -> path[1]) = 'object' then
          result := jsonb_set(result, path[1:1], (result -> path[1]) - path[2]);
        end if;
      end if;

    elsif op ? 'splice' then
      path := array(select jsonb_array_elements_text(op -> 'splice'));
      at_ := greatest(coalesce((op ->> 'at')::int, 0), 0);
      remove_ := greatest(coalesce((op ->> 'remove')::int, 0), 0);
      if cardinality(path) = 0 then
        list := result;
      elsif cardinality(path) = 1 then
        if jsonb_typeof(result) is distinct from 'object' then result := '{}'::jsonb; end if;
        list := result -> path[1];
      else
        raise exception 'a list is the part, or under one key' using errcode = '22023';
      end if;
      if jsonb_typeof(list) is distinct from 'array' then list := '[]'::jsonb; end if;

      select coalesce(jsonb_agg(item order by bit, n), '[]'::jsonb) into list
      from (
        select 0 as bit, n, item from jsonb_array_elements(list) with ordinality as t(item, n) where n <= at_
        union all
        select 1, n, item from jsonb_array_elements(coalesce(op -> 'insert', '[]'::jsonb)) with ordinality as t(item, n)
        union all
        select 2, n, item from jsonb_array_elements(list) with ordinality as t(item, n) where n > at_ + remove_
      ) as pieces;

      if cardinality(path) = 0 then
        result := list;
      else
        result := jsonb_set(result, path, list, true);
      end if;

    else
      raise exception 'not a change: %', op using errcode = '22023';
    end if;
  end loop;
  return result;
end;
$$;

-- Not for calling from a page: save_part_changes calls it as its definer.
revoke all on function public.apply_part_ops(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. History that keeps the change
-- ---------------------------------------------------------------------------

alter table public.book_part_history alter column data drop not null;
alter table public.book_part_history add column if not exists ops jsonb;

-- A row is either what was replaced, or the change that replaced it, or both.
-- Version v's row: data is the part at v (when kept), ops took it to v + 1.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'book_part_history_data_or_ops'
  ) then
    alter table public.book_part_history
      add constraint book_part_history_data_or_ops check (data is not null or ops is not null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Saving changes
-- ---------------------------------------------------------------------------

-- p_changes: [{"part": "decisions", "version": 41, "ops": [...]},
--             {"part": "events", "version": 9, "data": [...]}, ...]
-- Each names the version it was built on, as save_part does; "data" is a part
-- sent whole, "ops" its changes. Returns the new version of each, in order.
create or replace function public.save_part_changes(p_book uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  change jsonb;
  the_part public.book_part;
  wanted bigint;
  current_version bigint;
  current_data jsonb;
  next_data jsonb;
  next_version bigint;
  keep_whole boolean;
  versions jsonb := '[]'::jsonb;
  as_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not as_service
     and not public.has_role(p_book, array['owner', 'bookkeeper']::public.book_role[]) then
    raise exception 'not allowed to write these books' using errcode = '42501';
  end if;

  if not public.book_live(p_book) then
    raise exception 'These books have been deleted. An owner can restore them from the Books page.'
      using errcode = 'PT410';
  end if;

  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'changes are a list' using errcode = '22023';
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    the_part := (change ->> 'part')::public.book_part;
    wanted := coalesce((change ->> 'version')::bigint, 0);

    select version, data into current_version, current_data
    from public.book_parts
    where book_id = p_book and part = the_part
    for update;

    if change ? 'ops' then
      -- Changes are made to something: a part not there yet is sent whole.
      if current_version is null then
        raise exception 'version % does not exist for %', wanted, the_part using errcode = 'PT409';
      end if;
      next_data := public.apply_part_ops(current_data, change -> 'ops');
    else
      next_data := change -> 'data';
      if next_data is null then
        raise exception 'nothing to save for %', the_part using errcode = '22023';
      end if;
    end if;

    if the_part = 'decisions'
       and not as_service
       and public.lock_dates_of(next_data) is distinct from public.lock_dates_of(current_data)
       and not public.has_role(p_book, array['owner', 'accountant']::public.book_role[]) then
      raise exception 'Only an owner or the accountant can change the lock dates.'
        using errcode = 'PT403';
    end if;

    if current_version is null then
      if wanted <> 0 then
        raise exception 'version % does not exist for %', wanted, the_part using errcode = 'PT409';
      end if;
      insert into public.book_parts (book_id, part, version, data, updated_by)
      values (p_book, the_part, 1, next_data, auth.uid());
      versions := versions || to_jsonb(1);
      continue;
    end if;

    if wanted is distinct from current_version then
      raise exception 'these books changed since you loaded them (% is now %)',
        the_part, current_version using errcode = 'PT409';
    end if;

    if change ? 'ops' then
      -- A whole copy now and then, so the changes since can be replayed on
      -- it: once a day, and whenever the save before this one was not a
      -- change (a whole save keeps what it replaced, not what it wrote, so
      -- without a copy here this version could not be rebuilt).
      keep_whole := not exists (
          select 1 from public.book_part_history
          where book_id = p_book and part = the_part and data is not null
            and replaced_at > now() - interval '1 day'
        )
        or not exists (
          select 1 from public.book_part_history
          where book_id = p_book and part = the_part and version = current_version - 1
            and ops is not null
        );
      insert into public.book_part_history (book_id, part, version, data, ops, replaced_by)
      values (
        p_book, the_part, current_version,
        case when keep_whole then current_data end,
        change -> 'ops', auth.uid()
      );
    else
      insert into public.book_part_history (book_id, part, version, data, replaced_by)
      values (p_book, the_part, current_version, current_data, auth.uid());
    end if;

    next_version := current_version + 1;
    update public.book_parts
    set version = next_version, data = next_data, updated_at = now(), updated_by = auth.uid()
    where book_id = p_book and part = the_part;
    versions := versions || to_jsonb(next_version);
  end loop;

  return versions;
end;
$$;

revoke all on function public.save_part_changes(uuid, jsonb) from public, anon;
grant execute on function public.save_part_changes(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Trimming the history
-- ---------------------------------------------------------------------------

-- Removes what each save replaced from before `p_keep` ago, keeping for each
-- part the last whole copy from before then, so every version since can still
-- be rebuilt from it. Returns how many rows went.
create or replace function public.prune_part_history(p_keep interval)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  gone bigint;
begin
  with keep_from as (
    select book_id, part, max(version) as version
    from public.book_part_history
    where data is not null and replaced_at < now() - p_keep
    group by book_id, part
  )
  delete from public.book_part_history h
  using keep_from k
  where h.book_id = k.book_id and h.part = k.part and h.version < k.version
    and h.replaced_at < now() - p_keep;
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function public.prune_part_history(interval) from public, anon, authenticated;
