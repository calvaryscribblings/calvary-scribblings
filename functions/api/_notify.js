// NOTIF-B1 (P1) — THE SERVER WRITER. One module that writes inbox/{uid}/{id}, shared by
// POST /api/notify and, in later stages, by every Function that already writes an event (the
// Square's write, Readers' Notes, Open Pages moderation, the webhooks).
//
// WHAT A RECORD HOLDS (ruling 305; NOTIF-R0 §4): uids and ids, never a name, handle or avatar.
// The bell draws the actor from their live users/{uid} record, so a record cannot impersonate
// anyone and a renamed reader is never shown under an old name.
//
//   one per event   { kind, actor, subject, at }
//   grouped         { kind, subject, count, actorCount, actors{uid:n}, recent[≤3 uids],
//                     events{key:true}, firstAt, at }
//
// `subject` is a few ids saying where the record opens ({ slug, commentId }, { postId, threadId },
// { convId }, …). Every record's id is DERIVED from its event, so a second call for the same event
// changes nothing: one-per-event records are created only if absent, and a grouped record skips an
// event key it already holds.
//
// WHO HEARS NOTHING, SILENTLY (rulings 319, 209):
//   · the actor themselves, always;
//   · anyone the actor has blocked, or who has blocked the actor;
//   · anyone who has muted the actor (muted_users/{recipient}/{actor});
//   · for a message, a reader who has muted that conversation (dm_muted).
// The caller is never told which: the endpoint answers { ok: true } either way.
//
// GROUPING (rulings 310, 318): reactions group per post, responses per story, messages per
// conversation. The grouped record is updated under its ETag, so simultaneous reactions each land
// exactly once (tests/notify/notify.emulator.mjs fires them together).
//
// THE BUDGET: every outbound call is charged before it is made, against NOTIFY_BUDGET (45), which
// leaves headroom under Cloudflare's 50. A recipient is admitted only when its checks and one write
// still fit; one that doesn't is dropped and counted, never half-written.
//
// Push is P4. `pushAllowed` and each kind's push behaviour live in app/lib/notificationKinds.js.
//
// LOGGING: codes and counts only. Never a uid, a name, a handle or any text.

// LIMITS-1 moves Budget to functions/api/_budget.js with its shared constant. Until that is on main,
// the PROOFS-R3.1 Budget (same class, same contract) is the one in the tree.
import { Budget } from './proofs/_mail.js';
import { dbBase, FIREBASE_TIMEOUT_MS } from './bookstore/_lib.js';
import { INBOX_KINDS, RECENT_ACTORS, ACTOR_SET_CAP } from '../../app/lib/notificationKinds.js';

/** Subrequests one notify call may spend: Cloudflare allows 50; 5 are headroom. */
export const NOTIFY_BUDGET = 45;
// Tries at a grouped record's ETag. Each round of a race lands at least one writer, so N readers
// reacting at once need up to N rounds; the budget, not this number, is the real bound (a retry is
// only made from budget no other recipient needs). Measured in tests/notify/notify.emulator.mjs.
export const CAS_TRIES = 16;
/** Reads a recipient costs before any write: their block list entry and their mute entry. */
const CHECK_COST = 2;

export { Budget };

// ── the database, over REST, every call charged ──────────────────────────────────────────────

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

