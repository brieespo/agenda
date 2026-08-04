// Composes and sends the daily morning-brief push notification. Not
// called by the client — triggered by pg_cron (see README) via
// net.http_post, authenticated with a shared secret (x-cron-secret)
// rather than a user JWT, since there's no per-request user here.
//
// Scheduling note: pg_cron runs in UTC and doesn't natively handle DST.
// Rather than maintaining two cron schedules that need updating twice a
// year, cron fires this function at BOTH UTC times that correspond to
// 7am Eastern across DST (11:00 UTC during EDT, 12:00 UTC during EST),
// and this function itself checks the actual current Eastern hour and
// no-ops unless it's really 7am there — so only one of the two firings
// ever actually sends, automatically, with no manual DST maintenance.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ---- Minimal re-implementation of the client's date/recurrence logic,
// server-side, so the brief can be computed without the app being open. ----
function templateOccursOn(tpl: any, dateStr: string): boolean {
  if (!tpl.active) return false;
  const r = tpl.recurrence || {};
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (r.freq === 'daily') return true;
  if (r.freq === 'weekly') return (r.days || []).includes(DOW[date.getUTCDay()]);
  if (r.freq === 'monthly') return date.getUTCDate() === r.day;
  return false;
}
function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
function startOfWeekStr(dateStr: string, weekStart: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const offset = weekStart === 'mon' ? (dow === 0 ? 6 : dow - 1) : dow;
  return addDaysStr(dateStr, -offset);
}
const monthOf = (dateStr: string) => dateStr.slice(0, 7);

