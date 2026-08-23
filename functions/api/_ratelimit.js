// THE LIMITER. One implementation, shared by every endpoint that has something worth
// spending — money, an administrative write, or CPU.
//
// Underscore-prefixed so Pages does not route it as an endpoint — the same convention as
// functions/api/bookstore/_lib.js and functions/api/_story-body.js.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The Fortress Audit (23 Aug 2026) searched all thirty live endpoints for any form of
// throttle, quota, retry-after, CAPTCHA or App Check and found ZERO matches. Two of those
// endpoints turn a request into something that costs:
//
//   · /api/evaluate-quiz  — any signed-in reader's request becomes a paid Anthropic call,
//                           with no cap on how many. The caller supplies the essay text,
//                           so they control the input size too.
//   · /api/hit            — anyone on the internet, no sign-in at all, and the request
//                           becomes a database write made with ADMINISTRATIVE credentials,
//                           bypassing the `stories: .write false` rule. RTDB's documented
//                           ceiling is 1,000 writes/second for the whole database, and
//                           saturating it degrades everything else: purchases, sign-ups,
//                           comments.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠ IT FAILS CLOSED. THIS IS THE WHOLE POINT AND IT IS NOT NEGOTIABLE.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// A limiter that errors OPEN is not a limiter — it is a limiter with a documented bypass,
// and the bypass is "make the limiter fail", which is exactly what a flood does to a
// dependency. So every failure path here REFUSES:
//
//   · the counter store is unreachable          → refuse
//   · the counter store answers non-2xx         → refuse
//   · the credential is missing or unmintable   → refuse
//   · the response is not a number              → refuse
//   · the request times out                     → refuse
//
// `consume()` returns a decision object and NEVER throws, so a caller cannot accidentally
// swallow a limiter failure in a try/catch that was meant for something else. There is no
// argument, no environment variable and no code path that turns this into fail-open.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// COUNT FIRST, THEN DECIDE — a refused request still counts
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The increment happens before the verdict, so an actor who keeps hammering after a refusal
// keeps their own counter climbing and stays refused for the rest of the window. That is
// the conservative direction and it costs a legitimate reader nothing, because a legitimate
// reader never approaches the wall — see THE DERIVATION in each caller.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// HOW THE COUNT IS KEPT — measured, not assumed
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// RTDB's REST API returns the RESOLVED value of a server-side increment in the response
// body. Verified against the live database before this module was written:
//
//   PUT rate_limits/…/x.json  {".sv":{"increment":1}}   → 200, body: 1
//   PUT rate_limits/…/x.json  {".sv":{"increment":1}}   → 200, body: 2
//
// That is one atomic round trip that both increments the counter AND reports the new total.
// There is no read-then-write, so there is no race between two concurrent requests, and no
// compare-and-set retry loop. (RTDB does support ETag/if-match CAS — also verified, a stale
// if-match returns 412 — but it is not needed here and a retry loop under flood is exactly
// the wrong shape.)
//
// Buckets are FIXED WINDOWS, keyed by the window itself:
//
//   rate_limits/{scope}/{window}/{id}
//
// A fixed window admits at most 2× the cap across a window boundary in the worst case. That
// is understood and accepted: these caps are set far above legitimate use (multiples, not
// percentages), so a 2× edge case is still far below anything a real reader does, and a
// sliding window would need either a read of the whole window or per-request keys — both of
// which cost more than the property is worth here.
//
// ── SELF-CLEANING, DETERMINISTICALLY ───────────────────────────────────────────────────
//
// Windowed keys are garbage the moment their window closes. The sweep is not probabilistic
// and not a cron: when a GLOBAL counter comes back as exactly 1, this request is the first
// of its window, so the PREVIOUS window's whole node is deleted — once per window, by
// definition, with no coordination. The delete rides context.waitUntil() so it never adds
// latency to the response, and a failed sweep is logged and otherwise ignored: leftover
// counters are litter, not a correctness problem.

import { dbBase, mintAccessToken, FIREBASE_TIMEOUT_MS } from './bookstore/_lib.js';

/** Where the counters live. `.read: false` / `.write: false` in rules — admin writes only. */
export const RATE_LIMIT_PATH = 'rate_limits';

/** Window lengths, in milliseconds. */
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Window keys. Both are derived from the clock alone, so every edge computes the same key
 * for the same instant without talking to anything.
 *
 * The day window is UTC, deliberately: the readers are in several time zones and a
 * "local midnight" reset would mean the global ceiling reset at a different moment for
 * every caller, which is not a ceiling.
 */
export function minuteWindow(now = Date.now()) { return `m${Math.floor(now / MINUTE_MS)}`; }
export function dayWindow(now = Date.now()) { return `d${Math.floor(now / DAY_MS)}`; }

/** Seconds until the current window closes — the honest Retry-After. */
function secondsUntilWindowEnd(period, now) {
  const span = period === 'minute' ? MINUTE_MS : DAY_MS;
  return Math.max(1, Math.ceil((span - (now % span)) / 1000));
}

/**
 * A bucket to charge. `id` is the actor (a uid, an IP); omit it for a platform-wide ceiling.
 *
 *   { scope: 'evalq', period: 'day', id: uid, limit: 200 }
 *   { scope: 'evalq', period: 'day', limit: 1000 }            ← global
 */
function bucketPath(env, { scope, period, id }, now) {
  const window = period === 'minute' ? minuteWindow(now) : dayWindow(now);
  const leaf = id ? encodeURIComponent(id) : '_all';
  return `${dbBase(env)}/${RATE_LIMIT_PATH}/${scope}/${period}/${window}/${leaf}.json`;
}

