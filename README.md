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

## Drag & drop

Pointer-events based (not native HTML5 drag/drop), so it works with both mouse and touch. A single pointerdown→move→up cycle on a draggable row does double duty: past a small movement threshold it's a drag (today-list reorder/retime, sidebar → day/grid assignment, week-view day-to-day moves); below the threshold, releasing counts as a tap and opens the edit modal instead.

## Assistant (chat + quick-add)

`supabase/functions/assistant/index.ts` proxies chat/quick-add messages to Anthropic (Haiku) using Claude's tool-use to force a structured `{reply, actions[]}` response — no raw-JSON parsing. The Anthropic key lives only in Supabase secrets and never reaches the client. The function also checks the caller's Supabase JWT email against an `ALLOWED_EMAIL` secret, since a valid JWT alone only proves "someone signed up on this shared project," not "Bri" — anyone could self-register via any sibling app's auth form. Both the chat drawer and quick-add box are hidden in guest mode since there's no JWT to send.

Redeploy after editing the function:
```
supabase functions deploy assistant --project-ref zymvsdkwmdhrwjycxisr
```
Secrets (set once, never committed): `ANTHROPIC_API_KEY` (from console.anthropic.com / platform.claude.com) and `ALLOWED_EMAIL`.

## Google Calendar (read-only, silent refresh)

No client ID is hardcoded — paste your own OAuth client ID into Settings → Google Calendar (same pattern as law-school-tracker); since GitHub Pages project sites share one origin per user, the same client ID already authorized for law-school-tracker works here too. Events render read-only on the day grid and week view (dashed, softer fill, no checkbox) and in an all-day strip; this app never writes to Google Calendar.

True silent background refresh (no click, no popup, every visit) requires a server-side refresh token, since Google's client-side library (GIS) has no documented way to request one and its token-client model requires a real user gesture for every renewal — confirmed against Google's own docs before building this, not assumed. So the connect flow is a plain OAuth **authorization-code** redirect (`access_type=offline&prompt=consent`, constructed manually — GIS's `initCodeClient` doesn't expose `access_type`), landing back on `https://brieespo.github.io/agenda/` with a `?code=`. `supabase/functions/gcal/index.ts` exchanges that code for tokens once, stores only the refresh token server-side (table `gcal_tokens`, RLS-enabled with zero client policies — only the function's service-role key can read/write it, the client never touches it directly), and from then on mints fresh access tokens on request. This is why Google Calendar requires being signed in (not guest mode): the refresh token has to be tied to a real account.

Requires: the OAuth client published to **Production** (Testing-status refresh tokens expire after 7 days — a hard Google limit, not configurable), `https://brieespo.github.io/agenda/` added under **Authorized redirect URIs** (separate from "Authorized JavaScript origins"), and its **Client Secret** set as `GOOGLE_CLIENT_SECRET` in Supabase secrets (never committed). Realistic ways this can still need reconnecting, none of them silent-refresh bugs: you revoke access at myaccount.google.com/permissions, 6 months with the app unused, or a Google-side security event forcing re-auth.

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

## Build phases

1. **Phase 1 (done):** auth, tasks CRUD, day view (untimed list + hour grid), week view, weekly sidebar with drag-assignment, completion gray-out, rollover, recurring templates + routines settings, the Claude chat (edge function + chat drawer + quick-add).
2. **Phase 2 (done):** Google Calendar, read-only, with true silent background refresh via a server-side refresh token (see above).
3. **Phase 3:** suite sync — study blocks/LR checkpoints/restock items as `source:'suite'` background items; hub widget.
4. **Phase 4:** polish — week-end sidebar rollover review, completion-streak stats, print view.
