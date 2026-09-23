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

  test('an instalment released by the clock is announced on the next tick, in the DRAFT wording', async () => {
    await seedWorld();
    await runSeed(db, NOW, { apply: true });
    const expo = fakeExpo();
    await runAnnouncer(db, expo, NOW + 2 * D + MIN, { apply: true, ...quiet });
    assert.equal(expo.sent.length, 2);
    assert.equal(expo.sent[0].title, 'Part Two');
    assert.equal(expo.sent[0].body, 'New instalment by Monica Garcia · Beta Princess — She survives the duel.');
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