export function notifyDb(env, token, budget) {
  const base = dbBase(env);
  const url = (path) => `${base}/${enc(path)}.json`;
  const auth = { Authorization: `Bearer ${token}` };
  const timeout = () => AbortSignal.timeout(FIREBASE_TIMEOUT_MS);
  const call = (u, init) => { budget.take(1); return fetch(u, { ...init, signal: timeout() }); };
  return {
    budget,
    async get(path) {
      const res = await call(url(path), { headers: auth });
      if (!res.ok) throw new Error(`RTDB GET ${res.status}`);
      return res.json();
    },
    async getWithEtag(path) {
      const res = await call(url(path), { headers: { ...auth, 'X-Firebase-ETag': 'true' } });
      if (!res.ok) throw new Error(`RTDB GET(etag) ${res.status}`);
      const etag = res.headers.get('ETag') || res.headers.get('etag');
      if (!etag) throw new Error('RTDB answered without an ETag');
      return { value: await res.json(), etag };
    },
    /** PUT under `ifMatch` ('null_etag' = only if absent). 'ok' | 'stale'; throws otherwise. */
    async put(path, value, ifMatch = null) {
      const headers = { ...auth, 'Content-Type': 'application/json' };
      if (ifMatch) headers['if-match'] = ifMatch;
      const res = await call(url(path), { method: 'PUT', headers, body: JSON.stringify(value) });
      if (res.status === 412) return 'stale';
      if (!res.ok) throw new Error(`RTDB PUT ${res.status}`);
      return 'ok';
    },
  };
}

// ── pure parts ────────────────────────────────────────────────────────────────────────────────

/** A database key from parts: ids and slugs only ever hold [A-Za-z0-9_-], so ':' joins them safely. */
export const recordId = (...parts) => parts.join(':');

/**
 * The next grouped record, or null when `eventKey` is already in it (a repeat changes nothing).
 * `fresh` starts the group over (a conversation the reader has looked at since).
 */
export function mergeGroup(prev, { kind, subject, actor, eventKey, now, fresh = false }) {
  const p = !fresh && prev && typeof prev === 'object' ? prev : null;
  const events = { ...(p?.events || {}) };
  if (events[eventKey]) return null;
  if (Object.keys(events).length < ACTOR_SET_CAP) events[eventKey] = true;
  // actors: uid → how many of this group's events are theirs, so a deletion can take its share out.
  const actors = { ...(p?.actors || {}) };
  const newActor = !actors[actor];
  if (!newActor) actors[actor] = (Number(actors[actor]) || 1) + 1;
  else if (Object.keys(actors).length < ACTOR_SET_CAP) actors[actor] = 1;
  const recent = [actor, ...(Array.isArray(p?.recent) ? p.recent : []).filter((u) => u !== actor)].slice(0, RECENT_ACTORS);
  const next = {
    kind,
    subject,
    count: (p?.count || 0) + 1,
    actorCount: (p?.actorCount || 0) + (newActor ? 1 : 0),
    actors,
    recent,
    events,
    firstAt: p?.firstAt || now,
    at: now,
  };
  if (p?.pushedAt) next.pushedAt = p.pushedAt;   // P4's hourly gate survives the update
  return next;
}

/**
 * Who is told, in the order given, each at most once and never the actor. The first entry for a
 * reader wins, so callers list the nearer fact first (a reply to you before a mention of you).
 */
export function dedupe(recipients, actor) {
  const seen = new Set([actor]);
  const out = [];
  for (const r of recipients || []) {
    if (!r || typeof r.uid !== 'string' || !r.uid || seen.has(r.uid)) continue;
    if (!INBOX_KINDS[r.kind]) throw new Error(`unknown kind ${r.kind}`);
    seen.add(r.uid);
    out.push(r);
  }
  return out;
}

/**
 * What one recipient costs at least: the checks, plus one write (a grouped record: one ETag read and
 * one conditional write). A recipient is admitted only when this fits; a grouped record's retries
 * after losing a race are paid from what is left once every admitted recipient's share is set aside.
 */
export function recipientCost(r) {
  return CHECK_COST + (r.silenceIf?.length || 0) + (r.freshAfterSeen ? 1 : 0) + writeCost(r);
}
const writeCost = (r) => (r.group ? 2 : 1);

async function pooled(items, width, fn) {
  let next = 0;
  const lane = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
}

// ── delivery ──────────────────────────────────────────────────────────────────────────────────

