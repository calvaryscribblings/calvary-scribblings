// PROOFS-R1 · ruling 255 — an unreleased story's text stays out of the public database.
//
//   npm run test:rules        (emulator; demo project; no production data, no network)
//
// Every path that writes a story's text, and every path that makes a story live or takes it
// down, runs here against the emulator: as a FOUNDER under the real rules for the CMS's own
// writes, past the rules for the server-side ones. (The scheduled-publish Worker and the Square's
// write Function run unmodified in proofs-r1-flip.test.mjs.) The invariant checked
// after each one is the ruling itself:
//
//   a story that is not live has no `content` and no `extractedText` on cms_stories/<slug>;
//   a story that is live has both there, identical to story_bodies/<slug>.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, seed, assertSucceeds, assertFails, FOUNDER_A, OWNER } from './helpers.mjs';
import { recordSavePaths, extractTextPaths, bodyOf, placementPaths } from '../../app/lib/storyText.js';
import { hideUpdate, unhideUpdate } from '../../app/lib/storyState.js';
import { buildIndexRecord } from '../../app/lib/storyIndex.js';
import { coverFlipPaths } from '../../scripts/covers/store.mjs';
import { retirePaths } from '../../scripts/stories/retire.mjs';
import { planTextOut, applyTextOut } from '../../scripts/stories/unreleased-text-out.mjs';

const TYPO = 'https://firebasestorage.googleapis.com/v0/b/x/o/covers-typographic%2Fs%2Fabc%2Fcover.png';
const PAST = '2026-10-30T06:30:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

// Synthetic text. Two paragraphs so the index's opening line has something to choose.
const BODY = {
  content: '<p>Content note: synthetic.</p><p>The first real sentence of the fixture story, long enough to be an opening line.</p>',
  extractedText: 'The extracted plain text of the fixture.',
};
const record = (extra = {}) => ({
  title: 'A Fixture', author: 'W. Riter', authorUid: 'writer-1', category: 'short', categoryName: 'Short Story',
  date: 'Oct 30, 2026', url: '/stories/s', cover: TYPO, ...extra,
});

let env, founder, anon;
before(async () => {
  env = await makeEnv();
  founder = env.authenticatedContext(FOUNDER_A).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.database()); }); return out; };
const read = (path) => admin(async (db) => (await db.ref(path).get()).val());

/** The ruling, asserted. */
async function assertPlaced(slug, { live }) {
  const [rec, copy] = [await read(`cms_stories/${slug}`), await read(`story_bodies/${slug}`)];
  assert.ok(copy && typeof copy.content === 'string', `${slug}: story_bodies holds the text`);
  if (live) {
    assert.equal(rec.content, copy.content, `${slug}: a live story's public text equals story_bodies'`);
    assert.equal(rec.extractedText, copy.extractedText);
  } else {
    assert.equal(rec?.content, undefined, `${slug}: a story that isn't live has NO public content`);
    assert.equal(rec?.extractedText, undefined, `${slug}: …and no public extractedText`);
    // and a signed-out reader reading the field directly gets nothing
    assert.equal((await anon.ref(`cms_stories/${slug}/content`).get()).val(), null);
  }
}

