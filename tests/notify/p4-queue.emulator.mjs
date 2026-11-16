// P4-B5 — ruling 373: when one event notifies several people, all of them get the push at once.
//
// notify sends its own instant pass (P4-B3) and, when that pass leaves entries behind, ONE wake-up
// message to a Cloudflare Queue. push-drain-ping's queue() handler runs the same drain loop as its
// cron, each call a fresh /api/push/drain request with its own budget. Here the queue is a stand-in
// (it records what is sent, and can fail), the Worker is the real file, and every call it makes to
// the drain is routed to handleDrain, unmodified, against the RTDB emulator under Cloudflare's limits.
// Expo is a stand-in that records what it is sent. The clock never moves unless a test moves it.
//
//   npm run test:notify:emulator
//
// Invented readers only. Nothing reaches production, Cloudflare or Expo.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, installLimits, loadRules, wipe, get, set, request, context, tokenFor, ENV } from '../proofs/harness.mjs';
import { handleNotify } from '../../functions/api/notify.js';
import { handleDrain, EXPO_SEND_URL } from '../../functions/api/push/drain.js';
import { SUBREQUEST_BUDGET, SUBREQUEST_LIMIT } from '../../functions/api/_budget.js';
import * as P4 from '../../app/lib/pushP4.js';
import worker from '../../workers-external/push-drain-ping.worker.js';

const SECRET = 'invented-drain-secret-0123456789';
const WORKER_DRAIN = 'https://calvaryscribblings.co.uk/api/push/drain';
const WORKER_ENV = { PUSH_DRAIN_SECRET: SECRET };
const T = (iso) => Date.parse(iso);
const MIN = 60000;
const NOON = T('2026-11-14T12:00:00Z');
const U = Object.fromEntries(['writer', 'ada', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kit']
  .map((n) => [n, `${n}${'0'.repeat(20 - n.length)}uid`]));
const TOKEN = (u, n = 1) => `ExponentPushToken[invented-${u.slice(0, 6)}-${n}]`;
const id = (n) => `-Ninvented${String(n).padStart(10, '0')}`;
const SLUG = 'invented-story';

/** The stand-in queue: what notify sends, and a switch to make the send fail. */
const wakeQ = { sent: [], fail: false, async send(body) { if (this.fail) throw new Error('queue unavailable'); this.sent.push(body); } };
const env = (extra = {}) => ({ ...ENV, PUSH_DRAIN_SECRET: SECRET, EXPO_ACCESS_TOKEN: 'invented-expo-token', ...extra });
const WAKE_ENV = () => env({ PUSH_WAKE: wakeQ });

let L, inner, below;
const expo = { sent: [] };
/** What the Worker's calls to the drain did, one row per call. */
const router = { clock: 0, drains: [], workerCalls: 0, fail: false, counted: true };

// The Worker's fetch to the drain becomes one fresh /api/push/drain request: its own count under the
// limits shim, its own Budget, the test's clock.
const routeDrain = async (url, init) => {
  router.workerCalls++;
  if (router.fail) throw new Error('network went away');
  const stats = {};
  const req = new Request(url, { method: init?.method || 'GET', headers: init?.headers });
  const { ctx } = context(req, env());
  if (router.counted) L.begin();
  const res = await handleDrain(ctx, { now: router.clock, stats, foundersOnly: false });
  if (router.counted) { L.end(); assert.ok(L.calls.at(-1) <= SUBREQUEST_BUDGET, `a drain call made ${L.calls.at(-1)} subrequests`); }
  router.drains.push({ via: new URL(url).searchParams.get('via'), status: res.status, used: stats.used, sent: stats.sent });
  return res;
};
const installRouter = () => {
  below = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(WORKER_DRAIN)) return routeDrain(url, init);
    return below(input, init);
  };
};
const uninstallRouter = () => { globalThis.fetch = below; };

before(async () => {
  install();
  inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === EXPO_SEND_URL) {
      const msgs = JSON.parse(init.body);
      for (const m of msgs) expo.sent.push(m);
      const data = msgs.map((m, i) => ({ status: 'ok', id: `ticket-${expo.sent.length}-${i}` }));
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
  L = installLimits({ limit: SUBREQUEST_LIMIT, connections: 6 });
  installRouter();
  await loadRules();
});
after(() => { uninstallRouter(); L.uninstall(); globalThis.fetch = inner; uninstall(); });
beforeEach(async () => {
  await wipe();
  expo.sent.length = 0;
  wakeQ.sent.length = 0; wakeQ.fail = false;
  Object.assign(router, { clock: NOON, drains: [], workerCalls: 0, fail: false, counted: true });
  for (const [name, uid] of Object.entries(U)) {
    await set(`users/${uid}`, { displayName: `Name-${name}`, username: name });
    await set(`usernames/${name}`, uid);
  }
  await set(`cms_stories_index/${SLUG}`, { title: 'An Invented Story', authorUid: U.writer, published: true });
});

const device = (uid) =>
  set(`push_tokens/${uid}/key1`, { token: TOKEN(uid), platform: 'ios', appVersion: '1.7.1', updatedAt: T('2026-11-01T00:00:00Z'), pushCaps: 2 });
