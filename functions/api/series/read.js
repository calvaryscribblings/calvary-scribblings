// INSTALMENT READS — the counter. Cloudflare Pages Function. W49, rulings 176 and 179.
//
// POST /api/series/read
//   credential:  Authorization: Bearer <Firebase ID token>   (the header ONLY — never the body)
//   body:        { inst }
//   → 200 { count, counted }
//   → 401 signed_out · 400 bad_request · 404 not_found · 409 not_released · 403 no_access
//     429 limit · 503 limiter_unavailable · 502 unavailable
//
// Ruling 176: an instalment read counts ONCE PER READER, the first time they open it, at the moment
// a story counts its read (the first page shown, or 12 seconds on the page: the Series reader,
// app/series/read/[instalmentId]/page-reader.js, decides the moment; this decides the count).
//
// NOT behind SERIES_NOTES_ENABLED: reads are the Series' own, not the room's.
//
// THE ORDER OF THE CHECKS
//   1. THE TOKEN        the uid comes from a verified ID token and from nowhere else.
//   2. THE LIMITER      _ratelimit.js, before any read that costs. Fails closed.
//   3. THE ROW          published and released, on the server clock (app/lib/series/access.js).
//   4. ACCESS           the stream's policy (app/lib/series/access.js): while seriesGateOn(now) is
//                       false everyone may read; after, the reader's membership decides. Founders
//                       always pass, as in the notes endpoint. An instalment this reader cannot
//                       open is never counted for them.
//   5. ONE CLAIM        series_read_ledger/{inst}/{uid}, a conditional PUT (functions/api/_ledger.js),
//                       then series_reads/{inst} + 1 for the winner only. Two first reads at once
//                       count once; a later read changes nothing.
//
// A read failure in 3–4 FAILS CLOSED: an unknown entitlement is not a read to count.
//
// ── LOGGING ── codes and counts only. Never a uid, a token, a name or an email.

import { json, dbBase, verifyIdToken, mintAccessToken, SCOPES, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { consume, limitResponse, capFromEnv } from '../_ratelimit.js';
import { claimOnce, bearerOf } from '../_ledger.js';
import { effectiveTier, normaliseTier } from '../../../app/lib/membership.js';
import { isReleased, policyGrantForInstalment, seriesGateOn } from '../../../app/lib/series/access.js';
import { isFounder } from '../../../app/lib/founders.js';
import { INSTALMENT_ID_RE, INSTALMENTS_PATH } from '../../../app/lib/series/schema.js';
import { readsPath, ledgerPath, readsOf } from '../../../app/lib/series/reads.js';

// THE CAPS. A reader opens an instalment a handful of times a day; a minute of 20 and a day of 300
// are far above that and far below a flood. The platform buckets bound the database writes the way
// /api/hit's do (functions/api/hit.js, THE DERIVATION): 300 a minute, 5,000 a day.
const READ_CAPS = (env, uid) => ([
  { scope: 'snread', period: 'minute', id: uid, limit: capFromEnv(env, 'SERIES_READ_UID_MINUTE_CAP', 20) },
  { scope: 'snread', period: 'day', id: uid, limit: capFromEnv(env, 'SERIES_READ_UID_DAY_CAP', 300) },
  { scope: 'snread', period: 'minute', limit: capFromEnv(env, 'SERIES_READ_GLOBAL_MINUTE_CAP', 300) },
  { scope: 'snread', period: 'day', limit: capFromEnv(env, 'SERIES_READ_GLOBAL_DAY_CAP', 5000) },
]);

const fail = (code, status) => json({ ok: false, code }, status);

export async function onRequestPost(context) {
  const { request, env } = context;
  const now = Date.now();

  // ── 1. the token ──
  const idToken = bearerOf(request);
  if (!idToken) return fail('signed_out', 401);
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[series/read] missing NEXT_PUBLIC_FIREBASE_API_KEY / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
    return fail('unavailable', 503);
  }
  let body = {};
  try { body = JSON.parse((await request.text()) || '{}') || {}; } catch { return fail('bad_request', 400); }
  const inst = body?.inst;
  if (typeof inst !== 'string' || !INSTALMENT_ID_RE.test(inst)) return fail('bad_request', 400);

  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  if (!uid) return fail('signed_out', 401);

  // ── 2. the limiter ── fails closed ──
  const verdict = await consume(context, READ_CAPS(env, uid));
  if (!verdict.ok) return limitResponse(verdict);

  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES);
  } catch (e) {
    console.error('[series/read] admin token mint failed:', e?.message);
    return fail('unavailable', 502);
  }
  const base = dbBase(env);
  const auth = { Authorization: `Bearer ${token}` };
  const url = (path) => `${base}/${path.split('/').map(encodeURIComponent).join('/')}.json`;
  const get = async (path) => {
    const res = await fetch(url(path), { headers: auth, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`RTDB GET ${res.status}`);
    return res.json();
  };
  const countNow = async () => { try { return readsOf(await get(readsPath(inst))); } catch { return null; } };

  try {
    // ── 3. the row ──
    const row = await get(`${INSTALMENTS_PATH}/${inst}`);
    if (!row || typeof row !== 'object') return fail('not_found', 404);
    if (!isReleased(row, now)) return fail('not_released', 409);

    // ── 4. access ──
    if (!isFounder(uid) && seriesGateOn(now)) {
      const [scalar, detail] = await Promise.all([get(`users/${uid}/membership`), get(`memberships/${uid}`)]);
      const grant = policyGrantForInstalment(row, {
        subscriptionTier: normaliseTier(scalar),
        effectiveTier: effectiveTier(scalar, detail, now),
        signedIn: true,
        now,
      });
      if (grant.access !== 'granted') {
        console.log(`[series/read] no_access reason=${grant.reason}`);
        return fail('no_access', 403);
      }
    }

    // ── 5. one claim ──
    const won = await claimOnce(url(ledgerPath(inst, uid)), auth);
    if (!won) return json({ count: await countNow(), counted: false });
    const inc = await fetch(url(readsPath(inst)), {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ '.sv': { increment: 1 } }),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!inc.ok) {
      console.error(`[series/read] increment failed ${inc.status}`);
      return fail('unavailable', 502);
    }
    return json({ count: await countNow(), counted: true });
  } catch (e) {
    console.error('[series/read] unavailable:', e?.message);
    return fail('unavailable', 502);
  }
}