function todayEastern(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function currentHourEastern(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit' }).format(new Date()));
}
function fmtTime12(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

function computeBrief(row: any, today: string) {
  const tasks = row.tasks || [];
  const templates = row.templates || [];
  const completions = row.completions || [];
  const weekStart = (row.settings && row.settings.weekStart) || 'sun';
  const curWeek = startOfWeekStr(today, weekStart);
  const curMonth = monthOf(today);

  // Routines (recurring templates) are excluded from the brief by default —
  // it's meant to be a short one-time/rolled-over/first-event summary, not
  // a full routine checklist. A template only shows up (as a virtual
  // instance, or as a same-day exception created by editing/moving one
  // occurrence) if its own include_in_brief flag is explicitly on.
  const includedTemplateIds = new Set(templates.filter((tpl: any) => tpl.include_in_brief === true).map((tpl: any) => tpl.id));
  const oneOffToday = tasks.filter((t: any) => t.date === today && t.source !== 'template_exception');
  const exceptionToday = tasks.filter((t: any) => t.date === today && t.source === 'template_exception' && includedTemplateIds.has(t.template_id));
  const exceptionTemplateIds = new Set(
    tasks.filter((t: any) => t.source === 'template_exception' && t.exception_date === today).map((t: any) => t.template_id)
  );
  const virtualToday = templates
    .filter((tpl: any) => includedTemplateIds.has(tpl.id) && templateOccursOn(tpl, today) && !exceptionTemplateIds.has(tpl.id))
    .map((tpl: any) => ({
      title: tpl.title, time: tpl.time || null,
      done: completions.some((c: any) => c.template_id === tpl.id && c.date === today),
    }));
  const allToday = oneOffToday.concat(exceptionToday).concat(virtualToday);
  const leftCount = allToday.filter((t: any) => !t.done).length;
  const timed = allToday.filter((t: any) => t.time).sort((a: any, b: any) => a.time.localeCompare(b.time));
  const firstEvent = timed[0] || null;

  const rolledDate = tasks.filter((t: any) => t.source !== 'template' && t.source !== 'template_exception' && t.date && t.date < today && !t.done).length;
  const rolledWeek = tasks.filter((t: any) => !t.date && t.week && t.week < curWeek && !t.done).length;
  const rolledMonth = tasks.filter((t: any) => !t.date && !t.week && t.month && t.month < curMonth && !t.done).length;
  const rolledOver = rolledDate + rolledWeek + rolledMonth;

  let body = `${leftCount} task${leftCount === 1 ? '' : 's'} today`;
  if (firstEvent) body += ` · first up: ${firstEvent.title} at ${fmtTime12(firstEvent.time)}`;
  if (rolledOver) body += ` · ${rolledOver} rolled over`;
  return { title: 'Your morning brief', body, url: './' };
}

// ---- Suite context ----
// Everything below lives in other apps' rows on this same project, which this
// function can already read with the service key. Each source is independently
// optional: a missing table, an empty row or a shape that doesn't parse drops
// that line and leaves the rest of the brief intact, because a notification
// that fails to arrive is worse than one missing its dinner line.
const LAW_HORIZON_DAYS = 21;
async function suiteLines(admin: any, userId: string, today: string): Promise<string[]> {
  const lines: string[] = [];

  // Tonight's dinner, from the dinner planner's dated calendar (the authoring
  // surface — the agenda only holds imported snapshots, which may lag).
  try {
    const { data } = await admin.from('user_data').select('rules').eq('user_id', userId).maybeSingle();
    const day = data?.rules?._calendar?.[today];
    const bits = [day?.r?.name, day?.side?.name].filter(Boolean);
    if (bits.length) lines.push(`Dinner: ${bits.join(' · ')}`);
  } catch (e) { console.error('dinner lookup failed', e); }

  // Anything actually out of stock — the reason a "buy X" task exists at all.
  try {
    const { data } = await admin.from('restock_data').select('staples').eq('user_id', userId).maybeSingle();
    const out = (data?.staples || []).filter((s: any) => s && s.status === 'out' && s.name).map((s: any) => s.name);
    if (out.length) lines.push(`Out of: ${out.slice(0, 4).join(', ')}${out.length > 4 ? ` +${out.length - 4}` : ''}`);
  } catch (e) { console.error('restock lookup failed', e); }

  // The nearest law-school deadline, milestones and their lead-up tasks alike.
  // Same derivation the hub widget uses, kept to the single closest item so the
  // notification stays glanceable.
  try {
    const { data } = await admin.from('law_school_data').select('milestones').eq('user_id', userId).maybeSingle();
    const items: {date: string; label: string}[] = [];
    for (const m of (data?.milestones || [])) {
      if (!m?.date || m.status === 'done') continue;
      items.push({ date: m.date, label: m.name });
      for (const t of (m.lead_tasks || [])) {
        if (t?.done || !t?.label) continue;
        items.push({ date: addDaysStr(m.date, -(t.days_before || 0)), label: t.label });
      }
    }
    const next = items.filter(i => i.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (next) {
      const days = Math.round((Date.parse(next.date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
      // Only when it's actually near. The nearest milestone can be most of a
      // year out, and a line repeating "in 287 days" every morning is how a
      // notification teaches you to stop reading it.
      if (days <= LAW_HORIZON_DAYS) {
        lines.push(`Law: ${next.label} ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`);
      }
    }
  } catch (e) { console.error('law lookup failed', e); }

  return lines;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== Deno.env.get('CRON_SECRET')) return json({ error: 'unauthorized' }, 401);

  // Manual verification still requires the same secret as the real cron
  // trigger — this only skips the *time* gate, not authentication — so
  // delivery can be tested without waiting for an actual 7am ET.
  const isTest = new URL(req.url).searchParams.get('test') === 'true';
  const hour = currentHourEastern();
  if (!isTest && hour !== 7) return json({ skipped: true, reason: `current Eastern hour is ${hour}, not 7` });

  const today = todayEastern();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

  const { data: rows, error } = await admin
    .from('agenda_data')
    .select('user_id, tasks, templates, completions, settings')
    .eq('settings->>morningBriefEnabled', 'true');
  if (error) { console.error('query error', error); return json({ error: 'query failed' }, 500); }

  let sent = 0, failed = 0;
  for (const row of rows || []) {
    const brief = computeBrief(row, today);
    // Extra lines are appended rather than folded into the first line, so the
    // agenda summary still reads as the headline on a locked screen where only
    // the first line or two survives truncation.
    const extra = await suiteLines(admin, row.user_id, today);
    if (extra.length) brief.body += '\n' + extra.join('\n');
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', row.user_id);
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(brief));
        sent++;
      } catch (e) {
        failed++;
        console.error('push send failed', sub.endpoint, (e as any).statusCode || (e as Error).message);
        // 404/410 mean the browser dropped this subscription (uninstalled,
        // permission revoked, endpoint rotated) — stop trying it forever.
        if ((e as any).statusCode === 404 || (e as any).statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    }
  }
  return json({ ok: true, today, hour, usersChecked: (rows || []).length, sent, failed });
});
