// PUSH — the IO half, against the RTDB emulator, with a stand-in for Expo.
//
//   npm run test:push:emulator
//
// What a pure test cannot show: that the claim is a real transaction, so two overlapping runs
// send once; that a crash before anything leaves is retried and a crash after is not; that a
// dead device's row is actually deleted; that the seed rail stops a run cold.
//
// Admin SDK against the emulator, so rules are bypassed exactly as they are for the announcer
// in production. Nothing here can reach production: the database URL is the emulator's and
// the project id is a demo- one, which the emulator serves without credentials.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { runAnnouncer, runSeed } from '../../scripts/push/run.mjs';

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9000';
const NS = 'demo-calvary-push-default-rtdb';
const URL = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${NS}`;
assert.match(URL, /^http:\/\/(127\.0\.0\.1|localhost):\d+\?ns=demo-/, 'refusing to run anywhere but the emulator');

const NOW = Date.parse('2026-09-23T12:00:00Z');
const D = 86400000, MIN = 60000;
let appA, appB, db, db2;

before(() => {
  appA = initializeApp({ projectId: 'demo-calvary-push', databaseURL: URL }, 'push-a');
  appB = initializeApp({ projectId: 'demo-calvary-push', databaseURL: URL }, 'push-b');
  db = getDatabase(appA);
  db2 = getDatabase(appB);
});
after(async () => { await deleteApp(appA); await deleteApp(appB); });
beforeEach(async () => { await db.ref().set(null); });

const story = (over = {}) => ({
  title: 'Threshold', author: 'Dera Okaro', category: 'short', subcategory: 'Drama',
  trailerQuote: 'She kept the door open an inch.', published: true, publishedAtMs: NOW - 2 * D, ...over,
});
const token = (i, updatedAt = NOW - D) => ({ token: `ExpoPushToken[dev${i}]`, platform: 'ios', appVersion: '1.0.0', updatedAt });

/** A stand-in for Expo that records every message and answers with ok tickets. */
function fakeExpo({ dead = [], failAt = null, receipts = {} } = {}) {
  const sent = [];
  let calls = 0;
  let n = 0;
  return {
    sent,
    get calls() { return calls; },
    async sendBatch(msgs) {
      calls++;
      if (failAt !== null && calls >= failAt) throw new Error('Expo 503');
      sent.push(...msgs);
      return msgs.map((m) => (dead.includes(m.to)
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: `ticket-${++n}-${m.to.replace(/\W/g, '')}` }));
    },
    async getReceipts(ids) {
      return Object.fromEntries(ids.filter((id) => receipts[id]).map((id) => [id, receipts[id]]));
    },
  };
}
const quiet = { pause: async () => {} };

async function seedWorld(extra = {}) {
  await db.ref().update({
    'cms_stories/old-one': story({ title: 'Old One' }),
    'cms_stories/hidden-one': story({ published: false }),
    'cms_stories/tomorrow': story({ published: false, publishAt: new Date(NOW + D).toISOString() }),
    'cms_stories_index/old-one': story({ title: 'Old One' }),
    'series/bp': { title: 'Beta Princess', status: 'published' },
    'series_instalments/bp-i1': { seriesId: 'bp', ordinal: 1, status: 'published', releaseAtMs: NOW - 3 * D },
    'series_instalments/bp-i2': { seriesId: 'bp', ordinal: 2, status: 'published', releaseAtMs: NOW + 2 * D },
    'series_instalments_detail/bp-i2': { title: 'Part Two', author: 'Monica Garcia', logline: 'She survives the duel.' },
    'push_tokens/reader1/k': token(1),
    'push_tokens/reader2/k': token(2),
    'push_tokens/quiet/k': token(3),
    'users/quiet/storyNotifications': false,
    ...extra,
  });
}
const val = async (p) => (await db.ref(p).get()).val();
const publish = (slug, over = {}) => db.ref().update({
  [`cms_stories/${slug}`]: story(over), [`cms_stories_index/${slug}`]: story(over),
});

describe('the seed rail and the seed', () => {
  test('NO SEED, NO SEND — an unseeded run refuses before it reads anything else', async () => {
    await seedWorld();
    const expo = fakeExpo();
    await assert.rejects(runAnnouncer(db, expo, NOW, { apply: true, ...quiet }), /NOT SEEDED/);
    assert.equal(expo.sent.length, 0);
  });

  test('seed → run: the back catalogue sends NOTHING', async () => {
    await seedWorld();
    const plan = await runSeed(db, NOW, { apply: true });
    assert.deepEqual(plan.pending.map((p) => p.id).sort(), ['bp-i2', 'tomorrow']);
    assert.equal((await val('push_announced/story/hidden-one')).state, 'seeded');
    const expo = fakeExpo();
    const r = await runAnnouncer(db, expo, NOW, { apply: true, ...quiet });
    assert.equal(r.due.length, 0);
    assert.equal(expo.sent.length, 0);
  });

  test('the seed refuses to run twice — a late re-seed would eat announcements silently', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    await assert.rejects(runSeed(db, NOW + D, { apply: true }), /ALREADY SEEDED/);
  });

  test('a seed DRY RUN writes nothing', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: false });
    assert.equal(await val('push_announced'), null);
    assert.equal(await val('ops/push_announcer'), null);
  });
});

describe('once per item, across retries and concurrent runs', () => {
  test('a new story goes to every device whose owner has not switched off — once', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    await publish('brand-new', { title: 'Brand New' });
    const expo = fakeExpo();
    await runAnnouncer(db, expo, NOW + MIN, { apply: true, ...quiet });
    assert.deepEqual(expo.sent.map((m) => m.to).sort(), ['ExpoPushToken[dev1]', 'ExpoPushToken[dev2]']);
    assert.deepEqual(expo.sent[0], {
      to: expo.sent[0].to, title: 'Brand New',
      body: 'New short story by Dera Okaro · She kept the door open an inch.',
      data: { url: '/stories/brand-new' },
      sound: 'default', channelId: 'stories',
    });
    const entry = await val('push_announced/story/brand-new');
    assert.equal(entry.state, 'sent');
    assert.equal(entry.recipients, 2);

    // A RETRY — the next tick, and an edit to the story in between — sends nothing.
    await db.ref('cms_stories_index/brand-new/title').set('Brand New (edited)');
    const again = fakeExpo();
    await runAnnouncer(db, again, NOW + 20 * MIN, { apply: true, ...quiet });
    assert.equal(again.sent.length, 0);
  });

  test('TWO RUNS AT ONCE, on two connections — the story goes out exactly once', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    await publish('race');
    const e1 = fakeExpo(), e2 = fakeExpo();
    await Promise.all([
      runAnnouncer(db, e1, NOW + MIN, { apply: true, runId: 'one', ...quiet }),
      runAnnouncer(db2, e2, NOW + MIN, { apply: true, runId: 'two', ...quiet }),
    ]);
    assert.equal(e1.sent.length + e2.sent.length, 2, 'two devices, one notification each');
    assert.ok(e1.sent.length === 0 || e2.sent.length === 0, 'only one run may send');
  });

  test('Expo DOWN before anything left — the claim is released and the next run sends', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    await publish('retry-me');
    await assert.rejects(runAnnouncer(db, fakeExpo({ failAt: 1 }), NOW + MIN, { apply: true, ...quiet }), /503/);
    assert.equal(await val('push_announced/story/retry-me'), null);
    const expo = fakeExpo();
    await runAnnouncer(db, expo, NOW + 20 * MIN, { apply: true, ...quiet });
    assert.equal(expo.sent.length, 2);
  });

  test('Expo fails AFTER a batch left — marked partial and NEVER retried (no reader gets it twice)', async () => {
    const many = {};
    for (let i = 0; i < 150; i++) many[`push_tokens/r${i}/k`] = token(100 + i);
    await seedWorld(many);
    await runSeed(db, NOW, { apply: true });
    await publish('half-sent');
    const first = fakeExpo({ failAt: 2 });
    await assert.rejects(runAnnouncer(db, first, NOW + MIN, { apply: true, ...quiet }), /503/);
    assert.equal(first.sent.length, 100);
    const entry = await val('push_announced/story/half-sent');
    assert.equal(entry.state, 'partial');
    const second = fakeExpo();
    await runAnnouncer(db, second, NOW + 20 * MIN, { apply: true, ...quiet });
    assert.equal(second.sent.length, 0);
  });

  test('THE MASS-DIFF REFUSAL — more than --max due is a broken seed, not a busy day', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    for (let i = 0; i < 6; i++) await publish(`flood-${i}`);
    const expo = fakeExpo();
    await assert.rejects(runAnnouncer(db, expo, NOW + MIN, { apply: true, ...quiet }), /REFUSED: 6 items due/);
    assert.equal(expo.sent.length, 0);
    assert.equal(await val('push_announced/story/flood-0'), null);
  });

  test('an instalment released by the clock is announced on the next tick, in the RULED wording', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    const expo = fakeExpo();
    await runAnnouncer(db, expo, NOW + 2 * D + MIN, { apply: true, ...quiet });
    assert.equal(expo.sent.length, 2);
    assert.equal(expo.sent[0].title, 'Beta Princess');
    assert.equal(expo.sent[0].body, 'Part Two by Monica Garcia · She survives the duel.');
    assert.equal(expo.sent[0].sound, 'default');
    assert.equal(expo.sent[0].channelId, 'stories');
    assert.deepEqual(expo.sent[0].data, { url: '/series/instalment/bp-i2' });
  });

  test('a DRY RUN sends nothing and writes nothing', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    await publish('dry');
    const before = await val('push_announced');
    const expo = fakeExpo();
    const r = await runAnnouncer(db, expo, NOW + MIN, { apply: false, ...quiet });
    assert.equal(r.results[0].dryRun, true);
    assert.equal(expo.calls, 0);
    assert.deepEqual(await val('push_announced'), before);
  });
});

describe('the 08:00 hold and the two-a-day cap, on London\'s clock', () => {
  // 25 Sep 2026 is BST: 07:00Z is 08:00 London. 1 Dec 2026 is GMT: 08:00Z is 08:00 London.
  const T = (s) => Date.parse(s);
  // The shared fixture's bp-i2 releases at 12:00Z on 25 Sep and its tokens are refreshed on
  // 22 Sep; move the one out of the way and keep the other fresh for December.
  const world = (day) => seedWorld({
    'series_instalments/bp-i2': { seriesId: 'bp', ordinal: 2, status: 'published', releaseAtMs: T('2027-01-01T00:00:00Z') },
    'push_tokens/reader1/k': token(1, T(day)), 'push_tokens/reader2/k': token(2, T(day)), 'push_tokens/quiet/k': token(3, T(day)),
  });

  test('BST: a story live at 05:30 London is HELD at 06:45, sent on the 08:00 run — and the heartbeat moves both times', async () => {
    await world('2026-09-25T00:00:00Z');
    await runSeed(db, T('2026-09-25T00:00:00Z'), { apply: true });
    await publish('dawn', { publishAt: '2026-09-25T04:30:00Z' });
    const early = fakeExpo();
    const r1 = await runAnnouncer(db, early, T('2026-09-25T05:45:00Z'), { apply: true, ...quiet });
    assert.equal(early.calls, 0, 'nothing leaves before 08:00 London');
    assert.equal(r1.results[0].held, true);
    assert.equal(await val('push_announced/story/dawn'), null, 'a hold is not a record');
    assert.equal((await val('ops/push_announcer')).lastRunAt, T('2026-09-25T05:45:00Z'));
    assert.equal((await val('ops/push_announcer')).heldAtLastRun, 1);

    const almost = fakeExpo();
    await runAnnouncer(db, almost, T('2026-09-25T06:59:00Z'), { apply: true, ...quiet });
    assert.equal(almost.calls, 0, '07:59 London');

    const eight = fakeExpo();
    await runAnnouncer(db, eight, T('2026-09-25T07:00:00Z'), { apply: true, ...quiet });
    assert.equal(eight.sent.length, 2, '08:00 London: both devices');
    assert.equal((await val('push_announced/story/dawn')).state, 'sent');
  });

  test('GMT: 07:30Z is 07:30 London and held — the same instant in BST would have sent', async () => {
    await world('2026-12-01T00:00:00Z');
    await runSeed(db, T('2026-12-01T00:00:00Z'), { apply: true });
    await publish('winter', { publishAt: '2026-12-01T06:00:00Z' });
    const held = fakeExpo();
    await runAnnouncer(db, held, T('2026-12-01T07:30:00Z'), { apply: true, ...quiet });
    assert.equal(held.calls, 0);
    const eight = fakeExpo();
    await runAnnouncer(db, eight, T('2026-12-01T08:00:00Z'), { apply: true, ...quiet });
    assert.equal(eight.sent.length, 2);
  });

  test('THREE IN A DAY: two are sent, the third is recorded `capped` and never sent — not even tomorrow', async () => {
    await world('2026-09-25T00:00:00Z');
    await runSeed(db, T('2026-09-25T00:00:00Z'), { apply: true });
    await publish('first', { publishAt: '2026-09-25T08:00:00Z' });
    const a = fakeExpo();
    await runAnnouncer(db, a, T('2026-09-25T08:05:00Z'), { apply: true, ...quiet });
    assert.equal(a.sent.length, 2);

    await publish('second', { publishAt: '2026-09-25T12:00:00Z' });
    await publish('third', { publishAt: '2026-09-25T12:00:01Z' });
    const b = fakeExpo();
    const r = await runAnnouncer(db, b, T('2026-09-25T12:05:00Z'), { apply: true, ...quiet });
    assert.deepEqual([...new Set(b.sent.map((m) => m.data.url))], ['/stories/second']);
    assert.equal(r.results.find((x) => x.id === 'third').capped, true);
    assert.equal((await val('push_announced/story/third')).state, 'capped');
    assert.equal((await val('ops/push_announcer')).cappedAtLastRun, 1);

    const tomorrow = fakeExpo();
    await runAnnouncer(db, tomorrow, T('2026-09-26T09:00:00Z'), { apply: true, ...quiet });
    assert.equal(tomorrow.calls, 0, 'capped means never');

    // …and the next day's own story has both of its slots.
    await publish('next-day', { publishAt: '2026-09-26T09:30:00Z' });
    const c = fakeExpo();
    await runAnnouncer(db, c, T('2026-09-26T09:35:00Z'), { apply: true, ...quiet });
    assert.equal(c.sent.length, 2);
  });

  test('a DRY RUN reports held and capped and writes neither', async () => {
    await world('2026-09-25T00:00:00Z');
    await runSeed(db, T('2026-09-25T00:00:00Z'), { apply: true });
    for (const s of ['p', 'q', 'r']) await publish(s, { publishAt: '2026-09-25T09:00:00Z' });
    const r = await runAnnouncer(db, fakeExpo(), T('2026-09-25T09:05:00Z'), { apply: false, ...quiet });
    assert.equal(r.results.filter((x) => x.dryRun).length, 2);
    assert.equal(r.results.filter((x) => x.capped).length, 1);
    assert.equal(await val('push_announced/story/r'), null);
  });
});

describe('receipts and pruning', () => {
  test('DeviceNotRegistered on the TICKET deletes that row at once', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    await publish('ticket-dead');
    await runAnnouncer(db, fakeExpo({ dead: ['ExpoPushToken[dev2]'] }), NOW + MIN, { apply: true, ...quiet });
    assert.equal(await val('push_tokens/reader2'), null);
    assert.ok(await val('push_tokens/reader1/k'));
  });

  test('receipts: fetched after 15 minutes; ok clears; DeviceNotRegistered deletes the token', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    await publish('with-receipts');
    await runAnnouncer(db, fakeExpo(), NOW + MIN, { apply: true, ...quiet });
    const held = await val('push_receipts');
    const ids = Object.keys(held);
    assert.equal(ids.length, 2);
    const byUid = Object.fromEntries(ids.map((id) => [held[id].uid, id]));

    // Five minutes on: too early to ask, nothing moves.
    const early = fakeExpo({ receipts: { [byUid.reader1]: { status: 'ok' } } });
    await runAnnouncer(db, early, NOW + 6 * MIN, { apply: true, ...quiet });
    assert.equal(Object.keys(await val('push_receipts')).length, 2);

    const later = fakeExpo({ receipts: {
      [byUid.reader1]: { status: 'ok' },
      [byUid.reader2]: { status: 'error', details: { error: 'DeviceNotRegistered' } },
    } });
    await runAnnouncer(db, later, NOW + 20 * MIN, { apply: true, ...quiet });
    assert.equal(await val('push_receipts'), null);
    assert.equal(await val('push_tokens/reader2'), null, 'the dead device is off the list');
    assert.ok(await val('push_tokens/reader1/k'), 'the healthy one stays');
    const hb = await val('ops/push_announcer');
    assert.equal(hb.receiptsOkAtLastRun, 1);
    assert.equal(hb.deadAtLastRun, 1);
  });

  test('a row not refreshed in 60 days is pruned, and is not sent to', async () => {
    await seedWorld({ 'push_tokens/gone/k': token(9, NOW - 61 * D) });
    await runSeed(db, NOW, { apply: true });
    await publish('prune-day');
    const expo = fakeExpo();
    await runAnnouncer(db, expo, NOW + MIN, { apply: true, ...quiet });
    assert.equal(await val('push_tokens/gone'), null);
    assert.equal(expo.sent.some((m) => m.to === 'ExpoPushToken[dev9]'), false);
  });
});
