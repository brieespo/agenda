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
| settings | selected Google calendars, week start day, theme |

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
