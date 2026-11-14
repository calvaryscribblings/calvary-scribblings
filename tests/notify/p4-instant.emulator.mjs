// P4-B3 — personal pushes leave at once, wake the phone, keep one up-to-date line, and a read clears
// the number everywhere. POST /api/notify, POST /api/push/seen and POST /api/push/drain run UNMODIFIED
// against the RTDB emulator under Cloudflare's limits (50 subrequests, 6 connections; every request,
// INCLUDING its waitUntil work, inside SUBREQUEST_BUDGET, 45). Expo is a stand-in that records what it
// is sent and when.
//
//   npm run test:notify:emulator
//
// Invented readers only. Nothing reaches production or Expo.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { install, uninstall, installLimits, loadRules, wipe, get, set, request, context, tokenFor, ENV } from '../proofs/harness.mjs';
import { handleNotify } from '../../functions/api/notify.js';
import { handleDrain, EXPO_SEND_URL, INSTANT_FLOOR } from '../../functions/api/push/drain.js';
import { handleSeen } from '../../functions/api/push/seen.js';
import { SUBREQUEST_BUDGET } from '../../functions/api/_budget.js';
import { queueKey, BADGE_KIND, BADGE_INTERVAL_MS } from '../../app/lib/pushP4.js';

/** The chosen bound: from the notify call to the push leaving, at one recipient. */
const INSTANT_BOUND_MS = 2000;

