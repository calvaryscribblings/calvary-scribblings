// Story read-counter Pages Function.
//
//   POST /api/hit?slug=<slug>
//     signed in:   Authorization: Bearer <Firebase ID token>      → the ledger key is the uid
//     signed out:  body { readerId: <device id> } (or ?readerId=) → the ledger key is the device id
//     neither:     nothing counts
//   → { count, counted }
//
// W49, ruling 180: A READ COUNTS ONCE PER READER, and every story keeps the count it has.
//
//   · IDENTITY. A signed-in reader is the uid from a VERIFIED ID token, never from the body: a
//     body uid is just a string anyone can send. The uid is the key the ledger already holds for
//     readers counted that way, so their existing entries keep deduplicating. A token that does not
//     verify counts nothing (it does not fall back to the device id, which would be the same reader
//     counted twice under two keys).
//   · NO IDENTITY, NO COUNT. The back-compat branch that counted every request without a readerId
//     is gone. Measured W49 §0 (3–17 Oct): it counted nothing in 14 days. The app's opens went to
//     the calvary-hit-counter Worker instead, which is now count-only (workers-external/).
//   · ONE CLAIM. functions/api/_ledger.js: the ledger entry is a conditional PUT, so two hits at
//     once from one reader count once.
//   · THE DAY BUCKETS. A counted read also bumps stories/{slug}/hitsByDay/{UTC day}, the buckets
//     the hit-counter Worker's cron ranks top_stories/weekly from. Only counted reads, so the
//     weekly list ranks stories by READERS, not opens. This endpoint is now their only writer.
//
// Callers: app/lib/readHit.js (the story page and the story reader). Rate limits unchanged.
//
// This is a Cloudflare Pages Function (the deployed app is a static `output:'export'`
// build served from out/, so Next.js Route Handlers do not run as live endpoints —
// only root-level functions/ are executed by Cloudflare Pages). It mirrors the
// service-account auth used by functions/api/open-pages/moderate.js and
// functions/api/record-attempt.js: a short-lived OAuth token minted from the
// FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY Pages env vars lets the function
// write the rules-locked stories node. The increment itself is an atomic RTDB
// server-side ServerValue increment, so concurrent reads never lose updates.

