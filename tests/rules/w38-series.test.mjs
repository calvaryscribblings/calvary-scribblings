// W38 — THE SERIES ADMIN'S WRITES AGAINST THE REAL RULES (emulator). No rules change was made;
// these prove the design fits the rules as they stand:
//   · a new draft's provisional row is a valid row, and its "not chosen yet" marks, on the
//     detail record, are admin-only;
//   · the publish is ONE multi-path update — instalment row, detail, and the series when it was a
//     draft — and "as soon as I publish" takes the database server's clock;
//   · if any part of that update is refused, none of it lands;
//   · a series carries its writer, and a draft series may have no synopsis yet ('').
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, FOUNDER_A } from './helpers.mjs';

const FAR = Date.UTC(2100, 0, 1);
const T0 = 1_760_000_000_000;
const SERIES = {
  schemaVersion: 1, slug: 'probe-series', title: 'Probe Series', synopsis: '', coverUrl: null,
  author: 'Probe Writer', authorUid: 'probe-uid', authorHandle: 'probewriter',
  status: 'draft', addedAt: T0, updatedAt: T0,
};
const ROW = { schemaVersion: 1, seriesId: 'probe-series', ordinal: 1, releaseAtMs: FAR, freeForGold: false, status: 'draft', addedAt: T0, updatedAt: T0 };
const DETAIL = {
  schemaVersion: 1, title: 'Probe One', author: 'Probe Writer', authorUid: 'probe-uid', authorHandle: 'probewriter',
  coverUrl: 'https://example.test/c.png', epubPath: 'series_epubs/probe-series-i1/master.epub',
  choicesPending: { freeForGold: true, releaseAtMs: true }, updatedAt: T0,
};

let env, founder, reader, anon;
before(async () => {
  env = await makeEnv();
  founder = env.authenticatedContext(FOUNDER_A).database();
  reader = env.authenticatedContext(OWNER).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('W38 · the series carries its writer', () => {
  test('a founder creates a draft series with a writer and no synopsis yet', async () => {
    await assertSucceeds(founder.ref('series/probe-series').set(SERIES));
    const back = (await founder.ref('series/probe-series').get()).val();
    assert.equal(back.synopsis, '', "a draft's empty synopsis is stored, so the rule's hasChildren holds");
    assert.equal(back.authorHandle, 'probewriter');
  });
  test('a reader cannot write a series writer', async () => {
    await seed(env, { 'series/probe-series': SERIES });
    await assertFails(reader.ref('series/probe-series/authorUid').set(OWNER));
  });
});

describe('W38 · a new draft', () => {
  test('the provisional row is a valid row: freeForGold false, release far ahead', async () => {
    await seed(env, { 'series/probe-series': SERIES });
    await assertSucceeds(founder.ref().update({ 'series_instalments/probe-series-i1': ROW, 'series_instalments_detail/probe-series-i1': DETAIL }));
  });
  test('"not chosen yet" is admin-only: the detail record is refused to a reader and to nobody-signed-in', async () => {
    await seed(env, { 'series/probe-series': SERIES, 'series_instalments/probe-series-i1': ROW, 'series_instalments_detail/probe-series-i1': DETAIL });
    await assertFails(anon.ref('series_instalments_detail/probe-series-i1/choicesPending').get());
    await assertFails(reader.ref('series_instalments_detail/probe-series-i1').get());
    await assertSucceeds(founder.ref('series_instalments_detail/probe-series-i1/choicesPending').get());
  });
  test('the row cannot drop freeForGold or releaseAtMs (the app reads both)', async () => {
    await seed(env, { 'series/probe-series': SERIES });
    const { freeForGold, ...noTier } = ROW;
    await assertFails(founder.ref('series_instalments/probe-series-i1').set(noTier));
    const { releaseAtMs, ...noRelease } = ROW;
    await assertFails(founder.ref('series_instalments/probe-series-i1').set(noRelease));
  });
});

describe('W38 · publishing is one atomic write', () => {
  const chosenDetail = (() => { const { choicesPending, ...d } = DETAIL; return d; })();
  test('instalment + detail + series in one update, released on the server clock', async () => {
    await seed(env, { 'series/probe-series': { ...SERIES, synopsis: 'Ready.', coverUrl: 'https://example.test/p.png' }, 'series_instalments/probe-series-i1': ROW, 'series_instalments_detail/probe-series-i1': DETAIL });
    const before = Date.now();
    await assertSucceeds(founder.ref().update({
      'series_instalments/probe-series-i1': { ...ROW, status: 'published', freeForGold: true, releaseAtMs: { '.sv': 'timestamp' }, updatedAt: before },
      'series_instalments_detail/probe-series-i1': { ...chosenDetail, updatedAt: before },
      'series/probe-series': { ...SERIES, synopsis: 'Ready.', coverUrl: 'https://example.test/p.png', status: 'published', updatedAt: before },
    }));
    const row = (await founder.ref('series_instalments/probe-series-i1').get()).val();
    const series = (await founder.ref('series/probe-series').get()).val();
    assert.equal(row.status, 'published');
    assert.equal(series.status, 'published', 'the series went live in the same write');
    assert.ok(typeof row.releaseAtMs === 'number' && row.releaseAtMs < FAR && Math.abs(row.releaseAtMs - before) < 60_000, 'released at the server clock');
    // Released now, so the detail is readable to anyone — and it carries no draft marks.
    const pub = (await assertSucceeds(anon.ref('series_instalments_detail/probe-series-i1').get())).val();
    assert.equal(pub.choicesPending, undefined);
  });
  test('if one part is refused, nothing lands — the instalment stays a draft', async () => {
    await seed(env, { 'series/probe-series': SERIES, 'series_instalments/probe-series-i1': ROW, 'series_instalments_detail/probe-series-i1': DETAIL });
    const { slug, ...brokenSeries } = SERIES;   // the series rule needs a slug
    await assertFails(founder.ref().update({
      'series_instalments/probe-series-i1': { ...ROW, status: 'published', releaseAtMs: { '.sv': 'timestamp' } },
      'series_instalments_detail/probe-series-i1': chosenDetail,
      'series/probe-series': { ...brokenSeries, status: 'published' },
    }));
    const row = (await founder.ref('series_instalments/probe-series-i1').get()).val();
    assert.equal(row.status, 'draft');
    assert.equal(row.releaseAtMs, FAR);
    assert.deepEqual((await founder.ref('series_instalments_detail/probe-series-i1/choicesPending').get()).val(), { freeForGold: true, releaseAtMs: true });
  });
  test('a reader cannot publish', async () => {
    await seed(env, { 'series/probe-series': SERIES, 'series_instalments/probe-series-i1': ROW });
    await assertFails(reader.ref('series_instalments/probe-series-i1/status').set('published'));
  });
});
