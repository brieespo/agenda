// Read-only endpoint for the Scriptable iOS widget. Deliberately narrow:
// returns only today's summary (date, next timed item, top 3 undone
// tasks), never the raw row. Authenticated by a dedicated WIDGET_SECRET
// rather than a real Supabase session — a leaked widget secret only ever
// unlocks this one read-only view, not the account itself, and can be
// rotated independently of anything else. Single-tenant by design (this
// suite has one user), so AGENDA_USER_ID is a plain secret rather than
// something derived per-request.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-widget-secret',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Same minimal recurrence re-implementation as morning-brief, kept
// separate rather than shared since Edge Functions each bundle standalone.
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
function todayEastern(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function computeWidgetBrief(row: any, today: string) {
  const tasks = row.tasks || [];
  const templates = row.templates || [];
  const completions = row.completions || [];

  // Same "routines excluded unless opted in" rule as the morning brief —
  // a lock-screen widget has even less room for routine noise.
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

  const undone = allToday.filter((t: any) => !t.done);
  const timedUndone = undone.filter((t: any) => t.time).sort((a: any, b: any) => a.time.localeCompare(b.time));
  const next = timedUndone[0] || null;
  const rest = undone.filter((t: any) => t !== next);

  return {
    date: today,
    nextTimedItem: next ? { title: next.title, time: next.time } : null,
    topUndoneTasks: rest.slice(0, 3).map((t: any) => t.title),
    leftCount: undone.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const secret = req.headers.get('x-widget-secret');
  if (!secret || secret !== Deno.env.get('WIDGET_SECRET')) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const userId = Deno.env.get('AGENDA_USER_ID')!;
  const { data: row, error } = await admin.from('agenda_data').select('tasks, templates, completions, settings').eq('user_id', userId).maybeSingle();
  if (error || !row) { console.error(error); return json({ error: 'no data found' }, 404); }

  return json(computeWidgetBrief(row, todayEastern()));
});