const SECRET = 'invented-drain-secret-0123456789';
const DRAIN_ENV = { ...ENV, PUSH_DRAIN_SECRET: SECRET, EXPO_ACCESS_TOKEN: 'invented-expo-token' };
const T = (iso) => Date.parse(iso);
const MIN = 60000;
const U = Object.fromEntries(['writer', 'ada', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kit']
  .map((n) => [n, `${n}${'0'.repeat(20 - n.length)}uid`]));
const TOKEN = (u, n = 1) => `ExponentPushToken[invented-${u.slice(0, 6)}-${n}]`;
const id = (n) => `-Ninvented${String(n).padStart(10, '0')}`;
const SLUG = 'invented-story';

let L, inner;
const expo = { sent: [], at: [], gate: null };

before(async () => {
  install();
  inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === EXPO_SEND_URL) {
      if (expo.gate) await expo.gate;
      const msgs = JSON.parse(init.body);
      const t = performance.now();
      for (const m of msgs) { expo.sent.push(m); expo.at.push(t); }
      const data = msgs.map((m, i) => ({ status: 'ok', id: `ticket-${expo.sent.length}-${i}` }));
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
  L = installLimits({ limit: 50, connections: 6 });
  await loadRules();
});
after(() => { L.uninstall(); globalThis.fetch = inner; uninstall(); });
beforeEach(async () => {
  await wipe();
  expo.sent.length = 0; expo.at.length = 0; expo.gate = null;
  for (const [name, uid] of Object.entries(U)) {
    await set(`users/${uid}`, { displayName: `Name-${name}`, username: name });
    await set(`usernames/${name}`, uid);
  }
  await set(`cms_stories_index/${SLUG}`, { title: 'An Invented Story', authorUid: U.writer, published: true });
});

const device = (uid, { n = 1, platform = 'ios' } = {}) =>
  set(`push_tokens/${uid}/key${n}`, { token: TOKEN(uid, n), platform, appVersion: '1.7.1', updatedAt: T('2026-11-01T00:00:00Z'), pushCaps: 1 });
const post = (pid, author, extra = {}) => set(`square_posts/${pid}`, { text: 'a post', authorUid: author, createdAt: 0, ...extra });
const queue = async () => (await get('push_queue')) || {};

/**
 * One request to notify, its waitUntil work included: the shim counts both as ONE request, as
 * workerd does. Returns when the response is ready (`answeredAt`) and when everything has settled.
 */
async function notify(as, event, subjectId, now, { env = DRAIN_ENV, armed = true } = {}) {
  L.begin();
  const stats = {};
  const t0 = performance.now();
  const { ctx, settle } = context(request('/api/notify', { body: { event, subjectId }, token: tokenFor(as) }), env);
  const res = await handleNotify(ctx, { now, stats, armed, foundersOnly: false });
  const answeredAt = performance.now();
  await settle();
  L.end();
  const used = L.calls.at(-1);
  assert.ok(used <= SUBREQUEST_BUDGET, `notify + its instant send made ${used} subrequests (budget ${SUBREQUEST_BUDGET})`);
  assert.equal(L.refused, 0);
  assert.equal(res.status, 200);
  return { ...stats, shim: used, t0, answeredAt };
}

async function seen(as, now, { env = DRAIN_ENV, armed = true, foundersOnly = false } = {}) {
  L.begin();
  const stats = {};
  const { ctx, settle } = context(request('/api/push/seen', { token: as ? tokenFor(as) : undefined }), env);
  const res = await handleSeen(ctx, { now, stats, armed, foundersOnly });
  await settle();
  L.end();
  const used = L.calls.at(-1);
  assert.ok(used <= SUBREQUEST_BUDGET, `seen made ${used} subrequests`);
  assert.equal(L.refused, 0);
  return { status: res.status, body: await res.json(), stats: { ...stats, shim: used } };
}

async function drain(now) {
  L.begin();
  const stats = {};
  const { ctx } = context(request('/api/push/drain', { token: SECRET }), DRAIN_ENV);
  const res = await handleDrain(ctx, { now, stats, foundersOnly: false });
  L.end();
  assert.ok(L.calls.at(-1) <= SUBREQUEST_BUDGET);
  return { status: res.status, body: await res.json(), stats };
}

/** Ben replies to Ada's Square post. */
async function benReplies(n, now) {
  await post(id(100), U.ada);
  await post(id(n), U.ben, { parentId: id(100), text: 'What a line.' });
  return notify(U.ben, 'square_post', id(n), now);
}

describe('item 1: instant — the push leaves when its event lands', () => {
  test(`one recipient: from the notify call to the push leaving in under ${INSTANT_BOUND_MS} ms, after the response, inside one request's budget`, async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await set(`inbox_state/${U.ada}/seenAt`, noon - 60 * MIN);
    const r = await benReplies(1, noon);
    assert.equal(expo.sent.length, 1, 'sent by the notify call itself');
    const ms = expo.at[0] - r.t0;
    console.log(`  instant, 1 recipient: notify call → push left in ${ms.toFixed(0)} ms; notify + instant send = ${r.shim} subrequests (notify alone ${r.used})`);
    assert.ok(ms < INSTANT_BOUND_MS, `${ms} ms`);
    assert.ok(r.answeredAt < expo.at[0], 'the response was ready before the push left: the event is not slowed');
    assert.equal(r.instant.sent, 1);
    assert.equal(expo.sent[0].title, 'Name-ben replied to your post');
    assert.equal(expo.sent[0].badge, 1);
    // The drain's own claims: the entry is marked, push_state recorded.
    const q = await queue();
    const e = q[queueKey(U.ada, `reply:sq:${id(1)}`)];
    assert.equal(e.state, 'sending');
    assert.equal(e.claimedFor, e.at);
    // The instant send never writes the cron's heartbeat.
    assert.equal(await get('ops/push_drain/lastRunAt'), null);
    assert.equal((await get('ops/push_drain/lastInstant')).sent, 1);
    assert.equal(await get('ops/push_drain/lease'), null, 'the lease is given back');
    // Never a second sender: the cron's next run clears the entry and sends nothing.
    const d = await drain(noon + MIN);
    assert.equal(d.stats.cleared, 1);
    assert.equal(expo.sent.length, 1);
    assert.deepEqual(await queue(), {});
  });

  test('eight recipients: notify leaves too little budget, so the minute cron takes all eight', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    const handles = ['cal', 'dee', 'eve', 'fay', 'gus', 'hal'];
    for (const h of ['writer', 'kit', 'ben', ...handles]) await device(U[h]);
    await set(`comments/${SLUG}/${id(1)}`, { text: 'first', authorUid: U.kit, authorName: 'x', createdAt: 0 });
    await set(`comments/${SLUG}/${id(2)}`, { text: 'second', authorUid: U.ben, authorName: 'x', createdAt: 0, parentId: id(1) });
    await set(`comments/${SLUG}/${id(3)}`, { text: handles.map((h) => `@${h}`).join(' '), authorUid: U.ada, authorName: 'x', createdAt: 0, parentId: id(1), replyToId: id(2) });
    const r = await notify(U.ada, 'comment', `${SLUG}/${id(3)}`, noon);
    assert.equal(r.queued, 8);
    assert.equal(r.instant.skipped, 'budget', `notify used ${r.used} of ${SUBREQUEST_BUDGET}; the instant send needs ${INSTANT_FLOOR}`);
    assert.equal(expo.sent.length, 0);
    const calls = [];
    for (let i = 0; i < 6 && expo.sent.length < 8; i++) {
      const d = await drain(noon + 30000 + i);
      calls.push(d.stats.sent);
      if (!d.body.more) break;
    }
    console.log(`  instant, 8 recipients: notify used ${r.used}, ${45 - r.used} left (< ${INSTANT_FLOOR}); 0 at once, 8 by the cron (${calls.join(' + ')} per call)`);
    assert.equal(expo.sent.length, 8);
  });

  test('between one and seven: how many recipients a notify call can still send to itself', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    const names = ['cal', 'dee', 'eve', 'fay', 'gus', 'hal'];
    const out = [];
    for (let k = 1; k <= 6; k++) {
      await wipe();
      expo.sent.length = 0; expo.at.length = 0;
      for (const [name, uid] of Object.entries(U)) { await set(`users/${uid}`, { displayName: `Name-${name}`, username: name }); await set(`usernames/${name}`, uid); }
      for (const h of names.slice(0, k)) await device(U[h]);
      await post(id(k), U.ben, { text: names.slice(0, k).map((h) => `@${h}`).join(' ') });
      const r = await notify(U.ben, 'square_post', id(k), noon);
      out.push(`${k}: ${expo.sent.length} at once`);
      for (let i = 0; i < 6 && expo.sent.length < k; i++) {
        const d = await drain(noon + 30000 + i);
        assert.equal(d.status, 200);
        if (!d.body.more) break;
      }
      assert.equal(expo.sent.length, k, 'the cron takes whatever the instant send left');
      if (k === 1) assert.equal(r.instant.sent, 1);
    }
    console.log(`  instant, Square mentions: ${out.join('; ')}`);
  });

  test('dormant: unarmed, or without the drain secret, notify only queues', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    const a = await benReplies(1, noon, {});
    await post(id(2), U.ben, { parentId: id(100) });
    const b = await notify(U.ben, 'square_post', id(2), noon, { armed: false });
    await post(id(3), U.ben, { parentId: id(100) });
    const { PUSH_DRAIN_SECRET, ...noSecret } = DRAIN_ENV;
    const c = await notify(U.ben, 'square_post', id(3), noon, { env: noSecret });
    assert.equal(a.instant.sent, 1);
    assert.equal(b.instant, undefined);
    assert.equal(c.instant, undefined);
    assert.equal(expo.sent.length, 1);
  });

  test('the instant send and the cron at the same moment: one push, never two (the lease comes before the read)', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await post(id(100), U.ada);
    for (let n = 1; n <= 5; n++) {
      // Both passes run together here, so the shim's per-request count would sum them: lifted for this test only.
      L.uninstall();
      await post(id(n), U.ben, { parentId: id(100), text: `reply ${n}` });
      const at = noon + n * 10 * MIN;
      const { ctx, settle } = context(request('/api/notify', { body: { event: 'square_post', subjectId: id(n) }, token: tokenFor(U.ben) }), DRAIN_ENV);
      const cron = context(request('/api/push/drain', { token: SECRET }), DRAIN_ENV);
      await Promise.all([
        handleNotify(ctx, { now: at, armed: true, foundersOnly: false }).then(settle),
        handleDrain(cron.ctx, { now: at, foundersOnly: false }),
      ]);
      L = installLimits({ limit: 50, connections: 6 });
      await drain(at + MIN);
      await drain(at + 2 * MIN);
      assert.equal(expo.sent.length, n, `after event ${n}: exactly ${n} pushes`);
    }
  });
});

