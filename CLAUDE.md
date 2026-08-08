# Daily Agenda — Planning Doc / CLAUDE.md

Planning document for Bri's personalized daily agenda web app — her top-priority app. Drop into a new repo as `CLAUDE.md`. Sibling to the dinner planner, law school tracker (live at /law-school-tracker/), sewing tracker, restock, and the hub.

## Who this is for

Bri — juggling law school, Law Review, a household, and a suite of trackers. She wants one place where each day is laid out: scheduled events, tasks to do sometime today, recurring background routines (Saturday medication, morning dishwasher), and a stream-of-consciousness way to capture things ("I have to go to the bank Wednesday") the moment they cross her mind.

## The jobs of this app

1. **Today, arranged** — a day view mixing timed events and untimed tasks, everything draggable.
2. **The week, triaged** — a week view plus a sidebar of "this week, no set day" tasks that get dragged onto days when they become real.
3. **Frictionless capture** — a Claude-powered chat that turns natural language into tasks and events, plus recurring templates that populate routines automatically.

## Tech stack — suite conventions, plus this app's two sanctioned additions

Base: same as all apps (see dinner-planner CLAUDE.md) — one file (`agenda.html`, `index.html` copy), vanilla JS, **shared Supabase project** (new table `agenda_data`), GitHub Pages + same Actions workflow, CSS-variable theming, Law School Command Center visual style, mobile-friendly. Suggested repo: `agenda`.

Sanctioned additions (this app only):

1. **Google Identity Services** (`accounts.google.com/gsi/client`) for Calendar read — reuse the law school app's Google Cloud OAuth project (add this app's origin). Silent token refresh so Bri consents rarely, not per-visit.
2. **One Supabase Edge Function (`assistant`)** proxying the Anthropic API for the chat. The API key lives in Supabase secrets, never in the client. The function verifies the caller's Supabase JWT (only Bri's account may call it). Setup steps for the builder to walk Bri through: create an Anthropic API key at console.anthropic.com → `supabase secrets set ANTHROPIC_API_KEY=...` → `supabase functions deploy assistant`. Use **Haiku** (cheap, fast) — task parsing doesn't need a big model.

## Design language (suite-wide rules)

