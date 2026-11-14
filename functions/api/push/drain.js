// P4-B1 — POST /api/push/drain: the one sender of personal pushes (docs/PUSH-P4.md, option d).
//
//   credential:  Authorization: Bearer <PUSH_DRAIN_SECRET>       (the push-drain-ping Worker's cron)
//   ?dry=1       reads and decides everything, writes nothing and calls no one (see DRY below)
//   → 200 { ok: true, more }   more: due entries are left for another call
//   → 401 bad secret · 503 unconfigured · 409 another run holds the lease · 502 unavailable
//
// ONE PASS:
//   1. the due entries of push_queue (ordered by dueAt), oldest event first;
//   2. entries a run already finished with are cleared (at most once: a run that claimed and then
//      died is never repeated);
//   3. per entry, everything app/lib/pushP4.js decide() needs, read under the subrequest budget:
//      the record, the reader's switches and old fields (359, 362), their push state, the devices
//      (newest row wins, pushCaps), and at send time the blocks, mutes and the muted conversation;
//   4. CLAIM: one PATCH marks every entry handled and records each push in push_state, BEFORE Expo
//      is called;
//   5. one Expo request; tickets into push_receipts (the */15 job reads their receipts);
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
  decide, devicesFor, rowsHolding, isFounder, nextDay, finishedWith, namedActors, queueKey,
} from '../../../app/lib/pushP4.js';
import { rowFor, needs, pushWords, badgeFor } from '../../../app/lib/pushWords.js';

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const LABEL = 'push-drain';

/** The claim, the Expo send, the finish, and the one shared announcements read. */
const RESERVE = 4;
/** A reader's reads, first time they appear: switches, old mention field, push state, mutes, blocks, seenAt, badge. */
const READER_COST = 7;
/** An entry's reads, worst case: the record, two actors' blocks, the muted conversation, two names, one detail. */
const ENTRY_COST = 7;

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
    const due = (await db.query(QUEUE, { orderBy: '"dueAt"', endAt: now, limitToFirst: QUEUE_READ_LIMIT })) || {};
    const entries = Object.entries(due);
    S.due = entries.length;
    if (!entries.length) {
      if (!dry) await db.patch({ [`${DRAIN_OPS}/lastRunAt`]: now });
      S.used = budget.used;
      return reply({ ok: true, more: false });
    }

    // One run at a time.
    if (!dry) {
      const { value: lease, etag } = await db.getWithEtag(`${DRAIN_OPS}/lease`);
      if (lease && Number(lease.until) > now) { S.used = budget.used; return reply({ ok: false, code: 'busy' }, 409); }
      if ((await db.put(`${DRAIN_OPS}/lease`, { until: now + LEASE_MS }, etag)) !== 'ok') { S.used = budget.used; return reply({ ok: false, code: 'busy' }, 409); }
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
    const sends = [];               // { key, e, record, row, decision, uid }
    let more = Object.keys(due).length >= QUEUE_READ_LIMIT;

    for (const [key, e] of fresh) {
      // Cheap refusals first: no reads.
      if (foundersOnly && !isFounder(e.uid)) { drop(key, e, 'founders_only'); continue; }
      const devices = devicesFor(e.uid, tokens);
      if (!devices.length) { drop(key, e, 'no_device'); continue; }
      const newReader = !readers.has(e.uid);
      if (budget.left - RESERVE < (newReader ? READER_COST : 0) + ENTRY_COST) { more = true; break; }

      if (newReader) {
        const uid = e.uid;
        const [prefs, state, muted, blocked, seenAt] = await Promise.all([
          db.get(`notify_prefs/${uid}`), db.get(`${STATE}/${uid}`), db.get(`muted_users/${uid}`),
          db.get(`blocked_users/${uid}`), db.get(`inbox_state/${uid}/seenAt`),
        ]);
        readers.set(uid, { devices, prefs: prefs || {}, state: state || {}, muted: muted || {}, blocked: blocked || {}, seenAt: typeof seenAt === 'number' ? seenAt : null, legacy: {}, legacyRead: false });
      }
      const reader = readers.get(e.uid);
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
      const decision = decide(e, record, reader.state, { ...reader, actorBlocks, dmMuted }, now, counts, { foundersOnly });
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
      sends.push({ key, e, record, words, devices, uid: e.uid, held: decision.held });
      Object.assign(claim, {
        [`${QUEUE}/${key}/state`]: 'sending', [`${QUEUE}/${key}/claimedFor`]: e.at, [`${QUEUE}/${key}/claimedAt`]: now,
        [`${STATE}/${e.uid}/${e.rid}`]: { pushedAt: now, recAt: Number(record.at) || Number(e.at) || now },
      });
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

    // The day's counters, one write per reader.
    for (const u of senders) {
      const sent = sends.filter((s) => s.uid === u);
      claim[`${STATE}/${u}/${DAY_KEY}`] = nextDay(readers.get(u).state, now, sent.length, sent.filter((s) => s.held).length);
    }

    const messages = [];
    const who = [];
    for (const s of sends) {
      for (const d of s.devices) {
        const msg = { to: d.token, body: s.words.body, data: { url: s.words.url }, sound: 'default', channelId: s.words.channelId };
        if (s.words.title) msg.title = s.words.title;
        if (typeof badges[s.uid] === 'number') msg.badge = badges[s.uid];
        messages.push(msg);
        who.push({ uid: s.uid, tokenKey: d.tokenKey, token: d.token, kind: s.record.kind });
      }
    }
    S.sent = sends.length;
    S.devices = messages.length;
    S.more = more;
    if (stats) S.messages = messages.map((x) => ({ ...x }));

    if (dry) { S.used = budget.used; return reply({ ok: true, more, dry: true }); }

    // 4. CLAIM, before anything leaves.
    if (Object.keys(claim).length) await db.patch(claim);

    // 5. One Expo request. One attempt: a retry after a lost answer could push twice.
    const finish = { [`${DRAIN_OPS}/lastRunAt`]: now, [`${DRAIN_OPS}/lease`]: null, [`${DRAIN_OPS}/last`]: { at: now, sent: S.sent, devices: S.devices, later: S.later, cleared: S.cleared, dropped: S.dropped } };
    if (messages.length) {
      try {
        const res = await budget.fetch(EXPO_SEND_URL, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` },
          body: JSON.stringify(messages),
        });
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
    await db.patch(finish);
    S.used = budget.used;
    return reply({ ok: true, more });
  } catch (e) {
    S.used = budget.used;
    console.error(`[${LABEL}] failed: ${e?.code || e?.message || 'error'}`);
    return reply({ ok: false, code: 'unavailable' }, 502);
  }
}

export async function onRequestPost(context) {
  return handleDrain(context, { now: Date.now() });
}
