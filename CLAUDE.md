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
- Status markers are CSS dots/chips.
- **The header greets rather than labels** (changed 2026-08-24). The calendar
  glyph and the word "Agenda" are gone; the slot now reads "Good morning, Bri" —
  16px, weight 450, `--ink-2`, deliberately quieter than it was, so the day's
  date in the toolbar is the one large thing on screen. Morning before noon,
  afternoon until 5pm, evening after, off the wall clock rather than
  `currentDate` (paging to next Tuesday must not change the time of day).
  The name comes from `settings.displayName`, set under **Routines & settings →
  Your name** — blank is a supported state and renders a bare "Good morning",
  so the app has no hardcoded user. It lives in `settings`, not a new column,
  for the `_tomb` reason: older builds round-trip that column untouched.
- Emoji allowed in user content. Warmth via accent colors, rounded cards, micro-copy.
- **Optional serif typeface (2026-08-24)** — *Routines & settings → Typeface*,
  `settings.font` = `sans` (default) | `serif`. Deliberately **separate from the
  colour theme**, not a third theme value: they are orthogonal, and folding them
  together would turn two settings into four themes and forbid warm-plus-serif.
  Same pre-paint `localStorage` trick as the colour theme so a serif page never
  flashes sans.

  Century Schoolbook is the target — the face her briefs are set in — and is
  named first so a machine that actually has it uses the real thing. **After
  that the stack is ordered by what preserves the type scale, not by what looks
  closest in a specimen.** `ui-serif` comes second because on her devices it
  resolves to New York, which is variable-weight; every other system serif
  (Georgia, Charter, Iowan, Cambria) ships Regular and Bold only, which would
  collapse this app's four weight steps — 450/500/600/650 — into two and throw
  away half the hierarchy. Those follow as fallbacks, accepting the collapse.

  The scale steps up **at the small end only** (micro 10→11, xs 11→12, sm 12→13,
  base 13→13.5, md 14→14.5). Serif detail is what goes first at 10 and 11px,
  while 22 and 24px read fine unchanged — and bumping those would have reflowed
  the day toolbar, which is sized around the date. Line-height opens 1.45→1.5,
  the big date's −0.015em tracking goes to 0 (tightening a serif closes its
  counters), and uppercase micro-labels widen 0.04→0.06em.

  **Lining figures are stated outright, not themed.** Georgia's default numerals
  are old-style — varying heights, some below the baseline — which in an hour
  grid reads as broken. `lining-nums` is a no-op for system-ui, so it costs the
  sans theme nothing. Note this could *not* be a variable: `font-variant-numeric:
  normal tabular-nums` is invalid and would have silently killed tabular figures
  in the sans theme.