const queue = async () => (await get('push_queue')) || {};

/** One notify request, its waitUntil work included (one request, as workerd counts it). */
async function notify(as, event, subjectId, now, { e = WAKE_ENV() } = {}) {
  L.begin();
  const stats = {};
  const { ctx, settle } = context(request('/api/notify', { body: { event, subjectId }, token: tokenFor(as) }), e);
  const res = await handleNotify(ctx, { now, stats, armed: true, foundersOnly: false });
  await settle();
  L.end();
  assert.ok(L.calls.at(-1) <= SUBREQUEST_BUDGET, `notify + its instant send made ${L.calls.at(-1)} subrequests`);
  assert.equal(L.refused, 0);
  assert.equal(res.status, 200);
  return { ...stats, shim: L.calls.at(-1) };
}

/** The cron's call, as push-drain-ping makes it (no ?via). */
async function cron(now) {
  router.clock = now;
  const before = router.drains.length;
  await worker.scheduled({ cron: '* * * * *', scheduledTime: now }, WORKER_ENV, { waitUntil() {} });
  return router.drains.slice(before);
}

/** The queue delivers what notify sent: one batch, to the real Worker's queue(). */
async function deliver({ attempts = 1, now = NOON } = {}) {
  router.clock = now;
  const messages = wakeQ.sent.splice(0).map((body, i) => ({ id: `m${i}`, timestamp: new Date(now), body, attempts }));
  const batch = {
    queue: 'push-wake', messages, acked: false, retried: null,
    ackAll() { this.acked = true; }, retryAll(o = {}) { this.retried = o; },
  };
  const before = router.drains.length;
  await worker.queue?.(batch, WORKER_ENV, { waitUntil() {} });
  return { batch, drains: router.drains.slice(before) };
}

/** Eight recipients of one comment: the story's writer, the reader it answers, and six mentions (kit, who began the thread, has a phone and is not one). */
async function eightRecipients() {
  const handles = ['cal', 'dee', 'eve', 'fay', 'gus', 'hal'];
  for (const h of ['writer', 'kit', 'ben', ...handles]) await device(U[h]);
  await set(`comments/${SLUG}/${id(1)}`, { text: 'first', authorUid: U.kit, authorName: 'x', createdAt: 0 });
  await set(`comments/${SLUG}/${id(2)}`, { text: 'second', authorUid: U.ben, authorName: 'x', createdAt: 0, parentId: id(1) });
  await set(`comments/${SLUG}/${id(3)}`, { text: handles.map((h) => `@${h}`).join(' '), authorUid: U.ada, authorName: 'x', createdAt: 0, parentId: id(1), replyToId: id(2) });
  return { tokens: ['writer', 'ben', ...handles].map((h) => TOKEN(U[h])), go: (now = NOON, o) => notify(U.ada, 'comment', `${SLUG}/${id(3)}`, now, o) };
}

const onceEach = (tokens) => {
  const got = expo.sent.map((m) => m.to).sort();
  assert.deepEqual(got, [...tokens].sort(), 'every recipient exactly once');
};