/**
 * Write each recipient's record. Three steps: admit (by budget, in order), check (blocks, mutes,
 * the conversation mute, all at once), write (one recipient at a time, so a retry can only spend
 * what no other admitted recipient still needs).
 *
 * @param db          notifyDb(...)
 * @param actor       the verified uid of who did it
 * @param recipients  [{ uid, kind, subject, id }]                       one record per event, or
 *                    [{ uid, kind, subject, group, eventKey }]           a grouped record
 *                    optional on either: silenceIf: [paths]  (any that exists silences this one)
 *                                        freshAfterSeen: true (a grouped record older than the
 *                                        reader's inbox_state/seenAt starts over)
 * @returns stats { delivered, repeated, silenced, dropped, failed }
 */
export async function deliver(db, { actor, recipients, now }) {
  const stats = { delivered: 0, repeated: 0, silenced: 0, dropped: 0, failed: 0 };
  const list = dedupe(recipients, actor);
  if (!list.length) return stats;
  const { budget } = db;

  // 1. Admit, nearest fact first, after the one read every recipient shares.
  if (!budget.fits(1 + recipientCost(list[0]))) { stats.dropped += list.length; return stats; }
  let room = budget.left - 1;
  const admitted = [];
  for (const r of list) {
    const c = recipientCost(r);
    if (c <= room) { room -= c; admitted.push(r); } else stats.dropped++;
  }

  // 2. Check. Whom the actor has blocked is one read for everyone.
  const actorBlocks = (await db.get(`blocked_users/${actor}`)) || {};
  const audible = [];
  await pooled(admitted, 6, async (r) => {
    try {
      if (actorBlocks[r.uid]) { stats.silenced++; return; }
      const checks = [`blocked_users/${r.uid}/${actor}`, `muted_users/${r.uid}/${actor}`, ...(r.silenceIf || [])];
      const [found, seenAt] = await Promise.all([
        Promise.all(checks.map((p) => db.get(p))),
        r.freshAfterSeen ? db.get(`inbox_state/${r.uid}/seenAt`) : null,
      ]);
      if (found.some((v) => v !== null && v !== false)) { stats.silenced++; return; }
      audible.push({ r, seenAt: Number(seenAt) || 0 });
    } catch (e) {
      stats.failed++;
      console.error(`[notify] a check failed: ${e?.code || e?.message || 'error'}`);
    }
  });
  audible.sort((x, y) => admitted.indexOf(x.r) - admitted.indexOf(y.r));

  // 3. Write.
  let pending = audible.reduce((n, { r }) => n + writeCost(r), 0);
  for (const { r, seenAt } of audible) {
    pending -= writeCost(r);
    try {
      const path = `inbox/${r.uid}/${r.group || r.id}`;
      if (!r.group) {
        const res = await db.put(path, { kind: r.kind, actor, subject: r.subject, at: now }, 'null_etag');
        stats[res === 'ok' ? 'delivered' : 'repeated']++;
        continue;
      }
      let done = false;
      for (let i = 0; i < CAS_TRIES && !done; i++) {
        if (i > 0 && budget.left - pending < 2) break;   // a retry never eats another recipient's share
        const { value, etag } = await db.getWithEtag(path);
        const fresh = !!(r.freshAfterSeen && value && typeof value.at === 'number' && value.at <= seenAt);
        const next = mergeGroup(value, { kind: r.kind, subject: r.subject, actor, eventKey: r.eventKey, now, fresh });
        if (!next) { stats.repeated++; done = true; break; }
        if ((await db.put(path, next, etag)) === 'ok') { stats.delivered++; done = true; }
      }
      if (!done) stats.failed++;   // lost the race every time it could afford to try
    } catch (e) {
      stats.failed++;
      console.error(`[notify] a write failed: ${e?.code || e?.message || 'error'}`);
    }
  }
  return stats;
}

export function newBudget(limit = NOTIFY_BUDGET) { return new Budget(limit); }