- **Hover animations (Bri's request):** subtle and fast — cards lift slightly (translateY + shadow via CSS transition ~120ms), the checkbox circle fills on hover, drag handles fade in. Nothing bouncy or slow; animation should make the interface feel alive, not busy.

## Model escalation

If a task appears to exceed your ability — a fix has failed twice, architectural uncertainty, or a risky data-model change — say so explicitly and recommend rerunning on a more capable model (`/model fable`) instead of continuing to attempt it.

## Data model (Supabase: `agenda_data`, one row per user)

| column | contents |
|---|---|
| tasks | array of task objects |
| templates | array of recurring-template objects |
| completions | array of {template_id, date} — done-marks for template instances |
| settings | selected Google calendars, week start day, theme, `displayName`, `ghosted`, `skincare` (see below) |

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
  recurrence: {freq: "weekly", days: ["sat"]},   // or {freq:"daily"}
                                                // monthly by date:    {freq:"monthly", day: 1}
                                                // monthly by weekday: {freq:"monthly", nth: 2, dow: "fri"}
                                                //   nth 1-4, or -1 for "last". A template with `dow`
                                                //   ignores `day` — the presence of dow is the mode.
  time: null,               // optional fixed time
  active: true
}
```

**Instances are virtual:** views materialize template occurrences for the visible date range on render — they are not stored as tasks. Completing an instance writes `{template_id, date}` to `completions`. Editing/moving a single instance creates a real task (`source: 'template_exception'`) for that date and suppresses the virtual one. Templates are managed in a simple settings list ("Routines").

### Rollover rule (decided)

At load, any **one-time task** with `date` in the past and `done: false` moves to today with `rolled_from` set (rendered as a subtle "from Tue" chip). Google Calendar events never roll (they're facts, not intentions).

Template instances originally never rolled either. They now follow a **per-routine rule** — see below.

### A missed routine: `tpl.miss` (2026-08-24)

Set per routine in its editor, because the right answer genuinely varies and only she knows which is which. `'drop'` is the default and is exactly the old behaviour.

| value | what happens |
|---|---|
| `drop` | the missed day is gone. Most routines. |
| `next` | it stays on **today** until ticked. |
| `week` | it also appears in that week's list. |

**Carrying is a rendering rule, not a migration.** Instances are already virtual, so nothing is written, nothing needs cleaning up, and ticking the original late makes the carried copy vanish on its own. A carried item keeps its **original date** — `toggleDoneVirtual` is handed that date, so the tick lands on the day the routine was actually for, and one completion record clears it everywhere it appears.

Decisions that are load-bearing:

- **One row, never two.** If the routine comes round again today, today's occurrence supersedes the missed one (`templateOccursOn(tpl, today)` → don't carry). This is also what stops a *daily* routine carrying forward into a duplicate of itself every morning — the case that would otherwise make `next` useless.
- **`week` keeps every slipped day of that week, not just the latest.** The rule exists so a missed day is still owed somewhere; collapsing them would quietly forgive the earlier ones. `next` collapses, `week` does not — they answer different questions.
- **A settled occurrence stops the search.** In `outstandingOccurrence`, both a completion and an *exception* return null rather than skipping further back. An exception means that occurrence became a real task, which does its own rolling over; skipping past it would resurrect an older miss the current one had already superseded.
- **Carried items lose their clock time.** They go in the untimed list, never back onto the hour grid — that hour has gone.
- **`miss_since`** is stamped when a rule is first set to something other than `drop`, backdated to the start of that week. Turning the rule on must not dredge up months of "misses" from before she asked for any, but it should still catch the Tuesday she is thinking of when she sets it.
- **Carried items are not draggable out of the weekly list.** Dragging assigns a date to an undated task, and this one already has one — the day it slipped from. Tapping opens it, which is the path to making it a real, movable task.

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

## Skincare tracker (decided)

A tracker that must never read as an obligation. It is **one quiet line** under
the meal strip — a droplet, the word "Skincare", and a dot per product actually
used (`AM ●● PM ●`) — that expands in place into tappable chips. Not a card, not
a modal, and the expanded state is deliberately **not persisted**: every load
starts collapsed, so a skipped week is invisible rather than accusing. A settings
toggle (`skincare.show`) hides the line outright without touching the data.

Only what she *did* gets a dot. The first version drew an empty circle for every
skipped step, which turned the line into exactly the row of unchecked boxes the
feature exists not to be — a light day has to look calm, not deficient. Same
reason there is no "3/8" anywhere: a denominator announces failure.

Morning and evening are separate, and each product is `am`, `pm`, or `both`. It
costs no extra taps (a product only appears in the slot it belongs to) and keeps
the signal a chart will need — a retinol is a PM fact, an SPF an AM one.

**Logging yesterday is a first-class path**, not a workaround. On today the panel
carries a `Today | Yesterday` switch, because "did I actually do it last night?"
is the question this gets asked. Any other date in the day view logs to that
date, stated plainly in the panel head.

```js
settings.skincare = {
  products: [{id, k, name, when: 'am'|'pm'|'both', sample, active, _u}],
  log: {"2026-08": {"8": "ab1xcd2y|ef3z"}},
  show: true
}
```

**Why keys, not ids.** Each product carries a 4-char base36 `k` beside its
`newId()`, and the log is written in keys. Month bucket → day-of-month → AM keys,
`|`, PM keys, four chars each, no separators. This is about size, not cleverness:
the row has to fit the ~60KB the keepalive save can carry out of a backgrounded
phone, and logging eight products a day in 16-digit ids costs ~70KB a year on its
own. In keys the same year measures **13.8KB**. Keys are *drawn* from a 1.7M
space, never `max+1` — the Phase A rule about two offline devices. A day emptied
of all entries deletes its key, and an emptied month deletes its bucket.

The one structural assumption is fixed-width chunking, so `getSkincare()`
backfills a key for any product missing one: a keyless product would write the
literal `"undefined"` and, at nine characters, desync every key after it in that
day. It passes the product array in explicitly — going through `newSkinKey()`'s
default would call back into `skinProducts()` → `getSkincare()` on a product
whose key is still unset and recurse until the stack gave out.

**One-offs and samples.** A one-off typed into a slot becomes a real product
flagged `sample: true` — so a sample she liked is already chartable and can be
promoted to a regular step without retyping — but a sample (or a retired product)
only appears on days it was actually used, so trying something once doesn't leave
a chip on the row forever. Anything already logged stays visible regardless of
its `when`, or an entry logged into the wrong slot could never be undone.

**Retire vs delete.** Retiring (`active: false`) is the move for a finished
bottle: off the daily line, history intact. Delete tombstones the product but
deliberately leaves the log alone — an unclaimed key is skipped on render, and a
chart can still count the days it was used. Nothing silently rewrites history.

Nothing in the load or render path saves: `getSkincare()` normalizes in memory
only, per the load-time republishing rule below.

**Not built yet (the data is shaped for it):** the month calendar heatmap and
per-product usage-by-month. Both read straight out of `log` — the month buckets
are already the natural grain for "is my usage of X up from last month".
A Phase B merge should **union** a day's key sets rather than take one side:
logging is additive, and only an un-log is a genuine conflict. `_u` is currently
stamped at the feature root (`skincare._u`), which is too coarse for that — the
log is a nested map, not a list of items carrying their own stamps.

## Routines (built 2026-08-31)

Step-by-step walkthroughs for makeup, self-care and cleaning — the things she
wants to do without deciding anything. Its own tab.

**The word was taken.** What settings called "recurring routines" are TEMPLATES;
they are now labelled **"Recurring tasks"** throughout the UI (the modal is just
"Settings" now) so this feature can have the word she actually uses. Labels only
— no data moved and the code still says TEMPLATES.

`routines(id, user_id, name, steps jsonb, position, archived)` plus
`routine_progress(user_id, routine_id, date, done_steps jsonb)`. Its own tables,
not settings JSON: skincare lives in settings and that has been fine, but a
routine library is content she will edit for years, and settings still rides a
row merge only the time-tracker implements. **Steps are JSONB rather than rows**
because they are always read, written and reordered as one ordered list —
separate rows would buy nothing and cost a sort key plus a multi-row write on
every drag.

**"Resets at midnight" without a midnight.** Progress is keyed by date; no row
for today means the routine is fresh. Nothing runs on a timer, so nothing breaks
when the phone is asleep, the tab is closed, or the clocks change.
`loadRoutineProgress()` re-reads when `_rtProgressDate` is no longer today,
which is what makes it true for a tab left open overnight.

**Reading it and running it are the same surface.** The card lists steps with
checkboxes; **Start** enters focus mode — one step, large, with Done / skip /
close, and a dot per step. Focus mode **resumes at the first unticked step**
rather than restarting a half-finished routine. Edit is a mode on top (the
absence panel's pattern), so the resting state stays a clean list rather than a
form, and the drag handles only exist in edit mode: a drag target on a row whose
job is to be tapped would make ticking feel unreliable.

**Times are labels that add up**, never a countdown. The total carries a `+`
when some steps are untimed (`7m+`) — the sum is a floor, and printing a bare
number would overstate how well it is known.

**`@` attaches, it does not just mention.** Picking from the menu writes the
routine's *name* into the title as ordinary words and stores `routine_id` on the
task, so the title stays readable everywhere else and the link survives a
rename. The task row grows a chip that opens the routine.

**Completing every step ticks the attached task**, because finishing the routine
is what finishing that task means. Unticking a step deliberately does **not**
untick the task: she may have said "done" and moved on, and pulling a completed
task back open under her is worse than a stale tick.

Deleting a routine **archives** it. Its progress rows reference it, and a year
of "did I actually do this" is worth more than a tidy table. `routineChipHtml()`
renders nothing for a routine it cannot find, so an archived one goes quiet
rather than lying.

**Not built:** per-step countdown timers. Would need answers for a locked phone,
a backgrounded tab, and collision with the time-tracker's running timer. Worth
revisiting only if the labels turn out not to be enough.

## Calendar: day / week / month (reworked 2026-08-31)

The tab bar is **Calendar · Assignments · Time**. A period is not a sibling of
Assignments and Time, and four tabs made it look like one. Which period Calendar
shows is chosen from **the date itself** — it is already the largest thing in
the toolbar and reads as the subject of the page, so it carries the choice and
no permanent segmented control has to sit there all day saying nothing. The tab
returns to the last period used (`settings.calendarPeriod`), so a trip to
Assignments and back does not silently reset her to Day.

`pickPeriod()` carries the date across, because week keeps its own `weekAnchor`:
without it, Day→Week from some date in October lands on whatever week was last
looked at. The period changes; the day being looked at should not.

**The week view was rebuilt, not relocated.** Her two complaints were that it
had no sense of time within a day and that everything looked alike — both the
same fault. It was seven stacks of same-sized chips sorted untimed-first, which
said how *many* things a day held and nothing about when. It is now a time grid
on one hour range shared across all seven columns, so a column's height means
the same thing in every column, which is the entire point of putting them side
by side. A packed Tuesday and an empty Wednesday now look different from across
the room.

Week blocks **deliberately drop the time text** the day view's blocks carry: in
a time grid the position *is* the time, and a 90px-wide column spends that width
far better on the title. Untimed work gets an all-day strip above the axis
rather than being dropped at an arbitrary hour — the one thing that would make
the grid lie. Hour cells carry `data-date` + `data-time` and reuse
`onSlotClick`, so tapping empty space opens the new-task modal already dated and
timed.

**Month is shape, not contents** (her choice): a dot per item, no titles, six
per day before it becomes a `+n` — past six a row of dots stops reading as a
quantity and starts reading as texture. It answers "which weeks are heavy" and
hands off to the day view for anything more.

The old `weekChipHtml` / `weekGcalChipHtml` and the `.week-grid` / `.week-col` /
`.week-chip` CSS are gone with the old view.

## Leave by (built 2026-08-27)

A departure time beside the weather, sized and coloured to match it exactly —
same 12px, same muted grey, same tabular figures. It is the same kind of fact
about the day, and anything heavier would turn a quiet reminder into a demand.
Only the time is bolded; the label is dimmer again. The icon is a door with an
arrow through it, not a bare arrow, which in a toolbar reads as a direction
control.

One list in `settings.departures`, no table:

```js
{id, time:"07:40", label:"Civ Pro",
 recurrence:{freq:'weekly', days:['mon','wed','fri']} | {freq:'daily'} | null,
 date:"2026-08-27" | null,     // set instead, for a one-off
 skips:["2026-09-01"]}         // days a recurring one was dismissed
