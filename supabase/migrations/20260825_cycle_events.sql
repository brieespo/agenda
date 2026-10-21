-- Cycle log — its own table, not a key in agenda_data.settings.
--
-- Two reasons it is not settings JSON:
--   1. Every writer of agenda_data has to participate in the row merge
--      (_sync.v, tombstones, the pagehide compare-and-swap). Real rows race
--      with nothing — an upsert on one day touches one day.
--   2. This is the most sensitive data in the suite. A separate table can be
--      granted, revoked, and audited on its own, and nothing here is ever
--      written to localStorage or handed to the assistant function.
--
-- One row per (day, kind). Apple Health allows several sexual-activity samples
-- in a day; this deliberately collapses that to a yes/no, which is the grain
-- the app asks for. The importer collapses on the way in.

create table if not exists public.cycle_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('flow', 'sex')),
  -- flow: 'spotting' | 'light' | 'medium' | 'heavy'
  -- sex:  'protected' | 'unprotected'
  -- Two values, no third for "not recorded". Protection is the exception worth
  -- a tap, so an entry that doesn't claim it is unprotected — including on
  -- import, where a Health sample carrying no protection metadata comes in as
  -- unprotected rather than as a separate unknown state.
  value      text not null,
  constraint cycle_events_value_valid check (
    (kind = 'flow' and value in ('spotting', 'light', 'medium', 'heavy')) or
    (kind = 'sex'  and value in ('protected', 'unprotected'))
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Makes the client's upsert(onConflict: 'user_id,date,kind') work, and enforces
-- the one-per-day grain at the database rather than in the UI.
create unique index if not exists cycle_events_user_date_kind
  on public.cycle_events (user_id, date, kind);

-- The history view reads a date range for one user, newest first.
create index if not exists cycle_events_user_date
  on public.cycle_events (user_id, date desc);

alter table public.cycle_events enable row level security;

-- Table privileges, stated rather than inherited. Until 2026-10-30 Supabase
-- granted these to every new table in `public` automatically, and these files
-- leaned on it: they enable RLS and write policies, but a policy is not a
-- grant. From that date a table created without one is unreachable through
-- PostgREST however correct its policies are — so this file, replayed on a
-- `db reset`, a preview branch or a new project, would rebuild a table every
-- app in the suite gets "permission denied" from, while reading as correct.
--
-- The live table already holds these and keeps them, and re-granting what is
-- already granted is a no-op, so this is safe to replay against the project
-- as it stands.
--
-- `anon` is deliberately not granted, though the migration guide's template
-- includes it. Every policy here is `to authenticated`, the app never touches
-- this table without a session (guest mode skips the server entirely), and a
-- grant that only takes effect if RLS is ever switched off is a grant worth
-- not having — least of all on the most sensitive table in the suite.
grant select, insert, update, delete on public.cycle_events to authenticated;
grant select, insert, update, delete on public.cycle_events to service_role;

-- New tables do not inherit policies from anywhere; without this the table is
-- unreachable through the anon key, and with a permissive policy it would be
-- readable by every signed-in account in the shared project. Scoped to the row
-- owner in both directions: `using` filters reads/updates/deletes, `with check`
-- stops an insert from claiming someone else's user_id.
drop policy if exists cycle_events_own_rows on public.cycle_events;
create policy cycle_events_own_rows
  on public.cycle_events
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at honest on re-logging the same day.
create or replace function public.touch_cycle_events()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cycle_events_touch on public.cycle_events;
create trigger cycle_events_touch
  before update on public.cycle_events
  for each row execute function public.touch_cycle_events();
