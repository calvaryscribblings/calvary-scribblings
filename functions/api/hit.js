// Story read-counter Pages Function.
//
//   POST /api/hit  { slug, readerId }  ->  { count, counted }   (deduped)
//   POST/GET /api/hit?slug=<slug>      ->  { count }            (back-compat)
//
// Replaces the /api/hit endpoint that was removed in the functions/ restructure.
// The web story/reader pages now fire this behind an engagement gate (not on
// mount) and pass a readerId so a read counts at most once per (slug, readerId):
// the ledger at storyReads/{slug}/{readerId} is checked before the counter is
// bumped. Requests WITHOUT a readerId (old app binaries) keep counting
// unconditionally — see the back-compat branch below. Callers read { count }
// (app/stories/[slug]/page-client.js and app/reader/[slug]/page-reader.js).
//
// This is a Cloudflare Pages Function (the deployed app is a static `output:'export'`
// build served from out/, so Next.js Route Handlers do not run as live endpoints —
// only root-level functions/ are executed by Cloudflare Pages). It mirrors the
// service-account auth used by functions/api/open-pages/moderate.js and
// functions/api/record-attempt.js: a short-lived OAuth token minted from the
// FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY Pages env vars lets the function
// write the rules-locked stories node. The increment itself is an atomic RTDB
// server-side ServerValue increment, so concurrent reads never lose updates —
// the same guarantee a runTransaction would give on the client SDK.

import { readTelemetry, recordClient } from './_telemetry.js';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Service-account auth — mint an OAuth access token for the Firebase Admin REST
// API (copied from functions/api/open-pages/moderate.js).
// ---------------------------------------------------------------------------