```

`date` set means one-off, `recurrence` set means it repeats — the same split the
app already makes between `TASKS` and `TEMPLATES`, but in **one** array, because
a departure has no completion state and there is nothing for a second list to
carry. Recurrence goes through `templateOccursOn()` rather than a second copy of
the same weekday arithmetic.

**Hiding a passed departure only applies to today.** "Passed" is meaningless on
next Tuesday, so every other date shows its earliest departure and never hides —
paging forward always shows the full picture. That asymmetry is why
`leaveChipState()` returns a state rather than a departure.

**The ghost doorway exists so the panel stays reachable, and it renders in
every empty case** — 35% opacity, brightening on hover. The chip is the only way
into the panel (the submodal manages recurring departures only), so any state
that draws nothing also makes a one-off unaddable.

This shipped wrong on 2026-08-27 and was fixed the same day. The first build had
a third state, `none`, that drew nothing at all on a day with no departures —
which looked clean in the mockup and meant that on a blank day there was
nowhere to click. The planning notes had even flagged "if the chip hides there
is no way to open the panel", and the fix went in for the *passed* case only.
There is now no state that renders no chip: `leaveChipState()` returns `show` or
`ghost`, never nothing.

**The chip and the panel both `stopPropagation`, and they must.** The
outside-click listener shipped broken on 2026-08-27: opening the panel
re-renders the wrapper, which detaches the button that was clicked, so by the
time the click bubbled to `document`, `e.target.closest('#leave-wrap')` was null
— not because the click was outside, but because the target no longer had a
parent — and the panel closed in the same tick it opened. It affected *every*
chip state, so the panel had never opened at all. The listener now bails on
`!e.target.isConnected` as well, which says the real condition outright.

Worth noting how it survived review: the unit tests exercise `leaveChipState()`
and the data, never a DOM event, and the preview set `_leaveOpen = true`
directly rather than clicking. Both were green on a feature whose main control
did nothing. **Click it in a browser before shipping an interactive control.**

**Amber in the last 20 minutes**, consistent with the absence counter. It needs
a once-a-minute `setInterval` — the only clock-driven render in the app. It
touches one element and only when the day view is showing today, so it cannot
land in the middle of anything she is typing.

**The × in the day panel skips, it does not delete.** On a one-off it deletes; on
a recurring one it adds today to `skips`. Removing every future Monday from a
panel opened to check this morning would be a nasty surprise with no undo, so
permanent edits live in the submodal where they are labelled as such. Past rows
in the panel dim rather than vanish — it was opened deliberately, and a row
disappearing out of a list being looked at is worse than a faded one.

A new recurring departure starts with **no days ticked**, so it appears nowhere
until she says where. Defaulting to weekdays would have put a departure on days
she never chose.

## Cycle log (built 2026-08-25)

Bleeding days and sexual activity, logged in one place instead of Apple Health.
No predictions — hers aren't regular enough for one to be worth anything, and
HealthKit doesn't expose Apple's forecast anyway, only the samples. What she
actually wanted from the Health UI was the **history**: recent periods, their
dates, and the days between them.

**Its own table, `cycle_events` — not a key in `settings`.** Two reasons, and
the second is the one that mattered:

1. Every writer of `agenda_data` has to participate in the row merge (`_sync.v`,
   tombstones, the pagehide compare-and-swap). Real rows race with nothing: one
   upsert touches one `(day, kind)`. This feature is the first in the suite that
   needed none of that machinery, and it got none.
2. It is the most sensitive data here. A separate table can be granted, revoked,
   and audited on its own.

```sql
cycle_events(id, user_id, date, kind, value, created_at, updated_at)
  kind  'flow' | 'sex'
  value flow: 'spotting'|'light'|'medium'|'heavy'
        sex:  'protected'|'unprotected'
  unique (user_id, date, kind)   -- the grain, enforced by the DB not the UI