describe('373: every recipient\'s push leaves at once', () => {
  test('eight recipients: notify wakes the queue once, and the queue\'s drain sends the other seven… all eight, the clock unmoved', async () => {
    const { tokens, go } = await eightRecipients();
    const r = await go();
    assert.equal(r.queued, 8);
    assert.equal(wakeQ.sent.length, 1, 'one wake-up for the event, not one per recipient');
    const { batch, drains } = await deliver();
    assert.equal(expo.sent.length, 8, `all eight at once (${expo.sent.length})`);
    onceEach(tokens);
    assert.ok(drains.length >= 1 && drains.every((d) => d.status === 200 && d.used <= SUBREQUEST_BUDGET), JSON.stringify(drains));
    assert.ok(drains.every((d) => d.via === 'wake'));
    assert.ok(router.workerCalls <= 20 && router.workerCalls < SUBREQUEST_LIMIT);
    assert.equal(batch.acked, true);
    assert.equal(batch.retried, null);
    console.log(`  373, 8 recipients: notify ${r.shim} subrequests (+1 queue send = ${r.wake?.used}), then ${drains.length} drain call(s) sending ${drains.map((d) => d.sent).join(' + ')}, each ≤ ${Math.max(...drains.map((d) => d.used))} subrequests`);
    // The cron's next run finds nothing to send.
    await cron(NOON + MIN);
    assert.equal(expo.sent.length, 8);
  });

  test('two to six Square mentions (MENTION_CAP is six): every one at once', async () => {
    const names = ['cal', 'dee', 'eve', 'fay', 'gus', 'hal'];
    const out = [];
    for (const k of [2, 4, 6]) {
      await wipe();
      expo.sent.length = 0; wakeQ.sent.length = 0;
      for (const [name, uid] of Object.entries(U)) { await set(`users/${uid}`, { displayName: `Name-${name}`, username: name }); await set(`usernames/${name}`, uid); }
      for (const h of names.slice(0, k)) await device(U[h]);
      await set(`square_posts/${id(k)}`, { text: names.slice(0, k).map((h) => `@${h}`).join(' '), authorUid: U.ben, createdAt: 0 });
      await notify(U.ben, 'square_post', id(k), NOON);
      const atOnce = expo.sent.length;
      await deliver();
      out.push(`${k}: ${atOnce} by notify + ${expo.sent.length - atOnce} by the wake`);
      onceEach(names.slice(0, k).map((h) => TOKEN(U[h])));
    }
    console.log(`  373, Square mentions: ${out.join('; ')}`);
  });

  test('the wake-up carries nothing about anyone: no uid, no key, no words', async () => {
    const { go } = await eightRecipients();
    await go();
    assert.equal(wakeQ.sent.length, 1);
    const body = JSON.stringify(wakeQ.sent[0]);
    assert.equal(wakeQ.sent[0], P4.WAKE_MESSAGE);
    for (const uid of Object.values(U)) assert.ok(!body.includes(uid.slice(0, 6)));
    assert.ok(!/push_queue|~|reply|mention|comment/.test(body));
  });

  test('the cron at the same moment as the wake: every push once, never twice', async () => {
    const { tokens, go } = await eightRecipients();
    await go();
    // Both run together here, so the shim's one-request count would sum them: lifted for this
    // step only. Each drain's own Budget still reports its count.
    router.counted = false;
    uninstallRouter(); L.uninstall(); installRouter();
    await Promise.all([deliver(), cron(NOON)]);
    uninstallRouter(); L = installLimits({ limit: SUBREQUEST_LIMIT, connections: 6 }); installRouter();
    router.counted = true;
    // Whatever either left (a 409 from the lease), the next minutes take; nothing is sent again.
    await cron(NOON + MIN);
    await cron(NOON + 2 * MIN);
    assert.equal(expo.sent.length, 8);
    onceEach(tokens);
    assert.ok(router.drains.every((d) => d.used <= SUBREQUEST_BUDGET));
  });

  test('the queue send fails: notify answers as ever, nothing is lost, and the cron sends each push once', async () => {
    const { tokens, go } = await eightRecipients();
    wakeQ.fail = true;
    const r = await go();
    assert.equal(r.wake?.sent, false);
    assert.equal(Object.keys(await queue()).length, 8, 'every entry still queued');
    await cron(NOON + MIN);
    onceEach(tokens);
  });

  test('the drain\'s lease is held: the wake retries within the minute, and after three tries leaves it to the cron', async () => {
    const { tokens, go } = await eightRecipients();
    await go();
    await set('ops/push_drain/lease', { until: NOON + 50 * 1000 });
    const msg = wakeQ.sent[0];
    const first = await deliver();
    assert.deepEqual(first.drains.map((d) => d.status), [409]);
    assert.equal(first.batch.acked, false);
    assert.ok(first.batch.retried && first.batch.retried.delaySeconds > 0 && first.batch.retried.delaySeconds < 60, JSON.stringify(first.batch.retried));
    assert.equal(expo.sent.length, 0);
    wakeQ.sent.push(msg);
    const last = await deliver({ attempts: P4.WAKE_ATTEMPTS });
    assert.equal(last.batch.retried, null, 'the last try is not retried');
    assert.equal(last.batch.acked, true);
    await set('ops/push_drain/lease', null);
    await cron(NOON + MIN);
    onceEach(tokens);
  });

  test('the drain can\'t be reached: the wake retries; it never throws', async () => {
    const { go } = await eightRecipients();
    await go();
    router.fail = true;
    const { batch } = await deliver();
    assert.ok(batch.retried && batch.retried.delaySeconds < 60);
    router.fail = false;
  });

  test('a wake-driven drain keeps the cron\'s heartbeat honest: lastWake, never lastRunAt', async () => {
    const { go } = await eightRecipients();
    await go();
    await deliver();
    assert.equal(await get('ops/push_drain/lastRunAt'), null);
    assert.equal((await get('ops/push_drain/lastWake'))?.at, NOON);
    await cron(NOON + MIN);
    assert.equal(await get('ops/push_drain/lastRunAt'), NOON + MIN);
  });
});

describe('373: with no queue binding, or nothing left behind, notify is exactly as before', () => {
  test('no binding (preview, tests, before the queue exists): no wake, and the cron takes all eight', async () => {
    const { tokens, go } = await eightRecipients();
    const r = await go(NOON, { e: env() });
    assert.equal(r.wake, undefined);
    assert.equal(r.instant.skipped, 'budget');
    assert.equal(expo.sent.length, 0);
    await cron(NOON + MIN);
    onceEach(tokens);
  });

  test('one recipient: the instant send takes it, and no wake is sent', async () => {
    await device(U.ada);
    await set(`square_posts/${id(100)}`, { text: 'a post', authorUid: U.ada, createdAt: 0 });
    await set(`square_posts/${id(1)}`, { text: 'What a line.', authorUid: U.ben, createdAt: 0, parentId: id(100) });
    const r = await notify(U.ben, 'square_post', id(1), NOON);
    assert.equal(r.instant.sent, 1);
    assert.equal(wakeQ.sent.length, 0);
    assert.equal(r.wake, undefined);
  });
});
