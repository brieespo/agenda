# 📅 Agenda

Daily agenda app: a day view mixing timed events and untimed tasks, a week view, and a weekly sidebar for "this week, no day yet" tasks that get dragged onto days when they become real. Sibling app to [dinner-planner](https://github.com/brieespo/dinner-planner), [law-school-tracker](https://github.com/brieespo/law-school-tracker), [restock](https://github.com/brieespo/restock), [perfume-tracker](https://github.com/brieespo/perfume-tracker), and [sewing-tracker](https://github.com/brieespo/sewing-tracker): pure HTML + CSS + vanilla JS in a single file, Supabase for auth + sync, GitHub Pages for hosting.

**Live at:** https://brieespo.github.io/agenda

## Files

- `agenda.html` — the entire app (source of truth)
- `index.html` — always an exact copy of `agenda.html`. After every change: `cp agenda.html index.html`, then push.
- `.github/workflows/deploy.yml` — GitHub Pages deploy on every push to `main`

## Supabase setup

Reuses the shared Supabase project (same URL and publishable key as the sibling apps, so one account works everywhere) with its own table, `agenda_data`. Run once in the SQL editor:

```sql
create table if not exists agenda_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb,
  templates jsonb not null default '[]'::jsonb,
  completions jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table agenda_data enable row level security;

create policy "Users manage own agenda data" on agenda_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

One row per user; tasks/templates/completions/settings each sync as a jsonb blob. Guest mode works without an account and stores data in localStorage only. Signed-in saves write a local cache on every attempt (same sync-safety-net pattern as the other apps): a failed save shows a sticky banner and retries with backoff, and on load a richer local cache wins over a leaner or unreachable remote copy.

## Data model

See `CLAUDE.md` for the full plan. Summary: a **task** is a one-time item (`date` null means it lives in the weekly sidebar, tagged with a `week` key instead); a **template** is a recurring routine (daily/weekly-on-days/monthly-on-day) whose occurrences are materialized virtually at render time rather than stored — completing one just writes to `completions`, editing/moving one creates a real `template_exception` task for that date. Week keys are the week's start date under the current week-start setting (Sun or Mon), not ISO week numbers — simpler and stays consistent with what the week view actually displays.

## Drag & drop

Pointer-events based (not native HTML5 drag/drop), so it works with both mouse and touch. A single pointerdown→move→up cycle on a draggable row does double duty: past a small movement threshold it's a drag (today-list reorder/retime, sidebar → day/grid assignment, week-view day-to-day moves); below the threshold, releasing counts as a tap and opens the edit modal instead.

## Build phases

1. **Phase 1 (in progress):** auth, tasks CRUD, day view (untimed list + hour grid), week view, weekly sidebar with drag-assignment, completion gray-out, rollover, recurring templates + routines settings. Then: the Claude chat (edge function + chat drawer + quick-add).
2. **Phase 2:** Google Calendar (GIS silent-refresh read, calendar picker, grid rendering).
3. **Phase 3:** suite sync — study blocks/LR checkpoints/restock items as `source:'suite'` background items; hub widget.
4. **Phase 4:** polish — week-end sidebar rollover review, completion-streak stats, print view.
