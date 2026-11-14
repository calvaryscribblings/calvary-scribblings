// P4-B3 — POST /api/push/seen: read once, the number clears everywhere (docs/PUSH-P4.md).
//
//   credential:  Authorization: Bearer <Firebase ID token>   (the header only)
//   → 200 { ok: true }   always, once signed in: whether anything was queued is never said
//   → 401 signed_out · 503 unconfigured · 502 unavailable
//
// A list (the web's bell or page; the app's, from A61) calls this AFTER it has written
// inbox_state/{uid}/seenAt. It queues one badge-only push for the reader, push_queue/{uid}~_badge,
// and sends it at once through the drain's own pass (drainNow), after the response. The drain
// counts the reader's unread rows as they stand when it goes (the bell's own count) and sends the
// number to their iOS devices with nothing to show: no title, no body, no sound. So reading on the
// website or the iPad clears the iPhone's number.
//
// AT MOST ONE A MINUTE PER READER (a chosen number, BADGE_INTERVAL_MS): a second read inside the
// minute rewrites the same entry, and the drain moves it to the minute's end, so the last read wins.
//
// DORMANT until P4_ARMED, and founders only while FOUNDERS_ONLY: nothing is written otherwise.
//
// Budget: the account lookup, the access token, one PATCH; the rest of 45 is the instant send's.
// LOGGING: codes only.

import { lookupUser, mintAccessToken, SCOPES } from '../bookstore/_lib.js';
import { notifyDb, newBudget } from '../_notify.js';
import { SUBREQUEST_BUDGET } from '../_budget.js';
import { isId } from '../../../app/lib/ids.js';
import { QUEUE, BADGE_KIND, P4_ARMED, FOUNDERS_ONLY, isFounder, queueKey, sendsNow } from '../../../app/lib/pushP4.js';
import { drainNow } from './drain.js';

const LABEL = 'push-seen';

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/**
 * @param opts.now, opts.limit, opts.stats   as notify's (tests)
 * @param opts.armed, opts.foundersOnly      tests only; production reads the switches
 */
export async function handleSeen(context, { now = Date.now(), limit = SUBREQUEST_BUDGET, stats = null, armed = P4_ARMED, foundersOnly = FOUNDERS_ONLY } = {}) {
  const { request, env } = context;
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  const idToken = m ? m[1].trim() : '';
  if (!idToken) return reply({ ok: false, code: 'signed_out' }, 401);
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] unconfigured`);
    return reply({ ok: false, code: 'unconfigured' }, 503);
  }
  const budget = newBudget(limit);
  try {
    budget.take(1);
    const account = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
    const uid = account?.localId;
    if (!isId('uid', uid)) return reply({ ok: false, code: 'signed_out' }, 401);

    // Nothing to do before arming, or for a reader the drain would drop before any read.
    if (!sendsNow(env, armed) || (foundersOnly && !isFounder(uid))) {
      if (stats) Object.assign(stats, { queued: 0, used: budget.used });
      return reply({ ok: true });
    }

    budget.take(1);
    const db = notifyDb(env, await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES), budget);
    const key = queueKey(uid, BADGE_KIND);
    // Written whole: a rewrite after a claim is a new entry (finishedWith).
    await db.patch({ [`${QUEUE}/${key}`]: { uid, rid: BADGE_KIND, kind: BADGE_KIND, at: now, dueAt: now } });
    if (stats) Object.assign(stats, { queued: 1, used: budget.used });
    if (typeof context.waitUntil === 'function') {
      const instant = stats ? (stats.instant = {}) : null;
      context.waitUntil(drainNow(db, env, { now, keys: [key], stats: instant, foundersOnly }));
    }
    return reply({ ok: true });
  } catch (e) {
    if (stats) stats.used = budget.used;
    console.error(`[${LABEL}] failed: ${e?.code || e?.message || 'error'}`);
    return reply({ ok: false, code: 'unavailable' }, 502);
  }
}

export async function onRequestPost(context) {
  return handleSeen(context, { now: Date.now() });
}
