-- Step-by-step routines — the makeup / self-care / cleaning walkthroughs.
--
-- Not to be confused with what the settings modal used to call "recurring
-- routines"; those are TEMPLATES and live in agenda_data. That label is now
-- "Recurring tasks" precisely so this word is free.
--
-- Its own table rather than settings JSON. Skincare lives in settings and that
-- has been fine, but a routine library is content she will edit for years, and
-- settings still rides a row merge that only the time-tracker implements.
--
-- Steps are JSONB rather than their own table on purpose: they are always read,
-- written and reordered as a whole ordered list, so splitting them into rows
-- would buy nothing and cost a sort key plus a multi-row write on every drag.

create table if not exists public.routines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  -- [{id:"s1", text:"Oil hair", minutes:10}] — minutes may be null
  steps      jsonb not null default '[]'::jsonb,
  position   int  not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists routines_user_pos
  on public.routines (user_id, position);

-- Per-day progress. Keyed by date rather than cleared at midnight: if the row
-- for today does not exist, the routine is fresh. Nothing has to run at
-- midnight, which means nothing breaks when the phone is asleep, the tab is
-- closed, or the clocks change.
create table if not exists public.routine_progress (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  date       date not null,
  -- step ids ticked on that date; order is irrelevant
  done_steps jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- One progress row per routine per day, which is also what makes the client's
-- upsert(onConflict:'user_id,routine_id,date') work.
create unique index if not exists routine_progress_user_routine_date
  on public.routine_progress (user_id, routine_id, date);

alter table public.routines enable row level security;
alter table public.routine_progress enable row level security;

drop policy if exists routines_own_rows on public.routines;
create policy routines_own_rows on public.routines
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists routine_progress_own_rows on public.routine_progress;
create policy routine_progress_own_rows on public.routine_progress
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists routines_touch on public.routines;
create trigger routines_touch before update on public.routines
  for each row execute function public.touch_cycle_events();

drop trigger if exists routine_progress_touch on public.routine_progress;
create trigger routine_progress_touch before update on public.routine_progress
  for each row execute function public.touch_cycle_events();