// ── 1. writing ─────────────────────────────────────────────────────────────────────────────
describe('PROOFS-R1 · writing: the text goes to story_bodies only while a story is not live', () => {
  test('a CMS save of a SCHEDULED story (as the founder, under the rules)', async () => {
    const fields = { ...record(), ...BODY, published: false, publishAt: FUTURE };
    await assertSucceeds(founder.ref().update(recordSavePaths('sched', fields)));
    await assertPlaced('sched', { live: false });
    assert.equal(await read('cms_stories/sched/title'), 'A Fixture', 'the rest of the record is written as before');
  });

  test('a CMS save that HOLDS a story for its cover, and one that leaves a hidden story hidden', async () => {
    await assertSucceeds(founder.ref().update(recordSavePaths('held', { ...record({ cover: '' }), ...BODY, published: false, coverHold: true })));
    await assertPlaced('held', { live: false });
    await seed(env, { 'cms_stories/hid': { ...record(), ...BODY, published: false, hiddenAt: 5 } });
    await assertSucceeds(founder.ref().update(recordSavePaths('hid', { ...record(), ...BODY, published: false })));
    await assertPlaced('hid', { live: false });
  });

  test('a CMS save of a LIVE story keeps its text public (every app runtime reads it there)', async () => {
    await assertSucceeds(founder.ref().update(recordSavePaths('live', { ...record(), ...BODY, published: true })));
    await assertPlaced('live', { live: true });
  });

  test('the CMS "publish now" save of a scheduled story copies the text out in the same write', async () => {
    await seed(env, { 'cms_stories/now': { ...record(), published: false, publishAt: FUTURE }, 'story_bodies/now': BODY });
    await assertSucceeds(founder.ref().update(recordSavePaths('now', { ...record(), ...BODY, published: true, publishAt: null })));
    await assertPlaced('now', { live: true });
  });

  test('extract-text: story_bodies always, the public record only while live', async () => {
    await seed(env, {
      'cms_stories/x-sched': { ...record(), published: false, publishAt: FUTURE }, 'story_bodies/x-sched': BODY,
      'cms_stories/x-live': { ...record(), ...BODY, published: true }, 'story_bodies/x-live': BODY,
    });
    await assertSucceeds(founder.ref().update(extractTextPaths('x-sched', 'fresh extraction', false)));
    await assertSucceeds(founder.ref().update(extractTextPaths('x-live', 'fresh extraction', true)));
    assert.equal(await read('story_bodies/x-sched/extractedText'), 'fresh extraction');
    assert.equal(await read('cms_stories/x-sched/extractedText'), null);
    await assertPlaced('x-live', { live: true });
    assert.equal(await read('cms_stories/x-live/extractedText'), 'fresh extraction');
  });

  test('the CMS edit form reads the text from story_bodies, where an unreleased story keeps it', async () => {
    await seed(env, { 'cms_stories/ed': { ...record(), published: false, publishAt: FUTURE }, 'story_bodies/ed': BODY });
    // app/admin/page.js openEdit: bodyOf(<story_bodies read as the founder>, <the listed record>)
    const listed = await read('cms_stories/ed');
    const body = bodyOf((await founder.ref('story_bodies/ed').get()).val(), listed);
    assert.deepEqual(body, BODY);
    assert.equal(bodyOf(null, listed).content, '', 'the record alone has no text to offer');
    await assertFails(anon.ref('story_bodies/ed').get());
  });
});

// ── 2. going live, and coming down ───────────────────────────────────────────────────────────
describe('PROOFS-R1 · every path that makes a story live copies the text in the SAME write', () => {
  test('Unhide (a story with a generated cover goes live)', async () => {
    await seed(env, { 'cms_stories/u': { ...record(), published: false, hiddenAt: 5 }, 'story_bodies/u': BODY });
    const plan = unhideUpdate('u', await read('cms_stories/u'), await read('story_bodies/u'));
    assert.equal(plan.live, true);
    await assertSucceeds(founder.ref().update(plan.paths));
    await assertPlaced('u', { live: true });
    const idx = await read('cms_stories_index/u');
    assert.equal(idx.opening, buildIndexRecord('u', { ...record(), ...BODY }).opening);
    assert.ok(idx.opening.length > 0 && idx.readTime > 0, 'the index entry was projected from the text');
  });

  test('Unhide of a coverless story only HOLDS it, so its text stays private', async () => {
    await seed(env, { 'cms_stories/uh': { ...record({ cover: '' }), published: false, hiddenAt: 5 }, 'story_bodies/uh': BODY });
    const plan = unhideUpdate('uh', await read('cms_stories/uh'), await read('story_bodies/uh'));
    assert.equal(plan.live, false);
    await assertSucceeds(founder.ref().update(plan.paths));
    await assertPlaced('uh', { live: false });
  });

  test('Hide takes the text out of the public record in the same write', async () => {
    await seed(env, { 'cms_stories/h': { ...record(), ...BODY, published: true }, 'story_bodies/h': BODY });
    await assertSucceeds(founder.ref().update(hideUpdate('h', await read('cms_stories/h'), await read('story_bodies/h'))));
    await assertPlaced('h', { live: false });
    assert.equal(await read('cms_stories_index/h'), null);
  });

  test('Hide of a record from before T1 (no story_bodies copy) MOVES the text instead of dropping it', async () => {
    await seed(env, { 'cms_stories/old': { ...record(), ...BODY, published: true } });
    await assertSucceeds(founder.ref().update(hideUpdate('old', await read('cms_stories/old'), null)));
    await assertPlaced('old', { live: false });
    assert.deepEqual(await read('story_bodies/old'), BODY);
  });

  test('the covers reconciler\'s release of a held story', async () => {
    await seed(env, { 'cms_stories/r': { ...record({ cover: '' }), published: false, coverHold: true }, 'story_bodies/r': BODY });
    const story = await read('cms_stories/r');
    const paths = coverFlipPaths('r', story, { cover: TYPO, coverSizes: { w360: 'a', w720: 'b' }, coverHash: 'h' },
      { published: true, coverHold: null }, await read('story_bodies/r'));
    await admin((db) => db.ref().update(paths));
    await assertPlaced('r', { live: true });
    assert.ok((await read('cms_stories_index/r')).opening.length > 0);
    assert.throws(() => coverFlipPaths('r', story, { cover: TYPO, coverSizes: {}, coverHash: 'h' }, { published: true }),
      /story_bodies read/, 'a release that did not read the text refuses to build');
  });

  test('…and a SCHEDULED story\'s cover-only release leaves its text private', async () => {
    await seed(env, { 'cms_stories/rs': { ...record({ cover: '' }), published: false, coverHold: true, publishAt: FUTURE }, 'story_bodies/rs': BODY });
    const paths = coverFlipPaths('rs', await read('cms_stories/rs'), { cover: TYPO, coverSizes: {}, coverHash: 'h' }, { coverHold: null });
    await admin((db) => db.ref().update(paths));
    await assertPlaced('rs', { live: false });
  });

  test('retirement takes the text out with the marker', async () => {
    await seed(env, { 'cms_stories/ret': { ...record(), ...BODY, published: true }, 'story_bodies/ret': BODY });
    await admin(async (db) => db.ref().update(retirePaths('ret', await read('cms_stories/ret'), { now: 5, body: await read('story_bodies/ret') })));
    await assertPlaced('ret', { live: false });
  });
});

