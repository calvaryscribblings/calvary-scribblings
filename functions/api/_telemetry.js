// Client-adoption counters — phase T2 of STORY-SERVING-CONTRACT.md §7.
//
// Underscore-prefixed so Pages does not route it. Shared by /api/story and /api/hit.
//
// ── THE MEASUREMENT PROBLEM THIS EXISTS TO SOLVE ─────────────────────────────────
//
// T3 cuts the body out of cms_stories, and §7 says it "proceeds on a number, not on
// a schedule". The obvious way to get that number — count calls to /api/story — CAN
// NEVER PRODUCE IT, and the reason is worth stating before the code:
//
//   /api/story is only ever called by clients that have ALREADY migrated. The stale
//   fleet reads cms_stories directly and never touches it. So story-endpoint traffic
//   is a numerator with no denominator: it can grow forever and still be 5% of the
//   fleet, and nothing in it would say so.
//
// The denominator has to come from something BOTH old and new clients hit on a story
// open. That is /api/hit, the read counter — every version fires it, and its own
// header already documents the two generations ("Requests WITHOUT a readerId (old
// app binaries)"). Instrumenting THAT is what makes the share computable:
//
//   new clients  →  send client/clientVersion/updateId  →  counted by identity
//   stale fleet  →  send nothing                        →  counted as 'unknown'
//
//   adoption = 1 − (unknown share of /api/hit)
//
// The `unknown` bucket is therefore the single most important number this file
// produces, and it is the one that only exists because the old clients cannot be
// asked. Do not "clean it up" by dropping unattributed calls.
//
// ── COST, AND WHY THIS NEVER BLOCKS A RESPONSE ───────────────────────────────────
//
// One extra RTDB write per story open. It is fired through context.waitUntil() and
// never awaited on the response path, so a slow or failed counter costs a reader
// nothing. A counter that could delay a story is a counter that should not exist.
//
// Failures are swallowed and logged. Measurement must not be able to break serving.

const STATS_PATH = 'story_clients';

/**
 * The four telemetry fields, truncated and type-checked.
 *
 * Never load-bearing: no entitlement decision, no response shape, no transition
 * behaviour reads these. See contract §1.3.
 */
export function readTelemetry(body) {
  const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : '');
  return {
    client: str(body?.client, 64),
    clientVersion: str(body?.clientVersion, 32),
    updateId: str(body?.updateId, 64),
    runtime: str(body?.runtime, 32),
  };
}

// RTDB keys may not contain . $ # [ ] / or control characters. Everything outside a
// conservative allowlist becomes '-', so a hostile or merely creative client string
// cannot create a path, and two different inputs cannot collide into a key that
// looks legitimate.
const safeKey = (s) => String(s || '').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/\./g, '_').slice(0, 48) || 'unknown';

/**
 * The bucket a request counts toward.
 *
 * `unknown` when no client identified itself — which is exactly the stale fleet, and
 * the number T3 is waiting on. An updateId is included when present because an OTA
 * fleet makes clientVersion unable to distinguish today's bundle from last month's
 * (contract §1.3); it is truncated to 12 characters, which is plenty to tell two
 * bundles apart and short enough to keep the node readable.
 */
export function bucketFor(tele) {
  if (!tele || !tele.client) return 'unknown';
  const parts = [safeKey(tele.client), safeKey(tele.clientVersion || 'noversion')];
  if (tele.updateId) parts.push(safeKey(tele.updateId).slice(0, 12));
  return parts.join('__');
}

/** UTC day key, YYYY-MM-DD. UTC so buckets do not shift with the server's region. */
export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/**
 * Increment one counter. Fire-and-forget: call it inside context.waitUntil().
 *
 *   story_clients/<YYYY-MM-DD>/<surface>/<bucket> += 1
 *
 * `surface` is 'story' or 'hit'. Both are needed: 'hit' is the denominator (every
 * client version fires it) and 'story' is the migrated traffic, so the two together
 * cross-check each other rather than resting on one instrumented path.
 *
 * Uses RTDB's server-side {'.sv': {increment}} so concurrent opens never lose a
 * count — the same guarantee hit.js already relies on for its read counter.
 */
export async function recordClient({ dbUrl, token, surface, tele, now = Date.now() }) {
  try {
    const path = `${STATS_PATH}/${dayKey(now)}/${surface}/${bucketFor(tele)}`;
    const res = await fetch(`${dbUrl}/${path}.json`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ '.sv': { increment: 1 } }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  } catch (e) {
    // Swallowed on purpose. This is measurement; it must never be able to break
    // serving. Logged so a persistently broken counter is findable rather than
    // quietly producing an adoption number that is confidently wrong.
    console.error(`[telemetry] ${surface} counter failed:`, e.message || e);
  }
}
