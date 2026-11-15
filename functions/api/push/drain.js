// P4-B1 — POST /api/push/drain: the one sender of personal pushes (docs/PUSH-P4.md, option d).
//
//   credential:  Authorization: Bearer <PUSH_DRAIN_SECRET>       (the push-drain-ping Worker's cron)
//   ?dry=1       reads and decides everything, writes nothing and calls no one (see DRY below)
//   → 200 { ok: true, more }   more: due entries are left for another call
//   → 401 bad secret · 503 unconfigured · 409 another run holds the lease · 502 unavailable
//
// TWO DOORS, ONE PASS (P4-B3). The cron's POST below, and drainNow, which notify and
// /api/push/seen call after their response for exactly what they just queued (the push leaves at
// once). Both run drainPass: the same lease, decisions, claim and finish. There is never a second sender.
//
// ONE PASS:
//   0. the lease, BEFORE the queue is read (P4-B3: two passes can start in the same second);
//   1. the due entries of push_queue (ordered by dueAt), oldest event first;
//   2. entries a run already finished with are cleared (at most once: a run that claimed and then
//      died is never repeated);
//   3. per entry, everything app/lib/pushP4.js decide() needs, read under the subrequest budget:
//      the record, the reader's switches and old fields (359, 362), their push state, the devices
//      (newest row wins, pushCaps), and at send time the blocks, mutes and the muted conversation,
//      and for a message its conversation's unread count (376, P4-B4);
//   4. CLAIM: one PATCH marks every entry handled and records each push in push_state, BEFORE Expo
//      is called;
//   5. one Expo request, every personal push priority high, with its threadId, and collapseId + tag
//      for a grouped record (P4-B3); a badge-only entry ({uid}~_badge) sends the number alone, to iOS;
//      tickets into push_receipts (the */15 job reads their receipts);
//   6. FINISH: one PATCH with the receipts, dead devices off every account, the heartbeat, the lease.
//
// DRY (?dry=1). Everything up to the claim, then stop: no write, no Expo, no lease. A dry run that
// claimed would consume real pushes without sending them, so dry means read-only. `stats.messages`
// carries what would have gone (tests only; never in the response).
//
// THE BUDGET. Planned to SUBREQUEST_BUDGET (45) like every Function. An entry is started only when
// its worst case still fits beside the reserve (claim, send, finish, the shared announcements read);
// what doesn't fit waits for the next call (`more: true`), which the Worker makes at once.
//
// LOGGING: codes and counts only. Never a uid, a token, a name or any words.

import { mintAccessToken, SCOPES } from '../bookstore/_lib.js';
import { notifyDb, newBudget } from '../_notify.js';
import { SUBREQUEST_BUDGET } from '../_budget.js';
import { READ_LIMITS } from '../../../app/lib/bell.js';
import {
  QUEUE, STATE, DAY_KEY, DRAIN_OPS, LEASE_MS, QUEUE_READ_LIMIT, EXPO_BATCH, FOUNDERS_ONLY,
  BADGE_KIND, BADGE_KEY, decide, decideBadge, devicesFor, rowsHolding, isFounder, nextDay, finishedWith, namedActors, queueKey,
  conversationRead, DM_READ_GRACE_MS,
} from '../../../app/lib/pushP4.js';
import { INBOX_KINDS } from '../../../app/lib/notificationKinds.js';
import { rowFor, needs, pushWords, badgeFor } from '../../../app/lib/pushWords.js';

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const LABEL = 'push-drain';

/** The claim, the Expo send, the finish, and the one shared announcements read. */
const RESERVE = 4;
/** A reader's reads, first time they appear: switches, old mention field, push state, mutes, blocks, seenAt, badge. */
const READER_COST = 7;
/**
 * An entry's reads, worst case: the record, two actors' blocks, the muted conversation, two names, one
 * detail. A message (P4-B4) adds its conversation's unread count but has one actor and no detail.
 */