function previousWindowNode(env, { scope, period }, now) {
  const span = period === 'minute' ? MINUTE_MS : DAY_MS;
  const prev = period === 'minute' ? minuteWindow(now - span) : dayWindow(now - span);
  return `${dbBase(env)}/${RATE_LIMIT_PATH}/${scope}/${period}/${prev}.json`;
}

/**
 * Charge ONE bucket and report the new total.
 *
 * Returns a number on success. Returns null on ANY failure — the caller treats null as
 * "refuse", never as "allow". A thrown error would be catchable by an unrelated try/catch
 * upstream and is therefore deliberately not used as the failure channel.
 */
async function charge(url, token) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FIREBASE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ '.sv': { increment: 1 } }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      console.error('[ratelimit] counter store refused the write:', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const value = Number(await res.text());
    // A non-numeric body means the node is not what this module thinks it is. Refuse
    // rather than guess — a limiter that cannot read its own counter is not limiting.
    if (!Number.isFinite(value)) {
      console.error('[ratelimit] counter store returned a non-numeric total');
      return null;
    }
    return value;
  } catch (e) {
    console.error('[ratelimit] counter store unreachable:', e?.name === 'AbortError' ? 'timed out' : e?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ⭑ THE ENTRY POINT.
 *
 * Charges every bucket in parallel and returns a verdict:
 *
 *   { ok: true }
 *   { ok: false, reason: 'limit',       bucket, limit, retryAfter }   ← a cap was reached
 *   { ok: false, reason: 'unavailable' }                              ← the limiter failed
 *
 * NEVER THROWS. The two failure shapes are distinguished because they deserve different
 * words to the reader: one is "you've done a lot today", the other is "we couldn't check".
 *
 * All buckets are charged even when an earlier one has already failed, because a partial
 * charge would let an actor discover which bucket is nearest its cap by timing. The cost is
 * one extra parallel request on a path that is already refusing.
 */
export async function consume(context, buckets) {
  const { env } = context;
  const now = Date.now();

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    // Loud, and refusing. A missing credential must never look like an allowance.
    console.error('[ratelimit] FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not set — refusing');
    return { ok: false, reason: 'unavailable' };
  }

  let token;
  try {
    token = await mintAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[ratelimit] could not mint a credential:', e?.message);
    return { ok: false, reason: 'unavailable' };
  }
  if (!token) return { ok: false, reason: 'unavailable' };

  const totals = await Promise.all(
    buckets.map((b) => charge(bucketPath(env, b, now), token))
  );

  // Sweep before the verdict, so a window that opens on a REFUSED request still tidies the
  // one before it. waitUntil keeps it off the response path.
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.id || totals[i] !== 1) continue;  // global buckets only, first hit of the window only
    const stale = previousWindowNode(env, b, now);
    const sweep = fetch(stale, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      .catch((e) => console.error('[ratelimit] sweep failed (harmless):', e?.message));
    if (context.waitUntil) context.waitUntil(sweep);
  }

  if (totals.some((t) => t === null)) return { ok: false, reason: 'unavailable' };

  for (let i = 0; i < buckets.length; i++) {
    if (totals[i] > buckets[i].limit) {
      const b = buckets[i];
      console.warn(`[ratelimit] ${b.scope}/${b.period}/${b.id ?? '_all'} reached ${totals[i]} of ${b.limit}`);
      return {
        ok: false,
        reason: 'limit',
        bucket: b.id ? 'actor' : 'global',
        scope: b.scope,
        limit: b.limit,
        retryAfter: secondsUntilWindowEnd(b.period, now),
      };
    }
  }

  return { ok: true };
}

/**
 * The refusal, in words a reader can act on.
 *
 * NOT "rate limit exceeded", NOT a status code with no sentence, and NOT an apology. The
 * reader is told what happened and when to come back. The two reasons say different things
 * because they ARE different things — one is about them, one is about us, and telling a
 * reader they have done too much when in fact our counter store was down would be a lie.
 *
 * `Retry-After` is a real HTTP header and some clients honour it; it is set from the actual
 * remaining window rather than a guessed constant.
 */
export function limitResponse(verdict) {
  if (verdict.reason === 'unavailable') {
    return new Response(
      JSON.stringify({
        error: "We couldn't check this just now. Please try again in a moment.",
        code: 'limiter_unavailable',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } }
    );
  }

  const message = verdict.bucket === 'global'
    ? "This is busier than usual right now. Please try again a little later."
    : "You've done a lot of these today — give it a little while, then carry on.";

  return new Response(
    JSON.stringify({ error: message, code: 'rate_limited', retryAfter: verdict.retryAfter }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(verdict.retryAfter) },
    }
  );
}

/**
 * The caller's address, as Cloudflare reports it.
 *
 * `CF-Connecting-IP` is set by the edge and cannot be spoofed by the client — unlike
 * X-Forwarded-For, which a caller can append to freely. If it is somehow absent, this
 * returns null and the caller must decide; every caller in this repo refuses, because an
 * unattributable request to an unauthenticated endpoint is exactly what a flood looks like.
 */
export function clientIp(request) {
  const ip = request.headers.get('CF-Connecting-IP');
  return ip && ip.length <= 64 ? ip : null;
}

/**
 * Read a positive integer override from the Pages environment, falling back to the derived
 * default. Every cap below is tunable without a deploy, but NONE of them is disableable:
 * a zero, a negative, a NaN or an absent value all yield the default, so there is no value
 * anyone can set that removes the ceiling.
 */
export function capFromEnv(env, name, fallback) {
  const raw = Number(env?.[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}