// ── 4. the existing records ──────────────────────────────────────────────────────────────────
describe('PROOFS-R1 · the backfill (scripts/stories/unreleased-text-out.mjs)', () => {
  test('removes public text from records that are not live, and only where story_bodies holds it', async () => {
    await seed(env, {
      'cms_stories/b-sched': { ...record(), ...BODY, published: false, publishAt: FUTURE }, 'story_bodies/b-sched': BODY,
      'cms_stories/b-live': { ...record(), ...BODY, published: true }, 'story_bodies/b-live': BODY,
      'cms_stories/b-more': { ...record(), content: BODY.content, extractedText: '', published: false, hiddenAt: 5 }, 'story_bodies/b-more': BODY,
      'cms_stories/b-diff': { ...record(), ...BODY, published: false, hiddenAt: 5 }, 'story_bodies/b-diff': { ...BODY, content: '<p>other</p>' },
    });
    const [stories, bodies] = [await read('cms_stories'), await read('story_bodies')];
    const plan = planTextOut(stories, bodies);
    assert.deepEqual([plan.live, plan.remove.sort(), plan.bodiesHoldMore, plan.differs], [1, ['b-more', 'b-sched'], ['b-more'], ['b-diff']]);
    // The real script refuses outright on any difference; the removal itself, on the clean plan:
    const res = await admin((db) => applyTextOut(db, plan, bodies));
    assert.deepEqual(res, { removed: 2, skippedLive: 0, skippedChanged: 0 });
    await assertPlaced('b-sched', { live: false });
    await assertPlaced('b-more', { live: false });
    await assertPlaced('b-live', { live: true });
    assert.deepEqual(await read('story_bodies/b-more'), BODY, 'story_bodies untouched');
  });

  test('a record that went live between the plan and the write is left alone', async () => {
    await seed(env, { 'cms_stories/b-race': { ...record(), ...BODY, published: false, publishAt: FUTURE }, 'story_bodies/b-race': BODY });
    const bodies = await read('story_bodies');
    const plan = planTextOut(await read('cms_stories'), bodies);
    await seed(env, { 'cms_stories/b-race/published': true });
    const res = await admin((db) => applyTextOut(db, plan, bodies));
    assert.deepEqual(res, { removed: 0, skippedLive: 1, skippedChanged: 0 });
    await assertPlaced('b-race', { live: true });
  });
});