```

One row per day per kind. Health allows several sexual-activity samples in a
day; this collapses to yes/no deliberately, and the importer collapses on the
way in (strongest value wins, so a heavy morning isn't erased by a light entry
made that night).

**Unprotected is the default, and there is no third "not recorded" value** (her
call, 2026-08-25). Protection is the exception worth a tap, so an entry that
doesn't claim it is unprotected — including on import, where a Health sample
carrying no protection metadata comes in as unprotected rather than as a
separate unknown state. `Unprotected` is also the first chip in the row. The
first build had an `'unspecified'` value for watch-logged samples with no
metadata; she doesn't wear the watch, and the honest-uncertainty argument for it
lost to not wanting a third state.

**The day-view Health line (added 2026-08-25).** Settings turned out to be too
far to reach for something logged daily, so there is now a line under Skincare —
same markup, same stylesheet, shared on purpose so "matches the skincare one"
stays true as either changes. It opens in place to the same two chip rows and
links out to the calendar. `settings.health.show` hides it.

This is the one place the original "never renders outside its own modal" rule
gave way, so it gives way as narrowly as possible: **collapsed, the line shows
the word Health and nothing else** — no dots, where the skincare line reports
its own at rest. `_healthOpen` is never persisted, so every load starts closed.
The load is lazy for the same reason and not just for speed: a session that
never opens the line never fetches the rows at all. Rows are labelled by the
droplet and heart icons rather than the words *Bleeding* and *Sex*, matching the
modal, and because she asked for the marks to carry this rather than the words.

**Privacy is structural, not a setting.** Four things are true by construction
and each is easy to break by accident:

- Outside the day-view line above, it renders **only inside its own modal** —
  and that line is deliberately mute until opened. The calendar, the history and
  every date other than the one on screen live behind the modal.
- It is **never cached** — no `localStorage`, and rows are re-read on every open
  rather than held. Costs one small query per open; buys a signed-out phone in
  someone else's hand having nothing to show.
- It is **not in the JSON export** (`exportJson()` sends tasks, templates,
  completions, settings — this isn't among them).
- It is **not in the assistant's prompt**. `assistant/index.ts` takes named
  context arguments rather than sweeping state, so it stays out by
  construction — *but only as long as nobody adds it to that call.*

The settings row's sub-label is the fixed string "Only ever shown here", not a
count. Every other row there summarises its data; the summary is the private
part.

**Marks, not words.** A red dot for a bleeding day (a ring for spotting), a
heart for sex — outline protected, filled unprotected. The words live in the
editor next to the icons, which is the legend; a separate one would have put
them back on screen. `--bleed` is a themed variable like every other colour,
deliberately not `--critical`, which in this app means *wrong*. Note dark mode
here is driven purely by `prefers-color-scheme`; a `[data-theme="dark"]`
selector matches nothing.

**Period runs bridge up to two blank days.** A day she forgot — or genuinely
didn't bleed — doesn't end a period. Splitting there would halve a period's
length *and* invent an impossibly short cycle right after it, which is what
makes a history like this untrustworthy. Three blank days do end it. Spotting is
not a period day (matching how Health counts it) and never opens a cycle.

The window was **1 day until the backfill argued it to 2** (her call,
2026-08-25). The seven-year log produced three "cycles" of 3, 4 and 5 days, each
one period a 2-day blank had cut in half — `2d+2+1d → 5d`, `1d+2+6d → 9d`,
`3d+2+1d → 6d`. 43 periods became 40, every cycle under 15 days disappeared, and
the longest run did not move (15d before and after), so the wider window
absorbed the artifacts without a chain reaction. Bridging measures from the
run's *current end*, so it does chain: a bleeding day every third day is one
long period. The middle merge is the honest caveat — one logged day, two blank,
then a full six-day period is not unambiguously a single event, and this reads
it as one.

**The summary is a median and a range, never a mean** — the seven-year backfill
is what settled it. Twelve real cycles came in at 3, 98, 5, 36, 31, 20, 31, 26,
27, 54, 82, 49: mean 39, a number she has never once had. Quoting it would have
asserted a regularity the data flatly denies, in the one panel built for someone
whose whole starting premise was "my period is not very predictable". The median
(31) survives the outliers and the range is printed beside it so one number never
stands in for a spread that wide. Windowed to the last 12, since a cycle from
2019 doesn't describe this year, and suppressed under three cycles. Completed
cycles only — an open period has no length yet.

**Over 90 days it is a gap, not a cycle** (`CYCLE_GAP_DAYS`) — rendered
"156-day gap" and left out of the median. Nothing that long is a cycle in any
useful sense, and her history has every flavour of it: a **356-day "cycle"
spanning her 2020 pregnancy**, seven more inside lactation, and several since
that are just months of not logging. Pregnancy (2020-05-03 → 2021-01-07) and
lactation (2021-01-07 → 2024-02-17) are recorded in Apple Health but **are not
imported** — the script reads flow, spotting and sexual activity only — so 21 of
her 40 periods start inside a window the app knows nothing about. 90 days is the
clinical amenorrhea line and needs no extra data to apply. The last-12 window
already sat entirely after lactation ended, so the median never saw any of it.

**`cycle_spans` names those gaps** (her call, 2026-08-25) — a second, tiny table
of intervals rather than more rows in `cycle_events`, whose grain is one row per
*day*: the lactation span alone would have been ~1,100 daily rows to record one
fact with two dates in it. Purely cosmetic. A span renames a gap the history had
already found and takes no part in period detection, so a load failure is
swallowed and an account that never ran the second migration just sees unnamed
gaps.

**A span must cover more than half a gap to claim it.** Without that, three
years of lactation would put its name on any gap that merely clipped its final
week. On her data the rule lands exactly right: the 356-day gap reads
*pregnancy*, three inside the lactation years read *lactating*, and the 158-day
gap before the pregnancy plus the 157- and 159-day ones after lactation ended
stay bare day counts — because those really are just months of not logging.

Note the summary numbers moved with the wider window: the last twelve cycles
read 3, 98, 5, 36, 31, 20, 31, 26, 27, 54, 82, 49 (median 31) under the 1-day
rule and 26, 156, 101, 41, 31, 20, 31, 26, 27, 54, 82, 49 (median 36) under the
2-day one — merging a split period folds its short cycle into the next.

**Backfill** is `scripts/import_health_cycle.py` — Health export zip in, one
paste-able `INSERT … ON CONFLICT` out (`--format csv` still writes a CSV for the
table editor). Offline on purpose, and no credentials: a service-role key or a
database password on the command line to load a few hundred rows once is the
worse trade, and neither the CLI nor `db push` can run without the database
password anyway. `--email` resolves `user_id` from `auth.users` inside the
statement, so the uuid never has to be found by hand or pasted into a chat. The
file ends with a `count(*)` because a wrong email matches no user and inserts
nothing **without erroring**. It streams the zip: `export.xml` runs to hundreds
of MB.

**Asked for, not built yet:** a *Tracking* tab for visualising things over time —
skincare usage, task streaks, and whatever else earns a chart. The skincare log's
month buckets are already the right grain for it (see above), and this feature's
rows are too. Water is the next tracker she named; note it wants a count, not a
chip row, so it should not be forced through the Health panel's existing shape.

**Not built, and not currently wanted:** any write-back to HealthKit. It would
need a Shortcut hitting an edge function on the `gcal` pattern (never the
service-role key in a Shortcut — those sync through iCloud to every signed-in
device) plus a `synced_to_health` column to dedupe. Only worth it if she starts
wanting this data in another app.

## Absences (built 2026-08-25)

A column beside the assignment list: one row per class, a `2/3` indicator, and
one button that logs today. Tapping it again takes it back — the undo for the
misfire a single-tap control invites. Tapping the name or the count opens that
class's dates, each removable, plus the box that sets its max.

It is a **column inside `#view-assign`**, not the app sidebar, which is hidden
on this tab (`body.assign-view .sidebar-col`) because that sidebar is a task
triage pile and these are neither tasks nor draggable. Under 900px it moves
**above** the assignment list, not below: this is what she opens the tab to tap
on the morning she misses a class, and the list is long.