const ENTRY_COST = 7;
/** The instant send starts only with room for the lease (2), its query (1), the devices (1), one reader, one entry and the reserve. */
export const INSTANT_FLOOR = 4 + READER_COST + ENTRY_COST + RESERVE;

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * @param opts.now    the clock (tests pin it)
 * @param opts.limit  the budget (45)
 * @param opts.stats  filled with what happened, for tests: never sent to the caller
 * @param opts.foundersOnly  tests only; production always reads FOUNDERS_ONLY (onRequestPost passes nothing)
 */
export async function handleDrain(context, { now = Date.now(), limit = SUBREQUEST_BUDGET, stats = null, foundersOnly = FOUNDERS_ONLY } = {}) {
  const { request, env } = context;
  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const S = stats || {};
  Object.assign(S, { dry, due: 0, cleared: 0, sent: 0, devices: 0, later: 0, dropped: {}, messages: [] });

  if (!env.PUSH_DRAIN_SECRET) { console.error(`[${LABEL}] unconfigured: no drain secret`); return reply({ ok: false, code: 'unconfigured' }, 503); }
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  if (!sameSecret(m ? m[1].trim() : '', env.PUSH_DRAIN_SECRET)) return reply({ ok: false, code: 'signed_out' }, 401);
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || (!dry && !env.EXPO_ACCESS_TOKEN)) {
    console.error(`[${LABEL}] unconfigured`);
    return reply({ ok: false, code: 'unconfigured' }, 503);
  }

  const budget = newBudget(limit);
  try {
    budget.take(1);
    const db = notifyDb(env, await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES), budget);
    const out = await drainPass(db, env, { now, dry, S, foundersOnly, keep: !!stats });
    S.used = budget.used;
    if (out.busy) return reply({ ok: false, code: 'busy' }, 409);
    return reply(dry ? { ok: true, more: out.more, dry: true } : { ok: true, more: out.more });
  } catch (e) {
    S.used = budget.used;
    console.error(`[${LABEL}] failed: ${e?.code || e?.message || 'error'}`);
    return reply({ ok: false, code: 'unavailable' }, 502);
  }
}

/**
 * P4-B3 — THE INSTANT SEND. notify (and /api/push/seen) call this from waitUntil, after their
 * response, with the db and the budget they already hold: the drain's own pass, restricted to the
 * entries the call just queued (`keys`), under the same lease and claims, so it can never be a
 * second sender. What it can't fit in the budget left over, or finds the lease held for, it leaves
 * where it is; the minute cron takes it. It never writes the cron's heartbeat (lastRunAt): that
 * stays the proof the cron runs. Never throws.
 */
export async function drainNow(db, env, { now = Date.now(), keys = [], stats = null, foundersOnly = FOUNDERS_ONLY } = {}) {
  const S = stats || {};
  Object.assign(S, { instant: true, due: 0, cleared: 0, sent: 0, devices: 0, later: 0, dropped: {}, messages: [] });
  try {
    if (!keys.length || !env?.EXPO_ACCESS_TOKEN) { S.skipped = 'unconfigured'; return S; }
    // The least one entry needs: the lease (2), the read of what was queued (1), the devices (1),
    // a reader and an entry, and the reserve.
    if (db.budget.left < INSTANT_FLOOR) { S.skipped = 'budget'; return S; }
    const out = await drainPass(db, env, { now, dry: false, S, foundersOnly, keys, keep: !!stats });
    if (out.busy) S.skipped = 'busy';
    S.more = out.more;
  } catch (e) {
    S.failed = true;
    console.error(`[${LABEL}] instant failed: ${e?.code || e?.message || 'error'}`);
  }
  S.used = db.budget.used;
  return S;
}

/**
 * One pass of the drain. `keys` given: only those queue entries (the instant send); otherwise every
 * due entry (the cron). Returns { more, busy }.
 *
 * THE LEASE COMES BEFORE THE READ. A pass reads the queue only once it holds the lease, so it never
 * acts on entries another pass finished while it waited (now that notify sends too, two passes can
 * start in the same second). The cron pays one query more for it when the queue isn't empty.
 */