- No emoji in UI chrome — inline Lucide-style SVG icons (`stroke="currentColor"`, pasted inline, no CDN).
- Status markers are CSS dots/chips; one logo glyph in the header only.
- Emoji allowed in user content. Warmth via accent colors, rounded cards, micro-copy.
- **Hover animations (Bri's request):** subtle and fast — cards lift slightly (translateY + shadow via CSS transition ~120ms), the checkbox circle fills on hover, drag handles fade in. Nothing bouncy or slow; animation should make the interface feel alive, not busy.

## Model escalation

If a task appears to exceed your ability — a fix has failed twice, architectural uncertainty, or a risky data-model change — say so explicitly and recommend rerunning on a more capable model (`/model fable`) instead of continuing to attempt it.

## Data model (Supabase: `agenda_data`, one row per user)

| column | contents |
|---|---|
| tasks | array of task objects |
| templates | array of recurring-template objects |
| completions | array of {template_id, date} — done-marks for template instances |
| settings | selected Google calendars, week start day, theme, `ghosted` (see below) |

### Task object (one-time items)

```js
{
  id: 1,
  title: "Go to the bank",
  date: "2026-07-15",       // null = lives in the weekly sidebar (this week, no day yet)
  week: "2026-W29",         // set when date is null, so sidebar tasks belong to a week
  time: null,               // "14:00" = appears on the hour grid; null = untimed "today" list
  duration_min: 30,         // used for grid block height when timed
  done: false,
  rolled_from: null,        // original date if auto-rolled ("from Tuesday" chip)
  source: "chat",           // 'manual' | 'chat' | 'template_exception' | 'suite' (future)
  notes: ""
}
```

### Template object (recurring background tasks)

```js
{
  id: 1,
  title: "Take medication",
  recurrence: {freq: "weekly", days: ["sat"]},   // or {freq:"daily"}, {freq:"monthly", day: 1}
  time: null,               // optional fixed time
  active: true
}
```

**Instances are virtual:** views materialize template occurrences for the visible date range on render — they are not stored as tasks. Completing an instance writes `{template_id, date}` to `completions`. Editing/moving a single instance creates a real task (`source: 'template_exception'`) for that date and suppresses the virtual one. Templates are managed in a simple settings list ("Routines").

### Rollover rule (decided)

At load, any **one-time task** with `date` in the past and `done: false` moves to today with `rolled_from` set (rendered as a subtle "from Tue" chip). Template instances never roll (they recur anyway) — missed ones just show as not-done in history. Google Calendar events never roll (they're facts, not intentions).

### Completion (decided)

Every task/instance/event row has a circle checkbox. Checking it **grays the item out** (reduced opacity + muted color; keep it visible and in place — seeing a grayed list is the day's trophy case). Done untimed tasks sink below not-done ones within the list. Unchecking restores.

## Views & layout (decided: hybrid day view)

1. **Day view (home):**
   - Top: **untimed "Today" list** — tasks to do sometime today, drag to reorder, drag onto the grid to give one a time.
   - Below: **hour grid** — Google Calendar events (read-only, visually distinct), timed tasks (draggable to retime), template instances with fixed times.
   - Header: date navigation + the headline line ("4 tasks · 2 events · bank day").
2. **Week view:** 7 columns of compact day cards (untimed list + timed items in order); drag tasks between days; tap a day to open day view.
3. **Weekly sidebar** (persistent on desktop, drawer on mobile): "This week" tasks with no day. **Drag onto a day column (assigns date) or onto a grid slot (assigns date + time)** — the signature interaction. Unfinished sidebar tasks at week's end roll to next week with a chip.
4. **Chat drawer:** slide-out panel, conversation UI (below).
5. **Routines settings:** template CRUD list.

Drag & drop: pointer-events–based (works for mouse and touch), with drop-target highlighting and the hover animation language above.

## The Claude chat (day-one feature, Bri's priority)

- Chat drawer with persistent lightweight history (session-scoped is fine; this is a capture tool, not a record).
- Each message goes to the `assistant` edge function → Haiku with a system prompt that extracts structured actions:

```json
{"actions": [{"type": "add_task", "title": "Go to the bank", "date": "2026-07-15", "time": null}],
 "reply": "Added: Go to the bank — Wednesday. Anything else?"}
```

- Supported actions v1: `add_task` (dated, sidebar-weekly, or undated), `add_timed_task`, `add_template` ("every Saturday I take my medication" → recurrence), `complete_task`, `move_task`. The app applies actions locally + syncs, and renders the confirmation reply in the chat. Ambiguity → the model asks a clarifying question rather than guessing ("This Wednesday or next?").
- The function receives today's date + the visible week's task titles as context so "move the bank thing to Friday" resolves.
- Also wire the same parser to a **quick-add input** at the top of the day view (single line → one action, no conversation) — chat for streams, quick-add for one-liners.

## Google Calendar (read-only in this app)

- GIS token client, `calendar.readonly`, silent refresh (`prompt: ''` after first consent) — Bri signs in rarely, not per visit.
- Settings: choose which calendars render (her Law School Schedule, Online Classes, Law Review, Bri, Appointments, Sloane, Bills — color-coded to match Google's or the suite palette).
- Events render on the grid, read-only and visually distinct (softer fill, no checkbox — though allow gray-out marking an event "done/attended" locally if trivial to add).
- **Do not write to Google Calendar from this app** (the law school app owns that pattern); revisit later if wanted.

### Ghosting an event (decided)

Right-click any imported Google event — hour-grid block, all-day bar, or week
chip — for a menu with "Ghost this event"; the event modal carries the same
toggle, which is the phone's path since there is no right-click there. A ghost
is local only: nothing is written to Google, and the event stays on the grid so
the day still reads correctly. It just fades, drops out of the headline's event
count, stops being a drag source, and — the case it exists for — renders
*before* the time entries so it sits **behind** them. A wide imported block (a
class, a work day) was covering the finer-grained time tracked inside it.

Stored as `settings.ghosted = {"<calendarId>|<eventId>": "<occurrence date>"}`.
Events are fetched with `singleEvents=true`, so each occurrence of a recurring
event has its own id and a ghost sticks to that one occurrence, not the series.
The keys are therefore unbounded; `pruneGhosts()` drops any whose stored date is
more than 60 days past. It runs in `afterLoad` as normalization — no `touch()`,
no save of its own.

## Suite sync (later phase — data model is ready via `source: 'suite'`)

Future: read shared tables and surface law school study blocks, Law Review checkpoint days, and restock radar items as background items. Design now, build later — the `source` field and read-only rendering style are the only hooks required today.

## Build phases

1. **Phase 1 — the agenda works:** auth, tasks CRUD, day view (hybrid), week view, weekly sidebar with drag-assignment, drag/reorder/retime, completion gray-out, rollover, templates + routines settings, hover animation language. **Then, same session: the chat** — edge function setup (walk Bri through API key + secrets + deploy), chat drawer, quick-add.
2. **Phase 2 — Google Calendar:** GIS silent-refresh read, calendar picker, grid rendering.
3. **Phase 3 — suite sync:** study blocks/LR checkpoints/restock items as `source:'suite'` background items; hub widget + registry entry (`/agenda/`, table `agenda_data`).
4. **Phase 4 — polish:** week-end sidebar rollover review ("3 things didn't happen this week — reassign?"), stats (completion streaks for routines), print view for the day.

## Open questions for Bri (non-blocking)

1. Week starts Sunday or Monday?
2. Should the chat also *answer* about the day ("what's my Wednesday look like?") — read actions, not just writes? (Cheap to add; slightly more prompt work.)
3. Time grid range — 6am–10pm default with expand, or full 24h?

## Dinner-planner monthly calendar import (planned)

The dinner planner now owns a dated meal calendar at `rules._calendar` in **its** `user_data` row (it is the authoring surface; this app imports snapshots from it, consistent with the existing "snapshot, not live-link" rule). Shape it publishes:

```js
{ '2026-07-28': {
    r:         {id:34, name:'Salmon Kebabs'},   // r = dinner
    breakfast: {id:70, name:'Luckiest Biscuits'},
    lunch:     {id:null, name:'Leftovers'},     // id null = one-off typed dish
    side:      {id:68, name:'Frizzled Chickpeas'},
    dessert:   {id:72, name:'Raspberry-Peach Crumble'}
} }
```

Keys are local ISO dates (`YYYY-MM-DD`), sparse. Values are `{id, name}` snapshots — `id` may be null.

Work to do here:

1. **`loadDinnerData()`**: also select `rules._calendar` (same owner read, no new permissions).
2. **`meal_type` on meals** — `'breakfast' | 'lunch' | 'dinner'`. **Absent means `'dinner'`**, so every existing meal and the pool sidebar keep working with no migration. Day strip groups/labels by type; dinner sorts last.
3. **`side`/`dessert` still flatten** into the dinner meal's `extras` string (`"Side: X · Dessert: Y"`) — they are not separate meals.
4. **"Import from dinner calendar"** alongside the existing saved-week import, over a date range. Dates map straight across — no weekday-name inference needed (unlike `importSavedMenu`).
5. **Replace semantics on import:** within the target range, delete meals where `source === 'dinner'`, then add fresh. Never touch meals the user typed by hand (`source !== 'dinner'`). This fixes the current duplicate-on-reimport behavior of `importSavedMenu`.

Full contract also recorded in the dinner planner's CLAUDE.md.

## Sync invariant (do not regress)

The local cache is a safety net for writes that never reached the server. It is
**not** a second source of truth, and which copy wins a load is a question about
time, not size.

This originally compared item counts — if the cache held more items than the
server, an earlier save was assumed lost, so the cache won and was pushed back
up. That destroyed data: a day-old cache legitimately outnumbers a server that
another device has since pruned, so the stale copy won the load and overwrote
the newer one. In the agenda app (2026-08-06) a laptop restored the previous day
and deleted tasks a phone had added that morning; the restored copy also
predated that day's check-offs, so rollover moved completed tasks back to today.

Rules to preserve:

- The cache stores `updated_at` (stamp of the write it holds) and `synced`
  (whether the server confirmed it). Never compare item counts.
- Prefer the cache only when the server is unreachable, or when it is unsynced
  **and** newer than the server's row.
- When the server is unreachable, do **not** push the cache up. Pushing blind is
  the step that overwrites the other device.
- Flush pending debounced saves on `pagehide` and on backgrounding — a phone is
  suspended the moment it is locked, often inside the debounce window.
- **Backgrounding must re-send over the network, not just settle the debounce.**
  Flushing only guaranteed the localStorage write; the upsert itself was an
  ordinary `fetch` that died with the frozen page, so a phone edit reached the
  cache and never the server. The leaving path posts directly to PostgREST with
  `keepalive: true`, which outlives the page. Bodies over ~60KB exceed the
  browser cap, so they decline and fall back to the unsynced-cache net rather
  than truncating.
- "A save is pending" means queued **or in the air**, not just queued. `_saveTimer`
  goes null the moment the request is issued, and a Realtime tick landing in
  that window replaced memory with the pre-save row; the next save then wrote
  that stale copy back up. Guard on `savePending()`.
- **Load-time normalization must not write to the server either.** The `_u` rule
  below is about the item stamp, but the *row's* `updated_at` is what actually
  decides a load — and `runRollover`/`ensureMonthlyRecurring`/dedupe used to call
  `saveToStorage()` from `afterLoad`. Merely opening the app republished the row
  with a fresh stamp, so a passive device outranked one holding real unsynced
  work. That is how a laptop destroyed a phone's edits on 2026-08-08 with no
  second edit made anywhere. These fixups now mutate memory only; they are
  recomputed every load, and the next genuine edit carries them up.

## Cross-device merge — where it stands

Resolution is still *wholesale* last-write-wins at the row level: if two devices
both edited during a network gap, one side's changes are lost entirely. The fix
is phased.

**Phase A — SHIPPED 2026-08-06, all three apps.** Metadata only: written
everywhere, read nowhere.

- `newId()` — clock-seeded plus a random tail, replacing `max(id)+1`. The old
  scheme only made ids unique *within one device's row*, so two devices offline
  at once minted the same id for different items. Numeric on purpose: ids are
  interpolated into inline handlers and are foreign keys across apps, so
  changing their type would be a coordinated multi-repo migration.
- `nextId` is **deleted**, not kept alongside. A minting site missed in a future
  edit is then a loud `ReferenceError` rather than silent sequential collisions.
  This caught a real self-shadowing bug in restock the day it shipped.
- `_u` — timestamp of the last user-initiated content change. **Never set by
  load-time normalization** (rollover, dedupe, migrations, backfills). If a
  plain reload restamped everything, the last device to open the app would win
  every future merge, which is the original data-loss bug in a new costume.
- `settings._tomb` — deletion tombstones. Absence is never a delete without one.
  Lives in `settings` because every app version round-trips that column
  untouched; a new column would come back NULL from an older build.
- `settings._sync = {v:2, w:deviceId, at:stamp}` — protocol marker. A future
  merge must refuse to merge any row whose `_sync.v` is missing or < 2. That
  gate is what makes mixed versions safe while one device runs older code.
- `settings.timerAt` (time-tracker's row) — stamped at every timer decision. The
  timer is a mutex, not a collection, and **must never be merged**: that stamp
  is the only way a stopped timer can beat a running one, since absence cannot
  win on recency by itself.

**Phase B — not started.** Write `mergeRow()` as a pure function, wire it to a
dry run that logs the diff it *would* have produced, and discard the result.

**Phase C — not started.** Turn merge on. The first phase that can lose or
resurrect data. Do not start it until both devices have been running Phase A for
a while — a device on the old build deletes without leaving a tombstone, and a
merge that trusted absence would resurrect what it deleted.

**Open gap found during Phase A:** agenda's `ensureMonthlyRecurring` creates
this month's copy of a monthly task when one is missing. Two devices both
offline at the start of a month each create their own with different ids, and
Phase C's merge would keep both → duplicate monthly tasks. Harmless today.
Needs a deterministic identity (id derived from `seriesId + month`), handled in
Phase B while merge is still a dry run.

**Still true after the 2026-08-08 fixes:** if the server genuinely receives a
newer write while a device holds unsynced work, that device still loses its work
silently on the next load. The fixes remove the ways that happened *without* a
real competing edit; they do not make concurrent edits safe. That is Phase B/C.

This sync block is copied between apps in the suite. Apps carrying it: agenda,
restock, time-tracker. Copy the corrected version, not an older sibling.
**The 2026-08-08 fixes have NOT been ported to restock or time-tracker yet** —
both still republish their row from load-time normalization.
