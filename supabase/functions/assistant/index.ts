// Proxies chat/quick-add messages to Anthropic (Haiku) and turns them into
// structured agenda actions. The Anthropic key lives only in Supabase
// secrets; this function is the only thing that ever sees it. Access is
// restricted to ALLOWED_EMAIL — anyone else with a Supabase Auth account on
// this shared project (every sibling app shares it) gets a 401, since a
// valid JWT alone only proves "some signed-up user," not "Bri."
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACTIONS_TOOL = {
  name: 'emit_actions',
  description: 'Turn the user message into agenda actions plus a short reply shown in the chat.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Short natural-language reply, e.g. "Added: Go to the bank — Wednesday."' },
      actions: {
        type: 'array',
        description: 'Zero or more actions to apply. Leave empty if the message needs a clarifying question instead (put the question in reply).',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['add_task', 'add_timed_task', 'add_template', 'complete_task', 'move_task'] },
            title: { type: 'string', description: 'Task or routine title (add_task/add_timed_task/add_template).' },
            date: { type: ['string', 'null'], description: 'YYYY-MM-DD. Omit/null for add_task with no day yet (goes to the weekly sidebar), or for move_task/complete_task when not changing the date.' },
            time: { type: ['string', 'null'], description: 'HH:MM 24h, required for add_timed_task, optional for move_task.' },
            recurrence: {
              type: 'object',
              description: 'add_template only.',
              properties: {
                freq: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
                days: { type: 'array', items: { type: 'string', enum: ['sun','mon','tue','wed','thu','fri','sat'] }, description: 'weekly only' },
                day: { type: 'number', description: 'monthly only, 1-31' }
              }
            },
            task_id: { type: ['string', 'number'], description: 'complete_task/move_task only: id of an existing task from the provided context.' }
          },
          required: ['type']
        }
      }
    },
    required: ['reply', 'actions']
  }
};

function systemPrompt(todayDate: string, weekTasks: unknown[]) {
  return `You are the parser behind a personal daily-agenda app's chat and quick-add box. Turn the user's message into structured actions using the emit_actions tool. Always call emit_actions exactly once.

Today's date is ${todayDate}. Here are the tasks/events currently visible to the user this week (use their "id" for complete_task/move_task; ids like "tpl-4-2026-07-18" are recurring-routine instances and are valid targets too):
${JSON.stringify(weekTasks)}

Rules:
- Resolve relative dates ("tomorrow", "Friday", "next week") against today's date.
- "Every Saturday I take my medication" -> add_template with recurrence {freq:"weekly", days:["sat"]}.
- If a message is genuinely ambiguous (e.g. "move the bank thing to Friday" but two tasks could match, or "this Wednesday or next?"), return an empty actions array and ask a short clarifying question in reply instead of guessing.
- reply should be short and specific, e.g. "Added: Go to the bank — Wednesday." or "Moved dentist to Friday at 2pm."
- A task with no date goes to the weekly sidebar (add_task with date omitted/null) rather than being invented a date.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Sign in required.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    const allowedEmail = Deno.env.get('ALLOWED_EMAIL');
    if (!user || !allowedEmail || user.email !== allowedEmail) {
      return new Response(JSON.stringify({ error: 'Not authorized for this assistant.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { message, todayDate, weekTasks } = await req.json();
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'No message provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Assistant is not configured yet (missing ANTHROPIC_API_KEY secret).' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt(todayDate || new Date().toISOString().slice(0, 10), Array.isArray(weekTasks) ? weekTasks : []),
        messages: [{ role: 'user', content: message }],
        tools: [ACTIONS_TOOL],
        tool_choice: { type: 'tool', name: 'emit_actions' },
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic error', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: `Assistant request failed (${anthropicRes.status})` }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await anthropicRes.json();
    const toolUse = (data.content || []).find((b: { type: string }) => b.type === 'tool_use');
    if (!toolUse) {
      return new Response(JSON.stringify({ error: 'Assistant did not return a structured response.' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(toolUse.input), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: `Unexpected error: ${(e as Error).message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
