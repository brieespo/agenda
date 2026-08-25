-- Absences, one row per class per day missed.
--
-- Its own table for the reason cycle_events is: an absence is an append-only
-- dated event, one tap makes one row, and a real row races with nothing. Put in
-- agenda_data.settings it would ride the row merge that only the time-tracker
-- actually implements, and a semester's attendance record is the wrong thing to
-- lose to two devices writing at once.
--
-- course_id is text and carries no foreign key on purpose. Courses live in
-- law_school_data.courses, a JSON array owned by the law school tracker — there
-- is no courses table to point at, and that app is free to rewrite its own
-- array. A dropped course therefore leaves rows behind; the panel only renders
-- absences for courses it can still see, and keeps the rest rather than
-- deleting attendance history on a data shape it does not own.

create table if not exists public.class_absences (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  text not null,
  date       date not null,
  created_at timestamptz not null default now()
);

-- One absence per class per day: the log button is a toggle, and a double tap
-- on a slow connection must not book the same morning twice.
create unique index if not exists class_absences_user_course_date
  on public.class_absences (user_id, course_id, date);

create index if not exists class_absences_user_course
  on public.class_absences (user_id, course_id, date desc);

alter table public.class_absences enable row level security;

drop policy if exists class_absences_own_rows on public.class_absences;
create policy class_absences_own_rows
  on public.class_absences
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