import { readTelemetry, recordClient } from './_telemetry.js';
import { consume, limitResponse, clientIp, capFromEnv } from './_ratelimit.js';
import { claimOnce, bearerOf, utcDayKey } from './_ledger.js';
import { verifyIdToken } from './bookstore/_lib.js';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// ═══════════════════════════════════════════════════════════════════════════════════════
// THE CAPS, AND WHERE THE NUMBERS CAME FROM
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// This is the endpoint the Fortress Audit rated highest, and not because it is expensive:
// it is UNAUTHENTICATED, and every request becomes a database write made with
// administrative credentials that bypass the `stories: .write false` rule. RTDB's
// documented ceiling is 1,000 writes/second for the whole database, so a flood here does
// not merely inflate a counter — it takes write capacity away from purchases, sign-ups and
// comments. The existing readerId ledger is a DEDUPLICATOR, not a limiter: readerId is
// supplied by the caller, so varying it defeats the ledger entirely. (Omitting it once took a
// back-compat branch that incremented unconditionally; W49 removed it.)
//
// ── THE DERIVATION ─────────────────────────────────────────────────────────────────────
//
// Measured against the live database on 23 Aug 2026, from the hitsByDay buckets:
//
//   hits per day, whole platform     median 23 · MAX EVER 52   (10 days of buckets)
//   cumulative hits, all time        17,080 across 193 stories
//
// This is a low-volume endpoint, which makes generous caps cheap.
//
//   PER ADDRESS, PER MINUTE — 30
//   PER ADDRESS, PER DAY — 500
//     Deliberately loose, because the address is NOT a person. Many readers reach this
//     site through carrier-grade NAT — a whole mobile network can share one address — and
//     a cap tight enough to bind on one reader would lock out a city. 500 opens a day from
//     a single address is roughly ten times the ENTIRE platform's busiest day, so it can
//     only be reached by something that is not a reading population.
//
//   PLATFORM, PER MINUTE — 300
//     The one that actually protects the database. Five writes a second: about 6,000×
//     today's rate, and still less than one percent of RTDB's 1,000/second ceiling, so
//     even a fully saturated minute here cannot starve the writes that matter.
//
//   PLATFORM, PER DAY — 5,000
//     ~96× the busiest day ever recorded. A backstop against a slow flood that stays under
//     the per-minute bar.
//
// A hit that is refused is a hit that is not counted. That is the right trade: an
// undercounted story is a cosmetic loss, and an exhausted write budget is an outage.
const HIT_CAPS = (env, ip) => ([
  { scope: 'hit', period: 'minute', id: ip, limit: capFromEnv(env, 'HIT_IP_MINUTE_CAP', 30) },
  { scope: 'hit', period: 'day', id: ip, limit: capFromEnv(env, 'HIT_IP_DAY_CAP', 500) },
  { scope: 'hit', period: 'minute', limit: capFromEnv(env, 'HIT_GLOBAL_MINUTE_CAP', 300) },
  { scope: 'hit', period: 'day', limit: capFromEnv(env, 'HIT_GLOBAL_DAY_CAP', 5000) },
]);

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

  // THE CEILING, charged before anything else — before the body is parsed, before a
  // credential is minted, before the ledger is read. A refused caller costs four database
  // increments and nothing else.
  //
  // An unattributable caller is refused outright. CF-Connecting-IP is set by the edge and
  // cannot be forged by the client; if it is missing, this request cannot be counted
  // against any bucket, and on an endpoint that anyone may call, "cannot be attributed" is
  // indistinguishable from the thing the cap exists to stop.
  const ip = clientIp(request);
  if (!ip) {
    console.warn('[hit] refused: no CF-Connecting-IP on the request');
    return json({ error: 'Could not process that request.' }, 429);
  }
  const verdict = await consume(context, HIT_CAPS(env, ip));
  if (!verdict.ok) return limitResponse(verdict);

  // slug may arrive via query or a JSON body; the device id likewise. Query wins.
  let slug = (url.searchParams.get('slug') || '').trim();
  let readerId = (url.searchParams.get('readerId') || '').trim();
  // ── T2: THIS ENDPOINT IS THE DENOMINATOR ───────────────────────────────────
  // Every web open fires /api/hit, attributed by `client`; see functions/api/_telemetry.js.
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
      // No / non-JSON body: leave telemetry empty, which counts into the 'unknown' bucket.
    }
  }

  if (!slug) return json({ error: 'slug required.' }, 400);
  // slug is used as an RTDB path key — constrain to the published-slug charset.
  if (slug.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) {
    return json({ error: 'Invalid slug.' }, 400);
  }
  // W49 — "null" and "undefined" are what a missing id becomes in a query string. Both were real
  // ledger keys once; neither is a reader.
  if (readerId === 'null' || readerId === 'undefined') readerId = '';
  // A device id is a client UUID — sane charset, ≤64 chars.
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
  const notCounted = async () => json({ count: await readBackCount(), counted: false });

  // ── WHO IS READING ── the token beats the body ──────────────────────────────
  let key = null;
  const idToken = bearerOf(request);
  if (idToken) {
    if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
      console.error('[hit] NEXT_PUBLIC_FIREBASE_API_KEY is not set; a signed-in read cannot be verified');
      return notCounted();
    }
    const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
    if (!uid) return notCounted();
    key = uid;
  } else if (readerId) {
    key = readerId;
  }
  if (!key) return notCounted();

  // ── ONE CLAIM per (slug, reader) ────────────────────────────────────────────
  // storyReads/{slug}/{key} is the ledger, written only here (the admin credential bypasses
  // the rules). See functions/api/_ledger.js for why this cannot race.
  let won;
  try {
    won = await claimOnce(`${fbDb}/storyReads/${encodeURIComponent(slug)}/${encodeURIComponent(key)}.json`, auth);
  } catch (e) {
    console.error('[hit] ledger claim failed:', e.message);
    return json({ error: 'Failed to check read ledger.' }, 500);
  }
  if (!won) return notCounted();

  // The winner, and only the winner, moves the count and today's bucket — in one root PATCH.
  const updates = {
    [`stories/${slug}/hits`]: { '.sv': { increment: 1 } },
    [`stories/${slug}/hitsByDay/${utcDayKey()}`]: { '.sv': { increment: 1 } },
  };
  try {
    const patchRes = await fetch(`${fbDb}/.json`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text();
      console.error('[hit] increment failed:', patchRes.status, text.slice(0, 200));
      return json({ error: `Increment failed (${patchRes.status}).` }, 500);
    }
  } catch (e) {
    console.error('[hit] increment error:', e.message);
    return json({ error: 'Increment failed.' }, 500);
  }

  return json({ count: await readBackCount(), counted: true });
}

export async function onRequestGet(context) {
  return handle(context);
}

export async function onRequestPost(context) {
  return handle(context);
}
