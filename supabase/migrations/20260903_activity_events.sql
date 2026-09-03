-- Activity log — workouts, one row per logged exercise.
--
-- A table rather than a key in agenda_data.settings, for the first of the two
-- reasons cycle_events gives: every writer of agenda_data has to participate in
-- the row merge (_sync.v, tombstones, the pagehide compare-and-swap), and real
-- rows race with nothing. The second reason does not apply — this is not
-- sensitive the way the cycle log is, and it is deliberately *not* granted the
-- same isolation, because a workout summary is meant to be glanceable.
--
-- The size argument matters more here than for skincare. That log survives in
-- settings JSON only because it compresses to four characters per product per
-- day; one lifting entry is a name, three numbers and a date, and a real year of
-- training is thousands of them. It would not fit the ~60KB the keepalive save
-- can carry out of a backgrounded phone.
--
-- The *catalog* of exercises stays in settings.activity.exercises, next to the
-- skincare products it is modelled on: a short, ordered, rarely-edited list.
-- Rows point at it by key. Splitting it this way is the same split the app
-- already makes between a skincare product and the day it was used.

create table if not exists public.activity_events (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  date     date not null,

  -- The 4-char key from settings.activity.exercises. Not a foreign key: the
  -- catalog lives in a JSON column, so nothing here can reference it.
  exercise_key text not null,

  -- The label as it read when logged, denormalized on purpose. Skincare can get
  -- away with "a key no product claims is skipped on render" because a missing
  -- dot is a rounding error; a workout history with unlabelled rows in it is
  -- just broken. Renaming an exercise leaves old rows reading the old name,
  -- which is the honest answer to what she actually did that day.
  name     text not null,

  -- Decides which columns are meaningful, and which form the app draws. Carried
  -- on the row rather than looked up from the catalog so that changing an
  -- exercise's kind later cannot retroactively reinterpret old numbers.
  kind     text not null check (kind in ('lift', 'cardio')),

  weight   numeric(6,1),   -- lift: load per set, in the unit below
  reps     integer,        -- lift: reps per set
  sets     integer,        -- lift: number of sets
  unit     text check (unit in ('lb', 'kg')),

  minutes  numeric(6,1),   -- cardio: duration
  distance numeric(6,2),   -- cardio: distance, in the unit below
  dist_unit text check (dist_unit in ('mi', 'km')),

  note     text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Every field is individually optional — a set logged without its weight is
  -- still worth having, and demanding all three would make the fast path slow.
  -- What is enforced is that a row never carries numbers from the other
  -- template, so a kind flip in the UI can never leave a lift row with a
  -- distance on it.
  constraint activity_events_lift_shape check (
    kind <> 'lift' or (minutes is null and distance is null and dist_unit is null)
  ),
  constraint activity_events_cardio_shape check (
    kind <> 'cardio' or (weight is null and reps is null and sets is null and unit is null)
  ),
  -- Counts are counts. A zero-rep set is a row that says nothing, and a negative
  -- one is a typo that would poison any future total.
  constraint activity_events_positive check (
    (weight   is null or weight   >= 0) and
    (reps     is null or reps     >  0) and
    (sets     is null or sets     >  0) and
    (minutes  is null or minutes  >  0) and
    (distance is null or distance >  0)
  )
);

-- The day view reads one day; the history reads a range newest-first. Both are
-- this index. Deliberately not unique: logging bench twice in a session — once
-- heavy, once as a burnout set — is a real thing, not a conflict, so rows are
-- inserted and deleted by id rather than upserted by day.
create index if not exists activity_events_user_date
  on public.activity_events (user_id, date desc);

alter table public.activity_events enable row level security;

-- New tables do not inherit policies from anywhere; without this the table is
-- unreachable through the anon key, and with a permissive policy it would be
-- readable by every signed-in account in the shared project. Scoped to the row
-- owner in both directions: `using` filters reads/updates/deletes, `with check`
-- stops an insert from claiming someone else's user_id.
drop policy if exists activity_events_own_rows on public.activity_events;
create policy activity_events_own_rows
  on public.activity_events
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_activity_events()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activity_events_touch on public.activity_events;
create trigger activity_events_touch
  before update on public.activity_events
  for each row execute function public.touch_activity_events();
