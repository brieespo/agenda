# 📅 Agenda

Daily agenda app: a day view mixing timed events and untimed tasks, a week view, and a weekly sidebar for "this week, no day yet" tasks that get dragged onto days when they become real. Sibling app to [dinner-planner](https://github.com/brieespo/dinner-planner), [law-school-tracker](https://github.com/brieespo/law-school-tracker), [restock](https://github.com/brieespo/restock), [perfume-tracker](https://github.com/brieespo/perfume-tracker), and [sewing-tracker](https://github.com/brieespo/sewing-tracker): pure HTML + CSS + vanilla JS in a single file, Supabase for auth + sync, GitHub Pages for hosting.

**Live at:** https://brieespo.github.io/agenda

## Files

- `agenda.html` — the entire app (source of truth)
- `index.html` — always an exact copy of `agenda.html`. After every change: `cp agenda.html index.html`, then push.
- `.github/workflows/deploy.yml` — GitHub Pages deploy on every push to `main`
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — PWA installability (see below)

## PWA (installable)

`manifest.json` (name, standalone display, theme/background colors pulled from the app's own `--accent`/`--page` CSS variables) plus `icon-192.png`/`icon-512.png`/`apple-touch-icon.png` (generated once via Pillow — same calendar glyph as the favicon, full-bleed accent-blue background, no separate design asset to maintain) make the app installable from Chrome's address bar or a phone's "Add to Home Screen."

`sw.js` is intentionally minimal — just enough to satisfy installability, not an offline-first cache. This is a live-data app (Supabase + Google Calendar), so every same-origin request is **network-first**; the tiny cached app shell (`index.html`, `manifest.json`, the two icons) is only ever used as a fallback if a request fails outright (actually offline), never to serve stale content while online. Cross-origin requests (Supabase, Google, the CDN supabase-js bundle) always pass straight through uncached.

### Data freshness (two complementary mechanisms, not redundant)

- **Focus/visibility refetch** — `refreshFromSupabase()` re-pulls the row whenever the tab regains focus or becomes visible. Catches "stepped away and came back," including cases where a Realtime socket got dropped while backgrounded (mobile browsers throttle/kill background sockets often).
- **Supabase Realtime** — subscribes to `UPDATE` events on the signed-in user's own `agenda_data` row, so a second open tab/device/window updates live without needing focus to change at all. Requires enabling Realtime on the table once:
  ```sql
  do $$
  begin
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agenda_data'
    ) then
      alter publication supabase_realtime add table agenda_data;
    end if;
  end $$;
  ```
Both guest mode and mid-session own-writes are handled the simple way: guest mode skips both (no server row to watch), and an own save's Realtime echo just reassigns the same data it already has — harmless, if occasionally a redundant re-render.

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

## Meals (dinner-planner integration)

A per-day **meal strip** on the day view plus a **Meal plan** sidebar (a pool of unscheduled meals you drag onto days), mirroring the This-week / This-month sidebars. Meals have a light "made" toggle (grays + italicizes, no rollover) and are draggable between days and to/from the pool.

- **Where meals live:** `settings.meals` — piggybacks the settings JSON rather than a new column, so every existing sync/save/load path already carries them and no DB migration is needed. Meals are deliberately **not** tasks: `runRollover` and `weeklyProgress` both operate on `TASKS`, so meals never roll over and never count toward the weekly completion %.
- **Snapshot, not live-link:** picking a recipe copies its `{name, id}` onto the meal at pick time, so a later rename in the dinner planner never rewrites your agenda history.
- **Cross-app read:** the recipe picker and "import a saved week" pull from the **dinner planner's** `user_data` row (`recipes` + `rules._savedMenus`) via a plain owner read — same shared Supabase project, same signed-in user, so its RLS allows it. Fetched once, lazily, when the picker first opens; guests (no session) get the custom-dish path only. If the dinner app ever changes its `user_data` RLS or moves recipes out of that row, the picker falls back to empty gracefully. Saved **weekly** menus import onto a week by mapping each plan entry's `day` name (Mon–Sun) to that week's dates; entries with no recipe are skipped.

## Drag & drop

Pointer-events based (not native HTML5 drag/drop), so it works with both mouse and touch. A single pointerdown→move→up cycle on a draggable row does double duty: past a small movement threshold it's a drag (today-list reorder/retime, sidebar → day/grid assignment, week-view day-to-day moves); below the threshold, releasing counts as a tap and opens the edit modal instead.

## Assistant (chat + quick-add)

`supabase/functions/assistant/index.ts` proxies chat/quick-add messages to Anthropic (Haiku) using Claude's tool-use to force a structured `{reply, actions[]}` response — no raw-JSON parsing. The Anthropic key lives only in Supabase secrets and never reaches the client. The function also checks the caller's Supabase JWT email against an `ALLOWED_EMAIL` secret, since a valid JWT alone only proves "someone signed up on this shared project," not "Bri" — anyone could self-register via any sibling app's auth form. Both the chat drawer and quick-add box are hidden in guest mode since there's no JWT to send.

Read access: the assistant also answers questions ("what's my Wednesday look like?") directly in `reply` with an empty `actions` array — same tool-use call, same endpoint, no separate code path. `buildAssistantContext()` sends a rolling window (a week back through five weeks ahead) plus every undated weekly/monthly sidebar item on every message, rather than just whatever's currently on screen, so a question about a day/week that isn't the one currently displayed still has something to answer from. Personal task volume is low enough that sending this generous a window is simpler and more reliable than first trying to parse a date range out of the question.

Redeploy after editing the function:
```
supabase functions deploy assistant --project-ref zymvsdkwmdhrwjycxisr
```
Secrets (set once, never committed): `ANTHROPIC_API_KEY` (from console.anthropic.com / platform.claude.com) and `ALLOWED_EMAIL`.

## Google Calendar (two-way sync, silent refresh)

No client ID is hardcoded — paste your own OAuth client ID into Settings → Google Calendar (same pattern as law-school-tracker); since GitHub Pages project sites share one origin per user, the same client ID already authorized for law-school-tracker works here too. Events from your other calendars render read-only on the day grid and week view (dashed, softer fill) and in an all-day strip.

True silent background refresh (no click, no popup, every visit) requires a server-side refresh token, since Google's client-side library (GIS) has no documented way to request one and its token-client model requires a real user gesture for every renewal — confirmed against Google's own docs before building this, not assumed. So the connect flow is a plain OAuth **authorization-code** redirect (`access_type=offline&prompt=consent`, constructed manually — GIS's `initCodeClient` doesn't expose `access_type`), landing back on `https://brieespo.github.io/agenda/` with a `?code=`. `supabase/functions/gcal/index.ts` exchanges that code for tokens once, stores only the refresh token server-side (table `gcal_tokens`, RLS-enabled with zero client policies — only the function's service-role key can read/write it, the client never touches it directly), and from then on mints fresh access tokens on request. This is why Google Calendar requires being signed in (not guest mode): the refresh token has to be tied to a real account.

Requires: the OAuth client published to **Production** (Testing-status refresh tokens expire after 7 days — a hard Google limit, not configurable), `https://brieespo.github.io/agenda/` added under **Authorized redirect URIs** (separate from "Authorized JavaScript origins"), and its **Client Secret** set as `GOOGLE_CLIENT_SECRET` in Supabase secrets (never committed). Realistic ways this can still need reconnecting, none of them silent-refresh bugs: you revoke access at myaccount.google.com/permissions, 6 months with the app unused, or a Google-side security event forcing re-auth.

### Two-way push sync

Scope is the full `https://www.googleapis.com/auth/calendar` — not `calendar.events`, which was the original ask. Creating a new calendar (`calendars.insert`) needs calendar-management access that `calendar.events` doesn't grant, and deleting events from other calendars (see below) needs broad event write access too, so the full scope is the one combination that actually covers both without stacking multiple scopes — confirmed against Google's OAuth scope reference before building, same as the silent-refresh scope decision above. Both are "sensitive," not "restricted" — same unverified-app warning as before, no formal security review.

On first connect, the app finds-or-creates a calendar literally named **Agenda** (same pattern as law-school-tracker's own app-owned calendar) and stores its id in `SETTINGS.agendaCalendarId`. Every one-time task (never routines/templates/exceptions — "routines aren't calendar events") that has both a date and a time pushes there automatically: on creation (including via chat/quick-add), and again on every subsequent move/retime/title/notes edit, tracked via `task.gcal_event_id`. Deleting the task deletes the event; marking done never touches it. If a task loses its date or time (dragged back to a sidebar, etc.), the linked event is deleted the same way a task deletion would. The Agenda calendar is excluded from the calendar picker and the rendered feed — its events already show as tasks — but its events are still fetched separately each refresh purely to detect ones deleted *directly* in Google Calendar, which unlinks the task (clears `gcal_event_id`) rather than silently recreating the event.

Settings → Google Calendar shows a sync status line (tasks linked / pending) and a **Push existing timed tasks now** button — a one-time catch-up for tasks that already had a date+time before two-way sync was ever turned on.

### Deleting events from the app

Click any Google Calendar event (grid block, all-day strip, or week-view chip) to open its detail view — the *only* place delete lives; there's no swipe or hover affordance on the grid itself. Deleting requires an explicit confirmation naming the event, date, and calendar. Recurring events only ever offer "delete just this occurrence" (Google's `singleEvents=true` event-list flag already gives each occurrence its own deletable instance id, so no extra work there) plus a link to the event's own `htmlLink` for deleting the whole series in Google Calendar's own UI. The delete option is hidden entirely when the calendar's `accessRole` (from `calendarList.list`) is `reader` or `freeBusyReader`. The feed refreshes after a successful deletion.

### Dragging & resizing on the day timeline

Blocks on the day-view hour grid can be moved (drag the body) and resized (drag the bottom edge), snapping to 15-minute marks. Move uses the existing pointer-drag/drop system, but the `hour-slot` drop now derives the time from where the block's *top* landed (tracking the grab offset via `_gridGrabOffsetY`, snapping off `_gridStartHour`) instead of just the slot's hour, so it's quarter-hour precise. A dragging block gets `pointer-events:none` so hit-testing finds the slot beneath it. Resize is a separate `startBlockResize` on a bottom `.gb-resize` handle (a pure pixel drag, `stopPropagation` so it never also triggers a move).

- **Timed tasks:** move + resize update `time`/`duration_min` and re-sync to the Agenda calendar via `syncTaskToGCal` (a virtual routine instance becomes a `template_exception` first, same as any other edit).
- **Google Calendar events:** move + resize are allowed only on **writable** calendars (`accessRole` not `reader`/`freeBusyReader` — read-only events stay click-only, no handles). `commitGcalReschedule` optimistically updates the local copy, re-renders, then `PATCH`es the event's start/end; on failure it reverts and warns. A recurring event is edited as just that one occurrence (the `singleEvents=true` instance id), with an informational notice saying the rest of the series is unchanged. This is the one place the app writes to calendars other than its own Agenda calendar — a deliberate exception to the otherwise read-only treatment, gated behind the same `accessRole` guard the delete flow uses.

Redeploy after editing the function:
```
supabase functions deploy gcal --project-ref zymvsdkwmdhrwjycxisr
```

```sql
create table if not exists gcal_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz default now()
);
alter table gcal_tokens enable row level security;
```

## Push notifications (morning brief)

Settings → Notifications → "Morning brief at 7:00" toggle. Subscriptions are per-device — the toggle's on/off reflects whether *this* device specifically has an active `PushSubscription` (not just the synced setting), since enabling on a phone shouldn't look "already on" from the Mac's subscription and then disable it on toggle.

**VAPID keys** — generated once locally (Python `cryptography`, EC P-256, base64url-encoded per RFC 8292) and set as Supabase secrets; the private key never appears in this repo or chat. Only the public key is embedded client-side (`VAPID_PUBLIC_KEY` in `agenda.html`) — public keys are meant to be public.

```sql
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
create policy "Users manage own push subscriptions" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`supabase/functions/morning-brief/index.ts` composes the brief (today's task count, first timed event, rolled-over count — reimplementing the client's recurrence/rollover logic in Deno, since this runs without the app open) and sends it via `npm:web-push`. It's triggered by pg_cron, not the client, so it authenticates via a shared `x-cron-secret` header instead of a user JWT — there's no per-request user when a scheduler calls it.

**Scheduling and DST:** pg_cron runs in UTC with no native timezone/DST support. Rather than hand-maintaining two schedules that flip every March/November, cron fires the function at *both* UTC times that correspond to 7am Eastern across DST (11:00 UTC in EDT, 12:00 UTC in EST); the function itself checks the actual current Eastern hour and no-ops unless it's really 7 — so exactly one of the two firings ever sends, automatically, forever, no manual DST updates.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('morning-brief-edt', '0 11 * * *', $$
  select net.http_post(
    url := 'https://zymvsdkwmdhrwjycxisr.supabase.co/functions/v1/morning-brief',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', '<CRON_SECRET value>'),
    body := '{}'::jsonb
  );
$$);

select cron.schedule('morning-brief-est', '0 12 * * *', $$
  select net.http_post(
    url := 'https://zymvsdkwmdhrwjycxisr.supabase.co/functions/v1/morning-brief',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', '<CRON_SECRET value>'),
    body := '{}'::jsonb
  );
$$);
```

Manual verification (still requires `x-cron-secret`, just skips the hour gate): `POST .../functions/v1/morning-brief?test=true`.

**iOS note:** push notifications on iPhone only work for a PWA added to the home screen *through Safari's share-sheet "Add to Home Screen"* — Chrome on iOS is a WebKit wrapper with no installable-PWA/push support at all, regardless of what Chrome shows on desktop or Android.

Redeploy after editing the function:
```
supabase functions deploy morning-brief --project-ref zymvsdkwmdhrwjycxisr
```

## iOS Scriptable widget

`agenda-widget.js` is a [Scriptable](https://scriptable.app) script for a lock-screen or home-screen widget showing today's date, the next timed item, and up to 3 undone tasks.

**Why it doesn't use your real Supabase login:** that account has full read/write access to every app in the shared project — a script holding it (or a session token derived from it) is a much bigger blast radius than this needs. Instead, `supabase/functions/widget-brief/index.ts` is a dedicated read-only endpoint authenticated by its own `WIDGET_SECRET` (a plain random string, unrelated to any account credential) plus a fixed `AGENDA_USER_ID`, since this suite is single-tenant. A leaked widget secret only ever unlocks today's summary through this one endpoint — nothing else — and can be rotated independently of your actual password at any time.

The secret is entered once via an in-app prompt and stored in iOS's Keychain (shared between the Scriptable app and its widget extension, but never written into the script's own text) — it never appears in the script file, so it's not exposed if the script is ever exported or shared.

Redeploy after editing the function:
```
supabase functions deploy widget-brief --project-ref zymvsdkwmdhrwjycxisr
```

## Build phases

1. **Phase 1 (done):** auth, tasks CRUD, day view (untimed list + hour grid), week view, weekly sidebar with drag-assignment, completion gray-out, rollover, recurring templates + routines settings, the Claude chat (edge function + chat drawer + quick-add).
2. **Phase 2 (done):** Google Calendar, read-only, with true silent background refresh via a server-side refresh token (see above).
3. **Phase 3:** suite sync — dinner-planner meals integration (done, see Meals above); restock/law-school items as `source:'suite'` background items still pending (restock needs more logged data first, law-school largely overlaps the Google Calendar feed).
4. **Phase 4:** polish — weekly-progress completion % (done), warm/minimal themes (done); week-end sidebar rollover review and print view not pursued.