**Dates and limits live in different places, on purpose.**

- Dates go in `class_absences` — its own table, same reasoning as
  `cycle_events`: an append-only dated event, one tap makes one row, real rows
  race with nothing. In `agenda_data.settings` they would ride the row merge
  only the time-tracker implements, and a semester's attendance record is the
  wrong thing to lose to two devices.
- The **limit** goes in `settings.absenceLimits` keyed by course id. It is a
  preference that changes once a semester. It is deliberately **not** in
  `law_school_data.courses[]`: that is the law school tracker's schema, and a
  field this app invented there could vanish on its next syllabus import.

Losing a limit means retyping a number; losing the dates would mean losing the
record. That asymmetry is the whole argument for the split.

`course_id` is text with **no foreign key** — courses are a JSON array in
another app's row, so there is no table to point at. A dropped course therefore
leaves rows behind. The panel renders only courses it can still see and keeps
the rest rather than deleting attendance history on a shape it does not own.

**The panel owns its own membership** (added 2026-08-25). `settings.absenceHidden`
is a set of course ids it skips; `settings.absenceExtra` is its own list of
classes, whose ids are prefixed `x:` so they can never collide with a law-school
course id. **Untracking is not deleting** — Law Review has coursework and no
attendance, and its assignments live in `law_school_data`, a row this app does
not own. Untracking also keeps the class's logged dates, and manage mode shows
the count beside an untracked row so that is visible rather than promised.

