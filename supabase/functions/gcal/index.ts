// Server-side half of Google Calendar's silent refresh. The client never
// holds a refresh token — only this function does, stored in gcal_tokens
// (RLS-enabled, zero client policies; only the service-role key used here
// can touch it). Two actions:
//   exchange: one-time authorization code -> tokens (stores the refresh
//             token, returns a short-lived access token)
//   refresh:  stored refresh token -> a fresh access token, called
//             whenever the client's cached access token is missing/expired
// This never runs the OAuth *consent* UI — that's a plain redirect the
// client does itself. This function only ever talks to Google's token
// endpoint server-to-server, and to Supabase using the service role key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Sign in required.' }, 401);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return json({ error: 'Sign in required.' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (!clientSecret) return json({ error: 'Google Calendar is not configured yet (missing GOOGLE_CLIENT_SECRET secret).' }, 500);

    const body = await req.json();
    const { action, client_id } = body;
    if (!client_id) return json({ error: 'No client_id provided' }, 400);

    if (action === 'exchange') {
      const { code, redirect_uri } = body;
      if (!code || !redirect_uri) return json({ error: 'Missing code or redirect_uri' }, 400);

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id, client_secret: clientSecret, redirect_uri, grant_type: 'authorization_code' }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error('exchange error', tokenData);
        return json({ error: tokenData.error_description || tokenData.error || 'Token exchange failed' }, 400);
      }
      if (!tokenData.refresh_token) {
        // Happens if Google didn't see prompt=consent on a repeat authorization —
        // no refresh token means nothing to store for silent renewal later.
        return json({ error: "Google didn't return a refresh token — try disconnecting in your Google Account's third-party access settings, then reconnect." }, 400);
      }
      const { error: dbError } = await admin.from('gcal_tokens').upsert(
        { user_id: user.id, refresh_token: tokenData.refresh_token, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      if (dbError) { console.error('db error', dbError); return json({ error: 'Could not save the connection.' }, 500); }
      return json({ access_token: tokenData.access_token, expires_in: tokenData.expires_in });
    }

    if (action === 'refresh') {
      const { data: row, error: dbError } = await admin.from('gcal_tokens').select('refresh_token').eq('user_id', user.id).maybeSingle();
      if (dbError) { console.error('db error', dbError); return json({ error: 'Could not look up the connection.' }, 500); }
      if (!row) return json({ error: 'not_connected' }, 404);

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ refresh_token: row.refresh_token, client_id, client_secret: clientSecret, grant_type: 'refresh_token' }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error('refresh error', tokenData);
        // invalid_grant means the refresh token was revoked/expired — drop it
        // so the client gets a clean "reconnect" prompt instead of looping.
        if (tokenData.error === 'invalid_grant') {
          await admin.from('gcal_tokens').delete().eq('user_id', user.id);
          return json({ error: 'not_connected' }, 404);
        }
        return json({ error: tokenData.error_description || tokenData.error || 'Refresh failed' }, 400);
      }
      return json({ access_token: tokenData.access_token, expires_in: tokenData.expires_in });
    }

    if (action === 'disconnect') {
      await admin.from('gcal_tokens').delete().eq('user_id', user.id);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);

  } catch (e) {
    console.error(e);
    return json({ error: `Unexpected error: ${(e as Error).message}` }, 500);
  }
});
