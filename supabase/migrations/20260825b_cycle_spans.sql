-- Named spans that explain a gap between periods: pregnancy, lactation.
--
-- A second table rather than more rows in cycle_events, because the shape is
-- different. cycle_events is one row per day; these are intervals, and the
-- lactation span alone runs three years — 1,100-odd daily rows to record one
-- fact with two dates in it.
--
-- Deliberately small in scope: these only change the *label* on a gap the
-- history already knew about. Nothing here participates in period detection,
-- and a cycle of ordinary length that happens to fall inside a lactation span
-- is still an ordinary cycle.

create table if not exists public.cycle_spans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('pregnancy', 'lactation')),
  start_date date not null,
  end_date   date,          -- null = still going
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cycle_spans_ordered check (end_date is null or end_date >= start_date)
);

-- Lets the importer re-run without stacking duplicates: one span of a kind per
-- start date is as fine a grain as this needs.
create unique index if not exists cycle_spans_user_kind_start
  on public.cycle_spans (user_id, kind, start_date);

alter table public.cycle_spans enable row level security;

drop policy if exists cycle_spans_own_rows on public.cycle_spans;
create policy cycle_spans_own_rows
  on public.cycle_spans
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists cycle_spans_touch on public.cycle_spans;
create trigger cycle_spans_touch
  before update on public.cycle_spans
  for each row execute function public.touch_cycle_events();