The same skip set handles a course appearing **twice** in the tracker (KY
Innocence Project did): untrack the duplicate and one remains. Duplicates and
opt-outs are both membership questions, so they did not need separate
mechanisms.

Manage mode is a mode, not a delete button on the normal row, because the list
it needs to show is *every* class including the untracked ones — a control on
the visible rows could only ever remove, never put back. The trash appears only
on an extra; a law-school course is untracked, never deleted from here.

**Colour only when it means something.** Amber one short of the limit, red at or
past it, nothing at all when no limit is set — a count with no limit is just a
count. `used > 0` is load-bearing in that test: on a one-absence limit,
`used >= limit - 1` is true at zero, so a class she had never missed opened the
semester already amber.

## Assignments tab (built 2026-08-14)

Her coursework, day by day, as the checklist she kept by hand through 1L. The rows are **not** agenda tasks — they live in the law school tracker's `law_school_data.courses[].assignments`, put there by its syllabus import. This tab is the **editing surface**: the law tracker owns import, the syllabus round-trip, and calendar sync, and deliberately has no editing UI for these fields.

Shape, matching the document it replaces (a `.md` file of `- [x]` lines grouped under date headings):

- **Grouped by date**, one card per day, unfinished past items collected at the top under *Not done yet* — 83 of her items last year ended the semester unticked, so they need somewhere to be other than a date she has scrolled past.
- **Course as a prefix** on every line (`Civ Pro: pp. 33-40`), because a day mixes four courses.
- **One level of nesting.** A reading carries `subtasks: [{id, text, done}]` — the per-case briefs. Her 172 sub-items were *all* exactly one deep; a deeper tree would be a worse outline than the one she keeps elsewhere. Nothing generates these; she adds them here.
- **Ticked items keep their place with a line through them**, the way `~~strikethrough~~` did in the document.
- URLs in a title or detail render as links — she pasted 33 of them last year.