describe('item 2: priority high on every personal push', () => {
  test('a reply, a message and a reaction all carry priority high', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await benReplies(1, noon);
    const conv = [U.ada, U.ben].sort().join('_');
    await set(`dm_messages/${conv}/${id(5)}`, { text: 'hi', senderUid: U.ben, createdAt: noon });
    await notify(U.ben, 'message', `${conv}/${id(5)}`, noon + 1000);
    await set(`square_reactions/${id(100)}/like/${U.cal}`, true);
    await notify(U.cal, 'square_reaction', `${id(100)}/like`, noon + 2000);
    assert.equal(expo.sent.length, 3);
    for (const m of expo.sent) assert.equal(m.priority, 'high');
  });
});

describe('item 3: one up-to-date line — threadId per thread, collapseId and tag per grouped record', () => {
  test('a post\'s thread: its reply and its reactions share a thread; only the grouped reactions collapse, and the next line replaces the last', async () => {
    const ten = T('2026-11-14T10:00:00Z');
    await device(U.ada, { platform: 'android' });
    await benReplies(1, ten);
    await set(`square_reactions/${id(100)}/like/${U.cal}`, true);
    await notify(U.cal, 'square_reaction', `${id(100)}/like`, ten + 1000);
    await set(`square_reactions/${id(100)}/like/${U.dee}`, true);
    await notify(U.dee, 'square_reaction', `${id(100)}/like`, ten + 2000);
    await drain(ten + 61 * MIN);
    assert.equal(expo.sent.length, 3);
    const [reply, first, second] = expo.sent;
    assert.ok(reply.threadId && reply.threadId === first.threadId && first.threadId === second.threadId, 'one thread per post');
    assert.equal(reply.collapseId, undefined, 'a reply never replaces another line');
    assert.equal(reply.tag, undefined);
    assert.ok(first.collapseId && first.collapseId === second.collapseId, 'the group keeps one line');
    assert.equal(first.tag, first.collapseId);
    assert.equal(second.body, 'Name-dee and Name-cal liked your post');
    for (const m of expo.sent) assert.ok(m.threadId.length <= 64 && !m.threadId.includes(U.ada.slice(0, 6)), 'hashed, short, no uid');
  });

  test('a conversation: its pushes group together and keep one line; another conversation is another thread', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    const c1 = [U.ada, U.ben].sort().join('_');
    const c2 = [U.ada, U.cal].sort().join('_');
    await set(`dm_messages/${c1}/${id(1)}`, { text: 'x', senderUid: U.ben, createdAt: noon });
    await notify(U.ben, 'message', `${c1}/${id(1)}`, noon);
    await set(`dm_messages/${c1}/${id(2)}`, { text: 'x', senderUid: U.ben, createdAt: noon + 1000 });
    await notify(U.ben, 'message', `${c1}/${id(2)}`, noon + 1000);
    await drain(noon + 3 * MIN);
    await set(`dm_messages/${c2}/${id(3)}`, { text: 'x', senderUid: U.cal, createdAt: noon + 4 * MIN });
    await notify(U.cal, 'message', `${c2}/${id(3)}`, noon + 4 * MIN);
    assert.equal(expo.sent.length, 3);
    const [a, b, c] = expo.sent;
    assert.equal(a.threadId, b.threadId);
    assert.equal(a.collapseId, b.collapseId);
    assert.equal(b.body, 'Name-ben sent you 2 messages');
    assert.notEqual(c.threadId, a.threadId);
    assert.notEqual(c.collapseId, a.collapseId);
  });
});

