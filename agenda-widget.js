// Agenda — Scriptable widget
// Shows today's date, the next timed item, and up to 3 undone tasks.
// Works as a lock-screen widget (accessoryRectangular / accessoryInline)
// or a home-screen widget (small / medium / large).
//
// SETUP (one-time): run this script from inside the Scriptable app itself
// (tap it in the script list — NOT as a widget) before adding it as a
// widget. It'll prompt once for the widget secret and store it in the iOS
// Keychain, which is shared between the app and its widget extension but
// never touches the script's own text — the secret is never written to
// disk in plain form, and isn't included if you export/share this script.

const FUNCTION_URL = 'https://zymvsdkwmdhrwjycxisr.supabase.co/functions/v1/widget-brief';
const ANON_KEY = 'sb_publishable_svwMiYGDfWnINCeo28XiLw_UIFHRUg5'; // publishable key — safe to embed, this is what it's for
const KEYCHAIN_KEY = 'agenda-widget-secret';

async function getWidgetSecret() {
  if (Keychain.contains(KEYCHAIN_KEY)) return Keychain.get(KEYCHAIN_KEY);
  if (config.runsInWidget) return null; // can't show an interactive prompt from inside a widget

  const alert = new Alert();
  alert.title = 'Agenda Widget Setup';
  alert.message = "Paste the widget secret — it's stored in the iOS Keychain, never in this script.";
  alert.addSecureTextField('Widget secret');
  alert.addAction('Save');
  alert.addCancelAction('Cancel');
  const idx = await alert.presentAlert();
  if (idx !== 0) return null;
  const secret = alert.textFieldValue(0).trim();
  if (secret) Keychain.set(KEYCHAIN_KEY, secret);
  return secret || null;
}

async function fetchBrief(secret) {
  const req = new Request(FUNCTION_URL);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'application/json', apikey: ANON_KEY, 'x-widget-secret': secret };
  req.body = '{}';
  const data = await req.loadJSON();
  if (req.response && req.response.statusCode >= 400) return { error: data.error || 'request failed' };
  return data;
}

function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`;
}
function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function buildWidget(data, family) {
  const widget = new ListWidget();
  const bg = Color.dynamic(new Color('#f9f9f7'), new Color('#0d0d0d'));
  const ink = Color.dynamic(new Color('#0b0b0b'), new Color('#ffffff'));
  const muted = new Color('#898781');
  const accent = new Color('#2a78d6');
  widget.backgroundColor = bg;

  if (!data || data.error) {
    const t = widget.addText(data && data.error === null ? 'Open the Agenda script in Scriptable to finish setup' : (data && data.error) || 'Could not load agenda');
    t.font = Font.systemFont(11);
    t.textColor = muted;
    return widget;
  }

  const label = dateLabel(data.date);

  if (family === 'accessoryRectangular') {
    const top = widget.addText(label);
    top.font = Font.boldSystemFont(13);
    widget.addSpacer(2);
    const line = widget.addText(
      data.nextTimedItem ? `${fmtTime12(data.nextTimedItem.time)} ${data.nextTimedItem.title}` : `${data.leftCount} task${data.leftCount === 1 ? '' : 's'} left`
    );
    line.font = Font.systemFont(12);
    line.lineLimit = 1;
    return widget;
  }

  if (family === 'accessoryInline') {
    widget.addText(
      data.nextTimedItem ? `${fmtTime12(data.nextTimedItem.time)} ${data.nextTimedItem.title}` : `${data.leftCount} task${data.leftCount === 1 ? '' : 's'} today`
    );
    return widget;
  }

  // Home screen (small / medium / large)
  widget.setPadding(14, 14, 14, 14);
  const header = widget.addText(label);
  header.font = Font.boldSystemFont(15);
  header.textColor = ink;
  widget.addSpacer(6);

  if (data.nextTimedItem) {
    const stack = widget.addStack();
    const dot = stack.addText('● ');
    dot.font = Font.systemFont(11);
    dot.textColor = accent;
    const txt = stack.addText(`${fmtTime12(data.nextTimedItem.time)} — ${data.nextTimedItem.title}`);
    txt.font = Font.systemFont(12);
    txt.textColor = ink;
    txt.lineLimit = 1;
  } else {
    const txt = widget.addText('Nothing timed today');
    txt.font = Font.systemFont(12);
    txt.textColor = muted;
  }
  widget.addSpacer(8);

  const tasksHeader = widget.addText(`${data.leftCount} task${data.leftCount === 1 ? '' : 's'} left`);
  tasksHeader.font = Font.mediumSystemFont(12);
  tasksHeader.textColor = muted;
  widget.addSpacer(4);

  (data.topUndoneTasks || []).slice(0, 3).forEach((title) => {
    const row = widget.addText(`• ${title}`);
    row.font = Font.systemFont(12);
    row.textColor = ink;
    row.lineLimit = 1;
  });

  return widget;
}

async function run() {
  const secret = await getWidgetSecret();
  let data;
  if (!secret) {
    data = { error: config.runsInWidget ? null : 'No widget secret set' };
  } else {
    try { data = await fetchBrief(secret); }
    catch (e) { data = { error: 'Network error' }; }
  }

  const family = config.widgetFamily || 'medium';
  const widget = buildWidget(data, family);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else if (secret) {
    if (family === 'accessoryRectangular') await widget.presentAccessoryRectangular();
    else if (family === 'accessoryInline') await widget.presentAccessoryInline();
    else await widget.presentMedium();
  }
  Script.complete();
}

await run();