### The cross-app write

Every edit goes through `commitLawEdit(edit)` and follows the restock rule: **re-read the row immediately before writing, and send back only the `courses` column.** The law school app may be open in another tab holding its own copy of `milestones` and `settings`, and writing the whole row from a stale read would undo whatever she just did there.

Two things that look like fussiness and are not:

- **Edits are described as data** (`{kind, courseId, assignmentId, subId, ...}`), never as a mutation of an object we happen to hold, because each one is applied *twice* — once to the on-screen copy so the tick is instant, once to the freshly re-read server copy.
- **Toggles carry the value they set** (`value: true`), not "flip it". Applied twice, a flip lands back where it started.

Writes are **serialized** through a promise chain. Two quick ticks would otherwise both re-read the same row and the second write would carry the first item back to its old state — a lost update, and trivially easy to hit on a checklist.

Rows created here are `source: 'manual'`, so the law tracker's import — which replaces what a previous import of that course wrote — never deletes them.

## Time: three ways a block gets logged (2026-08-24)

The timer was originally the only way in, which meant every hour had to be
predicted in advance and stopped on time. It now has three entrances, all
appending through **one function, `writeTimeBlock()`** — the per-day split, the
re-read-before-write rule, and the entries schema are written once. Adding a
fourth entrance means calling that, not writing another update.

1. **The running timer** — unchanged: start, stop, discard.
2. **A finished block, typed** — *timer menu → Log a finished block*: what it
   was, date, from, to, category. The date defaults to **the day the day-view is
   showing**, the same bargain the skincare panel makes — navigate to yesterday
   and yesterday is what you log. It reuses the assistant's `resolveLoggedBlock`,
   so the menu and the chat agree on what "10pm to 1am" means and share the
   more-than-a-day refusal.
3. **A finished block, spoken** — `log_time`, already built. "Log 1 hour of Law
   Review between 8am and 9am this morning."

### Stop and log a different length

The third way out of a running timer, between logging a wrong 14 hours and
throwing the afternoon away. Offered in the timer menu and — more importantly —
on the forgot-to-stop guard banner, which by definition only appears when the
elapsed time is no longer worth logging.

**The corrected block runs forward from the original start, not backward from
now.** A timer left running is one she started when the work started and forgot
to stop, so 90 minutes from a 9am start is 9:00–10:30. Anchoring to now would
file this morning's reading at 11pm.

The entry and the cleared timer go up in **one** update (`clearTimer`). Two
writes would leave a window where the time is logged and the timer still runs,
and a phone frozen between them would log the block again on the next stop.

