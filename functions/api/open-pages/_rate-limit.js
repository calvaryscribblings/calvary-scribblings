// Open Pages — submission rate limiter (R36).
//
// WHY THIS IS NOT IN THE RULES, AND CANNOT BE.
// RTDB security rules evaluate one write against `now`, `data` and `newData`. They
// cannot count events over a period: there is no aggregation, no iteration over a
// list, and no way to say "at most five of these in the last hour". The nearest
// rules-only trick — a single lastWriteAt field pinned with `newData.val() > data.val()
// + 3600000` — enforces a MINIMUM GAP, not a rate, and would refuse an honest writer
// who publishes twice in an afternoon while doing nothing about fifteen submissions
// spread evenly across a day. So the limiter lives in the Pages Function, where the
// count can be read, evaluated and written with service credentials.
//
// Do not "move this into the rules where it belongs". It does not belong there and
// the move is not available.
//
// ⚠ THE ORDER IS THE WHOLE POINT: the check runs BEFORE the Anthropic call. A limiter
// that refuses after paying for the screen has protected nothing — the money is spent
// at the moment the request is made, not at the moment the verdict is used.
//
// The counter is a sliding window over a list of submission timestamps, not a fixed
// bucket that resets on the clock. A calendar-hour bucket lets an account submit its
// whole hourly allowance at 10:59 and the next one at 11:00 — twice the limit across
// two minutes. Keeping the timestamps costs at most DAILY_LIMIT numbers per account
// and makes "when can they write again" exactly computable rather than estimated.

export const RATE_NODE = 'open_pages_rate';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// MEASURED against the live corpus on 2026-09-04 before these were accepted:
// 7 pieces, 3 authors, mean 2.33 pieces per author across the whole record. The
// busiest rolling hour any author has ever had is 1 piece; the busiest rolling day
// is 2; the shortest gap between one author's consecutive pieces is 7.3 hours. So
// five an hour is 5x the busiest hour on record and fifteen a day is 7.5x the
// busiest day. No honest writer in this corpus comes close to either.
export const HOURLY_LIMIT = 5;
export const DAILY_LIMIT = 15;

/**
 * Decide whether a submission may proceed, from the account's recent submission
 * timestamps. PURE — no clock, no network — so the window arithmetic can be tested
 * directly instead of inferred from a live counter.
 *
 * @param {number[]} recent  Prior submission timestamps (ms). Order irrelevant.
 * @param {number} now       Date.now() at the moment of this submission.
 * @returns {{ok: true, kept: number[]} | {ok: false, scope: 'hour'|'day', retryAt: number, kept: number[]}}
 *   `kept` is the list to store: pruned to the last day, and on success including `now`.
 */
export function evaluate(recent, now) {
  // Prune to the last day. Anything older can never affect either window again, so
  // the stored list is self-limiting at DAILY_LIMIT entries without a sweep job.
  const kept = (Array.isArray(recent) ? recent : [])
    .filter((t) => typeof t === 'number' && Number.isFinite(t) && t > now - DAY_MS && t <= now)
    .sort((a, b) => a - b);

  const inHour = kept.filter((t) => t > now - HOUR_MS);

  // Hour first: it is the tighter window, and quoting the sooner of the two release
  // times is the honest answer to "when can I write again".
  if (inHour.length >= HOURLY_LIMIT) {
    return { ok: false, scope: 'hour', retryAt: inHour[0] + HOUR_MS, kept };
  }
  if (kept.length >= DAILY_LIMIT) {
    return { ok: false, scope: 'day', retryAt: kept[0] + DAY_MS, kept };
  }
  return { ok: true, kept: [...kept, now] };
}

/**
 * Human refusal copy. A writing surface must never fail silently — a submission that
 * vanishes without explanation reads as the platform losing the piece, which is the
 * worst thing this product can do to someone who has just written something.
 */
export function refusalMessage(scope, retryAt, now) {
  const mins = Math.max(1, Math.ceil((retryAt - now) / 60000));
  const when =
    mins < 60
      ? `${mins} minute${mins === 1 ? '' : 's'}`
      : `${Math.ceil(mins / 60)} hour${Math.ceil(mins / 60) === 1 ? '' : 's'}`;
  return scope === 'hour'
    ? `You've submitted ${HOURLY_LIMIT} pieces in the last hour, which is our limit. Your work is safe — copy it somewhere if you like, and try again in about ${when}.`
    : `You've submitted ${DAILY_LIMIT} pieces in the last day, which is our limit. Your work is safe — copy it somewhere if you like, and try again in about ${when}.`;
}

/**
 * Read the account's window, evaluate it, and — on success — record this submission
 * BEFORE returning, so the caller can go on to spend money.
 *
 * Recorded before rather than after on purpose: a limiter that records after the call
 * lets a burst of concurrent requests all read the same pre-call count and all pass.
 * The cost of recording first is that a screen which then fails still consumes a slot;
 * that is the safe direction to be wrong in for a spend control.
 *
 * Concurrency is handled with RTDB's conditional-write support — the read asks for an
 * ETag and the write demands it still matches — so two requests racing cannot both
 * commit a count read at the same value. One retry is enough: the loser re-reads the
 * winner's number.
 *
 * @returns {Promise<{ok: true} | {ok: false, scope: 'hour'|'day', retryAt: number}>}
 */
export async function consume(fbDb, accessToken, uid, now, fetchImpl = fetch) {
  const url = `${fbDb}/${RATE_NODE}/${uid}/recent.json`;
  const auth = { Authorization: `Bearer ${accessToken}` };

  for (let attempt = 0; attempt < 2; attempt++) {
    let recent = [];
    let etag = null;
    try {
      const res = await fetchImpl(url, { headers: { ...auth, 'X-Firebase-ETag': 'true' } });
      if (res.ok) {
        etag = res.headers.get('ETag');
        const v = await res.json();
        // RTDB stores a dense array as an object with numeric keys; both read back fine.
        if (Array.isArray(v)) recent = v.filter((x) => typeof x === 'number');
        else if (v && typeof v === 'object') recent = Object.values(v).filter((x) => typeof x === 'number');
      }
    } catch (e) {
      // FAIL OPEN on a counter read failure, and say so out loud. The alternative —
      // refusing every submission when the counter is unreachable — turns a database
      // blip into a total outage of the writing surface. The exposure while the
      // counter is down is bounded by how long it is down; the exposure from refusing
      // everyone is the product.
      console.error('[open-pages/rate] counter read failed, allowing:', e.message);
      return { ok: true, degraded: true };
    }

    const verdict = evaluate(recent, now);
    if (!verdict.ok) return { ok: false, scope: verdict.scope, retryAt: verdict.retryAt };

    try {
      const put = await fetchImpl(url, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json', ...(etag ? { 'if-match': etag } : {}) },
        body: JSON.stringify(verdict.kept),
      });
      if (put.ok) return { ok: true };
      if (put.status === 412) continue; // someone else committed first — re-read and re-decide
      console.error('[open-pages/rate] counter write failed:', put.status);
      return { ok: true, degraded: true };
    } catch (e) {
      console.error('[open-pages/rate] counter write threw, allowing:', e.message);
      return { ok: true, degraded: true };
    }
  }
  // Both attempts lost the race — that means two other submissions committed while
  // this one was deciding, which is itself evidence of a burst. Refuse conservatively.
  return { ok: false, scope: 'hour', retryAt: now + HOUR_MS };
}