async function drainPass(db, env, { now, dry, S, foundersOnly, keys = null, keep = false }) {
  const { budget } = db;
  const instant = Array.isArray(keys);
  const readDue = async () => {
    if (!instant) return (await db.query(QUEUE, { orderBy: '"dueAt"', endAt: now, limitToFirst: QUEUE_READ_LIMIT })) || {};
    // What this call just queued carries dueAt = its own clock: one indexed query reads all of it.
    const want = new Set(keys);
    const got = (await db.query(QUEUE, { orderBy: '"dueAt"', startAt: now, endAt: now, limitToFirst: QUEUE_READ_LIMIT })) || {};
    return Object.fromEntries(Object.entries(got).filter(([k]) => want.has(k)));
  };

  let due;
  if (!instant) {
    due = await readDue();
    if (!Object.keys(due).length) {
      S.due = 0;
      if (!dry) await db.patch({ [`${DRAIN_OPS}/lastRunAt`]: now });
      return { more: false };
    }
  }

  // One run at a time.
  if (!dry) {
    const { value: lease, etag } = await db.getWithEtag(`${DRAIN_OPS}/lease`);
    if (lease && Number(lease.until) > now) return { more: false, busy: true };
    if ((await db.put(`${DRAIN_OPS}/lease`, { until: now + LEASE_MS }, etag)) !== 'ok') return { more: false, busy: true };
    due = await readDue();
  }
  const finish = { [`${DRAIN_OPS}/lease`]: null };
  const beat = (o) => {
    const last = { at: now, sent: S.sent, devices: S.devices, later: S.later, cleared: S.cleared, dropped: S.dropped };
    if (instant) o[`${DRAIN_OPS}/lastInstant`] = last;
    else Object.assign(o, { [`${DRAIN_OPS}/lastRunAt`]: now, [`${DRAIN_OPS}/last`]: last });
  };

  const entries = Object.entries(due);
  S.due = entries.length;
  if (!entries.length) {
    if (!dry) { beat(finish); await db.patch(finish); }
    return { more: false };
  }

  const claim = {};
  const drop = (key, e, reason) => {
    S.dropped[reason] = (S.dropped[reason] || 0) + 1;
    Object.assign(claim, { [`${QUEUE}/${key}/state`]: 'dropped', [`${QUEUE}/${key}/reason`]: reason, [`${QUEUE}/${key}/claimedFor`]: e.at, [`${QUEUE}/${key}/claimedAt`]: now });
  };

  // Finished with by an earlier run: cleared, never repeated.
  const fresh = [];
  for (const [key, e] of entries) {
    if (finishedWith(e)) { claim[`${QUEUE}/${key}`] = null; S.cleared++; continue; }
    if (!e || typeof e.uid !== 'string' || typeof e.rid !== 'string' || key !== queueKey(e.uid, e.rid)) { claim[`${QUEUE}/${key}`] = null; S.cleared++; continue; }
    fresh.push([key, e]);
  }
  fresh.sort((a, b) => (Number(a[1].at) || 0) - (Number(b[1].at) || 0) || (a[0] < b[0] ? -1 : 1));

  const tokens = fresh.length ? ((await db.get('push_tokens')) || {}) : {};
  const readers = new Map();      // uid → what was read about them
  const cache = new Map();        // path → value, for the names and details shared across entries
  const read = async (path) => { if (!cache.has(path)) cache.set(path, await db.get(path)); return cache.get(path); };
  const counts = {};              // this run's sends per uid { n, morning }
  const sends = [];               // { key, e, record, words, devices, uid, held, badgeOnly }
  let more = Object.keys(due).length >= QUEUE_READ_LIMIT;

  const readReader = async (uid, devices) => {
    const [prefs, state, muted, blocked, seenAt] = await Promise.all([
      db.get(`notify_prefs/${uid}`), db.get(`${STATE}/${uid}`), db.get(`muted_users/${uid}`),
      db.get(`blocked_users/${uid}`), db.get(`inbox_state/${uid}/seenAt`),
    ]);
    readers.set(uid, { devices, prefs: prefs || {}, state: state || {}, muted: muted || {}, blocked: blocked || {}, seenAt: typeof seenAt === 'number' ? seenAt : null, legacy: {}, legacyRead: false });
  };

  for (const [key, e] of fresh) {
    // Cheap refusals first: no reads.
    if (foundersOnly && !isFounder(e.uid)) { drop(key, e, 'founders_only'); continue; }
    const badgeOnly = e.kind === BADGE_KIND;
    // A badge-only push changes the number and shows nothing; Expo carries `badge` to iOS only.
    const devices = devicesFor(e.uid, tokens).filter((d) => !badgeOnly || d.platform === 'ios');
    if (!devices.length) { drop(key, e, 'no_device'); continue; }
    const newReader = !readers.has(e.uid);
    if (budget.left - RESERVE < (newReader ? READER_COST : 0) + (badgeOnly ? 1 : ENTRY_COST)) { more = true; break; }
    if (newReader) await readReader(e.uid, devices);
    const reader = readers.get(e.uid);

    if (badgeOnly) {
      const d = decideBadge(e, reader.state, reader.seenAt, now);
      if (d.action === 'drop') { drop(key, e, d.reason); continue; }
      if (d.action === 'later') { claim[`${QUEUE}/${key}/dueAt`] = d.dueAt; S.later++; continue; }
      sends.push({ key, e, devices, uid: e.uid, held: false, badgeOnly: true });
      continue;
    }

    const record = await db.get(`inbox/${e.uid}/${e.rid}`);
    if (record?.kind && ['reply', 'mention', 'quote'].includes(record.kind) && !reader.legacyRead) {
      reader.legacy.mentionNotifications = await db.get(`users/${e.uid}/mentionNotifications`);
      reader.legacyRead = true;
    }
    const actors = namedActors(record);
    const actorBlocks = {};
    for (const a of actors) actorBlocks[a] = { [e.uid]: (await read(`blocked_users/${a}/${e.uid}`)) === true };
    const convId = record?.kind === 'message' ? record?.subject?.convId : null;
    const dmMuted = convId ? (await db.get(`dm_muted/${e.uid}/${convId}`)) === true : false;
    // 376: a message's conversation read since (its unread count back at 0). Read only once the
    // count can be believed (DM_READ_GRACE_MS), so a message's instant send never pays for it.
    const recAt = Number(record?.at) || Number(e.at) || 0;
    const convRead = convId && now - recAt >= DM_READ_GRACE_MS
      ? conversationRead(await db.get(`dm_conversations/${e.uid}/${convId}/unread`), recAt, now) : false;
    const decision = decide(e, record, reader.state, { ...reader, actorBlocks, dmMuted, convRead }, now, counts, { foundersOnly });
    if (decision.action === 'drop') { drop(key, e, decision.reason); continue; }
    if (decision.action === 'later') { claim[`${QUEUE}/${key}/dueAt`] = decision.dueAt; S.later++; continue; }

    // The words: the bell's own, from the record and what it names.
    const row = rowFor(e.rid, record);
    const n = needs(row, record);
    const details = { users: {}, stories: {}, quotes: {}, posts: {}, pieces: {} };
    for (const u of n.users) details.users[u] = await read(`users/${u}`);
    if (n.story) details.stories[n.story] = await read(`cms_stories_index/${n.story}`);
    if (n.quote) details.quotes[`${n.quote.slug}/${n.quote.commentId}`] = await read(`comments/${n.quote.slug}/${n.quote.commentId}/text`);
    if (n.post) {
      const p = await read(`square_posts/${n.post}`);
      details.posts[n.post] = p ? { text: p.text ?? null, withdrawn: !!p.withdrawn, removedBy: p.removedBy ?? null } : null;
    }
    if (n.piece) details.pieces[n.piece] = { title: await read(`open_pages/${n.piece}/title`) };
    const words = pushWords(row, details);
    if (!words) { drop(key, e, 'money_guard'); continue; }
    if (sends.reduce((k, s) => k + s.devices.length, 0) + devices.length > EXPO_BATCH) { more = true; break; }

    const c = counts[e.uid] || (counts[e.uid] = { n: 0, morning: 0 });
    c.n++; if (decision.held) c.morning++;
    sends.push({ key, e, record, words, devices, uid: e.uid, held: decision.held, ids: await pushIds(e.rid, record) });
    Object.assign(claim, {
      [`${QUEUE}/${key}/state`]: 'sending', [`${QUEUE}/${key}/claimedFor`]: e.at, [`${QUEUE}/${key}/claimedAt`]: now,
      [`${STATE}/${e.uid}/${e.rid}`]: { pushedAt: now, recAt: Number(record.at) || Number(e.at) || now },
    });
  }

  // A badge-only push for a reader who has a push in this run already is that push's badge.
  const withWords = new Set(sends.filter((s) => !s.badgeOnly).map((s) => s.uid));
  for (let i = sends.length - 1; i >= 0; i--) {
    const s = sends[i];
    if (s.badgeOnly && withWords.has(s.uid)) { drop(s.key, s.e, 'covered'); sends.splice(i, 1); }
  }

  // The badge: each sending reader's unread count, from their inbox and the shared announcements.
  const badges = {};
  const senders = [...new Set(sends.map((s) => s.uid))];
  const seen = senders.map((u) => readers.get(u).seenAt).filter((v) => typeof v === 'number' && v > 0);
  if (seen.length && budget.left >= RESERVE + senders.length) {
    const announcements = (await db.query('announcements', { orderBy: '"at"', startAt: Math.min(...seen) + 1, limitToLast: READ_LIMITS.announcements })) || {};
    for (const u of senders) {
      const r = readers.get(u);
      if (!(r.seenAt > 0)) continue;
      const inbox = (await db.query(`inbox/${u}`, { orderBy: '"at"', startAt: r.seenAt + 1, limitToLast: READ_LIMITS.inbox })) || {};
      const mine = Object.fromEntries(Object.entries(announcements).filter(([, a]) => Number(a?.at) > r.seenAt));
      badges[u] = badgeFor({ inbox, announcements: mine, muted: r.muted, blocked: r.blocked, seenAt: r.seenAt });
    }
  }

  // A badge-only push goes only with its number; one the budget couldn't count waits, unclaimed.
  for (let i = sends.length - 1; i >= 0; i--) {
    const s = sends[i];
    if (!s.badgeOnly) continue;
    if (typeof badges[s.uid] !== 'number') { sends.splice(i, 1); more = true; continue; }
    Object.assign(claim, {
      [`${QUEUE}/${s.key}/state`]: 'sending', [`${QUEUE}/${s.key}/claimedFor`]: s.e.at, [`${QUEUE}/${s.key}/claimedAt`]: now,
      [`${STATE}/${s.uid}/${BADGE_KEY}`]: { pushedAt: now },
    });
  }

  // The day's counters, one write per reader. A badge-only push isn't one of the twenty.
  for (const u of new Set(sends.filter((s) => !s.badgeOnly).map((s) => s.uid))) {
    const sent = sends.filter((s) => s.uid === u && !s.badgeOnly);
    claim[`${STATE}/${u}/${DAY_KEY}`] = nextDay(readers.get(u).state, now, sent.length, sent.filter((s) => s.held).length);
  }

  const messages = [];
  const who = [];
  for (const s of sends) {
    for (const d of s.devices) {
      const msg = s.badgeOnly ? badgeMessage(d.token, badges[s.uid]) : personalMessage(d.token, s.words, s.ids);
      if (!s.badgeOnly && typeof badges[s.uid] === 'number') msg.badge = badges[s.uid];
      messages.push(msg);
      who.push({ uid: s.uid, tokenKey: d.tokenKey, token: d.token });
    }
  }
  S.sent = sends.filter((s) => !s.badgeOnly).length;
  S.badges = sends.filter((s) => s.badgeOnly).length;
  S.devices = messages.length;
  S.more = more;
  if (keep) S.messages = messages.map((x) => ({ ...x }));

  if (dry) return { more };

  // 4. CLAIM, before anything leaves.
  if (Object.keys(claim).length) await db.patch(claim);

  // 5. One Expo request. One attempt: a retry after a lost answer could push twice.
  if (messages.length) {
    try {
      const res = await budget.fetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` },
        body: JSON.stringify(messages),
      });
      if (keep) S.leftAt = Date.now();
      const json = await res.json().catch(() => null);
      const tickets = Array.isArray(json?.data) ? json.data : [];
      if (!res.ok || tickets.length !== messages.length) throw new Error(`expo ${res.status}`);
      const dead = [];
      tickets.forEach((t, i) => {
        if (t?.status === 'ok' && t.id) finish[`push_receipts/${t.id}`] = { uid: who[i].uid, tokenKey: who[i].tokenKey, at: now, kind: 'personal' };
        else if (t?.details?.error === 'DeviceNotRegistered') dead.push(who[i].token);
        else S.ticketErrors = (S.ticketErrors || 0) + 1;
      });
      for (const r of rowsHolding(dead, tokens)) finish[`push_tokens/${r.uid}/${r.tokenKey}`] = null;
      S.deadDevices = dead.length;
    } catch (e) {
      // Claimed and not sent: never retried (at most once). Counted, and the heartbeat still beats.
      S.sendFailed = messages.length;
      console.error(`[${LABEL}] send failed: ${e?.code || e?.message || 'error'}`);
    }
  }
  beat(finish);
  await db.patch(finish);
  return { more };
}

/**
 * A personal push (P4-B3): high priority, so a sleeping Android phone opens a connection for it;
 * its thread (iOS stacks a conversation's, a post's thread's or a story's pushes together); and,
 * for a grouped record, one up-to-date line: collapseId (iOS replaces the shown line, Android
 * coalesces in transit) and tag (Android replaces the shown line).
 */
export function personalMessage(token, words, ids = {}) {
  const msg = { to: token, body: words.body, data: { url: words.url }, sound: 'default', channelId: words.channelId, priority: 'high' };
  if (words.title) msg.title = words.title;
  if (ids.threadId) msg.threadId = ids.threadId;
  if (ids.collapseId) { msg.collapseId = ids.collapseId; msg.tag = ids.collapseId; }
  return msg;
}

/** A badge-only push: the number and nothing else, no title, no body, no sound (iOS only). */
export const badgeMessage = (token, badge) => ({ to: token, badge, priority: 'high' });

const sha = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * The thread a record's push belongs to, by what it opens: a conversation, a Square post's thread,
 * an Open Pages piece, a story; a follow is its own thread. null when the record names none.
 */
export function threadKey(record) {
  const s = record?.subject || {};
  if (s.convId) return `dm:${s.convId}`;
  if (s.postId) return `sq:${s.threadId || s.postId}`;
  if (s.pieceId) return `op:${s.pieceId}`;
  if (s.slug) return `story:${s.slug}`;
  if (record?.kind === 'follow') return 'follow';
  return null;
}

/**
 * The ids the push carries, hashed (they ride through Apple and Google; an id may hold uids):
 * threadId per thread, and collapseId (= tag) per GROUPED record only, so a group's later line
 * replaces its earlier one and a reply never replaces another reply.
 */
export async function pushIds(rid, record) {
  const out = {};
  const t = threadKey(record);
  if (t) out.threadId = `t${await sha(t)}`;
  if (INBOX_KINDS[record?.kind]?.group) out.collapseId = `g${await sha(rid)}`;
  return out;
}

export async function onRequestPost(context) {
  return handleDrain(context, { now: Date.now() });
}
