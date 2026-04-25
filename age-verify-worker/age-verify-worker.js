// calvary-age-verify Cloudflare Worker v5
// Simple Bearer token auth — no PEM signing needed

const YOTI_BASE = 'https://age.yoti.com/api/v1';
const CALLBACK_URL = 'https://calvaryscribblings.co.uk/age-verified';
const CANCEL_URL = 'https://calvaryscribblings.co.uk';
const AGE_THRESHOLD = 18;

function corsHeaders(origin) {
  const allowed = ['https://calvaryscribblings.co.uk', 'http://localhost:3000'];
  const o = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // ── POST /create-session ────────────────────────────────────────────────
    if (url.pathname === '/create-session' && request.method === 'POST') {
      try {
        const body = await request.json();
        const referenceId = body.reference_id || 'anonymous';

        const sessionPayload = JSON.stringify({
          type: 'OVER',
          ttl: 900,
          age_estimation: { allowed: true, threshold: AGE_THRESHOLD, level: 'PASSIVE' },
          digital_id: { allowed: true, threshold: AGE_THRESHOLD, level: 'NONE' },
          doc_scan: { allowed: true, threshold: AGE_THRESHOLD, authenticity: 'AUTO', level: 'PASSIVE' },
          reference_id: referenceId,
          callback: { auto: true, url: CALLBACK_URL },
          cancel_url: CANCEL_URL,
          synchronous_checks: true,
        });

        const yotiRes = await fetch(`${YOTI_BASE}/sessions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.YOTI_API_KEY}`,
            'Content-Type': 'application/json',
            'Yoti-SDK-Id': env.YOTI_SDK_ID,
          },
          body: sessionPayload,
        });

        const responseText = await yotiRes.text();

        if (!yotiRes.ok) {
          console.error('Yoti error:', yotiRes.status, responseText);
          return new Response(JSON.stringify({
            error: 'Failed to create session',
            details: responseText,
            status: yotiRes.status,
          }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        const session = JSON.parse(responseText);
        return new Response(JSON.stringify({
          sessionId: session.id,
          launchUrl: `https://age.yoti.com?sessionId=${session.id}&sdkId=${env.YOTI_SDK_ID}`,
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });

      } catch (e) {
        console.error('Worker error:', e.message);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── GET /check-session?sessionId=xxx ────────────────────────────────────
    if (url.pathname === '/check-session' && request.method === 'GET') {
      try {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
            status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
          });
        }

        const yotiRes = await fetch(`${YOTI_BASE}/sessions/${sessionId}`, {
          headers: {
            'Authorization': `Bearer ${env.YOTI_API_KEY}`,
            'Yoti-SDK-Id': env.YOTI_SDK_ID,
          },
        });

        if (!yotiRes.ok) {
          const errText = await yotiRes.text();
          return new Response(JSON.stringify({ error: 'Failed to check session', details: errText }), {
            status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
          });
        }

        const result = await yotiRes.json();
        const passed = result.status === 'COMPLETE';
        return new Response(JSON.stringify({ status: result.status, passed }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });

      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};