function base64url(arrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(clientEmail, privateKeyPem) {
  const pemBody = privateKeyPem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,
    ''
  );
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(
    enc.encode(
      JSON.stringify({
        iss: clientEmail,
        sub: clientEmail,
        aud: 'https://oauth2.googleapis.com/token',
        scope:
          'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
        iat: now,
        exp: now + 3600,
      })
    )
  );

  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  const jwt = `${signingInput}.${base64url(sig)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

// ---------------------------------------------------------------------------
// Handler — shared by GET and POST. Atomically bumps stories/{slug}/hits and
// returns the updated total.
// ---------------------------------------------------------------------------

async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // slug + readerId may arrive via query (old app binaries POST ?slug=…, no
  // body) or as a JSON body { slug, readerId } (current web client). Query wins.
  let slug = (url.searchParams.get('slug') || '').trim();
  let readerId = (url.searchParams.get('readerId') || '').trim();
  // ── T2: THIS ENDPOINT IS THE DENOMINATOR ───────────────────────────────────
  // Every client version fires /api/hit on a story open — including the stale
  // binaries this file's header already describes, which send no body at all. That
  // is precisely what makes it measurable: a new client identifies itself and an old
  // one cannot, so the unattributed share IS the un-migrated fleet.
  //
  // /api/story can never produce that number on its own; only clients that have
  // already migrated ever call it. See functions/api/_telemetry.js.
  let telemetry = readTelemetry(null);
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body && typeof body === 'object') {
        if (!slug && typeof body.slug === 'string') slug = body.slug.trim();
        if (!readerId && typeof body.readerId === 'string') readerId = body.readerId.trim();
        telemetry = readTelemetry(body);
      }
    } catch (e) {
      // No / non-JSON body — old app binaries send none. Fall through to query, and
      // leave telemetry empty, which counts this call into the 'unknown' bucket.
      // That is the intended reading, not a gap.
    }
  }

  if (!slug) return json({ error: 'slug required.' }, 400);
  // slug is used as an RTDB path key — constrain to the published-slug charset.
  if (slug.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) {
    return json({ error: 'Invalid slug.' }, 400);
  }
  // readerId is a Firebase uid or a client UUID — sane charset, ≤64 chars.
  if (readerId && (readerId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(readerId))) {
    return json({ error: 'Invalid readerId.' }, 400);
  }

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

  if (!clientEmail || !privateKey) {
    console.error('[hit] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    return json({ error: 'Server misconfigured.' }, 500);
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[hit] token exchange failed:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  const auth = { Authorization: `Bearer ${accessToken}` };
  const hitsPath = `${fbDb}/stories/${encodeURIComponent(slug)}/hits.json`;

  // Fire-and-forget, never awaited: a counter must not delay a read count.
  if (context.waitUntil) {
    context.waitUntil(recordClient({ dbUrl: fbDb, token: accessToken, surface: 'hit', tele: telemetry }));
  }

  // Authoritative post-write total (ServerValue.increment is applied server-side).
  const readBackCount = async () => {
    try {
      const getRes = await fetch(hitsPath, { headers: auth });
      if (getRes.ok) {
        const v = await getRes.json();
        if (typeof v === 'number') return v;
      }
    } catch (e) {
      console.warn('[hit] read-back failed:', e.message);
    }
    return null;
  };

  // ── Deduped path — one read per (slug, readerId). ─────────────────────────
  // storyReads/{slug}/{readerId} is the ledger. It is written ONLY by this
  // function (which holds the DB credential and bypasses rules); clients are
  // locked out of it (see database.rules.storyReads-fragment.json).
  if (readerId) {
    const ledgerPath = `${fbDb}/storyReads/${encodeURIComponent(slug)}/${encodeURIComponent(readerId)}.json`;
    try {
      const seenRes = await fetch(ledgerPath, { headers: auth });
      if (seenRes.ok) {
        const seen = await seenRes.json();
        if (seen !== null && seen !== undefined) {
          // Already counted this reader — return the current total untouched.
          return json({ count: await readBackCount(), counted: false });
        }
      } else {
        const text = await seenRes.text();
        console.error('[hit] ledger read failed:', seenRes.status, text.slice(0, 200));
        return json({ error: 'Failed to check read ledger.' }, 500);
      }
    } catch (e) {
      console.error('[hit] ledger read error:', e.message);
      return json({ error: 'Failed to check read ledger.' }, 500);
    }

    // First read for this reader: mark the ledger AND bump the counter in one
    // atomic root PATCH (same shape as functions/api/record-attempt.js).
    const updates = {
      [`storyReads/${slug}/${readerId}`]: { '.sv': 'timestamp' },
      [`stories/${slug}/hits`]: { '.sv': { increment: 1 } },
    };
    try {
      const patchRes = await fetch(`${fbDb}/.json`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!patchRes.ok) {
        const text = await patchRes.text();
        console.error('[hit] ledger+increment failed:', patchRes.status, text.slice(0, 200));
        return json({ error: `Increment failed (${patchRes.status}).` }, 500);
      }
    } catch (e) {
      console.error('[hit] ledger+increment error:', e.message);
      return json({ error: 'Increment failed.' }, 500);
    }

    return json({ count: await readBackCount(), counted: true });
  }

  // ── BACK-COMPAT path — no readerId: count unconditionally (old behavior). ──
  // TODO(reads-dedupe): remove this branch once the held app OTA has rolled and
  // every live binary sends a readerId. Until then, old app builds land here.
  try {
    const incRes = await fetch(hitsPath, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ '.sv': { increment: 1 } }),
    });
    if (!incRes.ok) {
      const text = await incRes.text();
      console.error('[hit] increment failed:', incRes.status, text.slice(0, 200));
      return json({ error: `Increment failed (${incRes.status}).` }, 500);
    }
  } catch (e) {
    console.error('[hit] increment error:', e.message);
    return json({ error: 'Increment failed.' }, 500);
  }

  return json({ count: await readBackCount() });
}

export async function onRequestGet(context) {
  return handle(context);
}

export async function onRequestPost(context) {
  return handle(context);
}