### Writes to the tracker's row must prove they landed

`writeTimeBlock` ends its update with `.select('user_id')` and treats zero rows
back as a failure. **An update whose filter matches no row is not an error in
PostgREST** — it succeeds, changes nothing, returns no rows. This app only ever
*updates* `time_data`; it never inserts one. So on an account where the tracker
had never written a row, every block logged from here would have vanished while
the assistant replied "Logged 1h." A time log is the one thing that must never
fail silently.

That is not the same problem as the tracker not *showing* an entry this app
wrote. The tracker saves with a **whole-row upsert from its in-memory copy**
(`payload()` includes `entries`), and does not re-read first the way this app
does. A tracker tab holding a stale `ENTRIES` — open in the background, or
restored from an unsynced cache — will carry that array back up and delete
anything the agenda logged in the meantime. It has Realtime and a focus refetch,
so it usually has the entry before it saves; "usually" is the whole gap. This is
the documented whole-row last-write-wins hole, and closing it properly is the
Phase B/C merge, not a patch. Porting the 2026-08-08 fixes to the tracker is the
prerequisite.

**`parseDurationMins` refuses bare decimals.** "90", "1h30", "1:30", "1.5h",
"2 hours" all parse; a bare "2.5" does not. Read as minutes it would log 3 and
say nothing, when it plainly means two and a half hours — a visible refusal
naming the formats beats a silent fiftieth of the intended time.

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

**Phase B/C — SHIPPED 2026-08-24 in the time-tracker only.** Brought forward
from the planned dry-run period by a real loss: an entry logged from this app on
the morning of 2026-08-24 was gone by the afternoon, overwritten by the
tracker's whole-row upsert. The gate the phasing existed to protect — never
merge with a build that deletes without tombstoning — is now enforced in code
(`mergeRow` returns null unless both rows carry `_sync.v >= 2`), so waiting had
stopped being the thing that made it safe.

`mergeRow(mine, theirs)` lives in `time-tracker.html` and is pure: two rows in,
one row out, no globals and no writes, covered by 19 cases. Full rules are in
the tracker's CLAUDE.md. It is wired into the tracker's `_doSave` (re-read and
merge immediately before the upsert) and its `loadUserData` (merge an unsynced
cache with the server rather than adopting it wholesale).

The tracker's pagehide write cannot merge — no page left to await a re-read on —
so it is a **compare-and-swap** instead: `updated_at=eq.<the row it last saw>`.
If this app moved the row in that window the write matches nothing and is a
no-op, and the tracker's dirty cache carries the work to its next open.

**Not ported here or to restock.** `agenda_data` and `restock_data` are still
wholesale last-write-wins between devices. This app was never the one destroying
time entries — it already re-reads before every cross-app write — so the fix
belonged where the clobber was.

**Open gap found during Phase A:** agenda's `ensureMonthlyRecurring` creates
this month's copy of a monthly task when one is missing. Two devices both
offline at the start of a month each create their own with different ids, and
Phase C's merge would keep both → duplicate monthly tasks. Harmless today.
Needs a deterministic identity (id derived from `seriesId + month`), handled in
Phase B while merge is still a dry run.

Two load-time paths still save, deliberately, because their state is real and
not recomputable — and both fire only when something upstream actually changed,
so neither is an every-load republish:

- `syncRestockOutTasks` — `settings.restockTasked` is the ledger that stops a
  staple being tasked twice. Unsaved, the next load re-creates "Buy X".
- `reconcileAgendaCalendar` — clearing a dead `gcal_event_id` is real state.
  Unsaved, the app keeps pushing against an event Google no longer has.

They are the residual exposure: if restock or Google Calendar changed in the
window between a phone's unsynced write and a laptop's open, the laptop still
republishes and the phone still loses. Closing that needs the merge, not another
save-suppression.

**Still true after the 2026-08-08 fixes:** if the server genuinely receives a
newer write while a device holds unsynced work, that device still loses its work
silently on the next load. The fixes remove the ways that happened *without* a
real competing edit; they do not make concurrent edits safe. That is Phase B/C.

This sync block is copied between apps in the suite. Apps carrying it: agenda,
restock, time-tracker. Copy the corrected version, not an older sibling.
**All three apps now have the 2026-08-06 and 2026-08-08 fixes** (verified
2026-08-24). This block claimed otherwise about the time-tracker and then about
restock, and was wrong both times — the note outlived the work. Restock's
`applyPaceRecalcMarks` and `migrateIfNeeded` mutate memory only, its cache
compares `updated_at`/`synced` rather than item counts, it never pushes blind
when the server is unreachable, and it flushes through a keepalive beacon on
pagehide. **Check the code before trusting this paragraph.**

What is genuinely uneven is the *merge*: only the time-tracker has one.
