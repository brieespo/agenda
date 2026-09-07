-- Journal entries — one row per entry, not one document.
--
-- The "master document" she asked for is a *view* of these rows, not the
-- storage. Appending to a real document (a Google Doc, a file) means fetching
-- it, finding its end, and writing there: two calls that can each fail, no
-- offline story, and a merge problem the moment she edits it by hand. A journal
-- entry that silently did not save is the worst thing this feature could do, so
-- the write is one insert that either lands or visibly did not.
--
-- Its own table for the reasons cycle_events gives, and the second one applies
-- with full force here: this is the most personal text in the suite, and a
-- separate table can be granted, revoked and audited on its own.
--
-- `created_at` does the date-and-time stamping she asked for. `entry_date` is
-- separate and is the day the entry is *about* — writing tonight about
-- yesterday files it under yesterday, the same bargain the skincare panel and
-- the routine cards already make. Sorting a day's entries uses created_at, so
-- the order within a day is always the order she wrote them.

create table if not exists public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- The day it belongs to. Defaults to the day it was written, and only differs
  -- when she deliberately logs against another date.
  entry_date date not null,

  body       text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An empty entry is not an entry. Nothing else here is validated: a journal
  -- has no schema, and imposing one would be the feature disagreeing with what
  -- it is for.
  constraint journal_entries_body_present check (length(btrim(body)) > 0)
);

-- The day view reads one day; the journal tab reads a range, newest first.
create index if not exists journal_entries_user_date
  on public.journal_entries (user_id, entry_date desc, created_at desc);

alter table public.journal_entries enable row level security;

-- Without this the table is unreachable through the anon key, and with a
-- permissive policy it would be readable by every signed-in account in the
-- shared project. Scoped to the row owner in both directions.
drop policy if exists journal_entries_own_rows on public.journal_entries;
create policy journal_entries_own_rows
  on public.journal_entries
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_journal_entries()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists journal_entries_touch on public.journal_entries;
create trigger journal_entries_touch
  before update on public.journal_entries
  for each row execute function public.touch_journal_entries();