describe('item 4: read once, the number clears everywhere — POST /api/push/seen', () => {
  test('a read queues a badge-only push to the reader\'s iOS phones: the new count, no title, no body, no sound', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada, { n: 1, platform: 'ios' });
    await device(U.ada, { n: 2, platform: 'android' });
    await set(`inbox_state/${U.ada}/seenAt`, noon - 1);
    const r = await seen(U.ada, noon);
    assert.equal(r.status, 200);
    assert.equal(expo.sent.length, 1, 'iOS only: Expo carries badge to iOS alone');
    assert.deepEqual(expo.sent[0], { to: TOKEN(U.ada, 1), badge: 0, priority: 'high' });
    console.log(`  seen: badge-only push sent at once, ${r.stats.shim} subrequests`);
    const state = await get(`push_state/${U.ada}`);
    assert.equal(state._day, undefined, 'not one of the twenty a day');
    assert.equal(state._badge.pushedAt, noon);
  });

  test('at most one a minute: a second read inside it waits for the minute and carries the count then', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await set(`inbox_state/${U.ada}/seenAt`, noon - 1);
    await seen(U.ada, noon);
    // A reply lands, then Ada reads again 20 seconds later (seenAt moves past it).
    await benReplies(1, noon + 10000);
    assert.equal(expo.sent.length, 2);
    assert.equal(expo.sent[1].badge, 1);
    await set(`inbox_state/${U.ada}/seenAt`, noon + 20000);
    await seen(U.ada, noon + 20000);
    assert.equal(expo.sent.length, 2, 'inside the minute: nothing yet');
    assert.equal((await queue())[queueKey(U.ada, BADGE_KIND)].dueAt, noon + BADGE_INTERVAL_MS);
    await drain(noon + 30000);
    assert.equal(expo.sent.length, 2);
    await drain(noon + BADGE_INTERVAL_MS);
    assert.equal(expo.sent.length, 3);
    assert.deepEqual(expo.sent[2], { to: TOKEN(U.ada), badge: 0, priority: 'high' });
  });

  test('dormant, founders only, signed out, never read, no iOS device: nothing is sent', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await set(`inbox_state/${U.ada}/seenAt`, noon - 1);
    assert.equal((await seen(U.ada, noon, { armed: false })).stats.queued, 0);
    assert.equal((await seen(U.ada, noon, { foundersOnly: true })).stats.queued, 0);
    assert.equal((await seen(null, noon)).status, 401);
    assert.deepEqual(await queue(), {});
    await device(U.cal);
    const never = await seen(U.cal, noon);
    assert.equal(never.stats.instant.dropped.never_seen, 1);
    await device(U.dee, { platform: 'android' });
    await set(`inbox_state/${U.dee}/seenAt`, noon - 1);
    const droid = await seen(U.dee, noon);
    assert.equal(droid.stats.instant.dropped.no_device, 1);
    assert.equal(expo.sent.length, 0);
  });
});
