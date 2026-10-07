// W35 · RETIRED STORIES — the pulled Book Reader records stay pulled, on every path.
//
//   npm run test:rules        (emulator; demo project; no production data, no network)
//
// THE INCIDENT IT REPLAYS. 30 Sep 2026: a CMS save of beta-princess-part-two with "published"
// ticked wrote published:false + coverHold:true (no generated cover yet), and the covers
// reconciler's next run selected the held record, generated a cover, and published it in the
// same patch. Both halves are replayed below against the emulator: the save is now refused by
// the rules, and the reconciler's selection drops the slug even when the hold is already there.
//
// And the other side, which matters as much: an ORDINARY story still saves, holds, unholds and
// publishes exactly as before.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, FOUNDER_A, FOUNDER_B } from './helpers.mjs';
import { hidePaths, unhidePlan } from '../../app/lib/storyState.js';
import { indexUpdatePaths } from '../../app/lib/storyIndex.js';
import { RETIRED_PATH, BOOK_READER_REASON } from '../../app/lib/retiredStories.js';
import { storiesInScope } from '../../scripts/covers/store.mjs';
import { retirePaths } from '../../scripts/stories/retire.mjs';

const RETIRED = 'beta-princess-part-two';
const ORDINARY = 'an-ordinary-story';
const TYPO = 'https://firebasestorage.googleapis.com/v0/b/x/o/covers-typographic%2Fslug%2Fabc%2Fcover.png';

// The record as W34 left it: unpublished, readerMode still set, and — the dangerous part —
// already carrying a generated cover from the 30 Sep run.
const retiredRecord = (extra = {}) => ({
  title: 'Beta Princess [Part Two]', author: 'A', authorUid: 'u1', category: 'novel', categoryName: 'Novel',
  date: 'Jul 30, 2026', url: `/stories/${RETIRED}`, readerMode: true, published: false,
  cover: TYPO, content: '', hiddenAt: 1791360000000, ...extra,
});
const ordinaryRecord = (extra = {}) => ({
  title: 'An Ordinary Story', author: 'B', authorUid: 'u2', category: 'short', categoryName: 'Short Story',
  date: 'Oct 7, 2026', url: `/stories/${ORDINARY}`, published: false, content: '<p>x</p>', ...extra,
});

/** The 30 Sep save, as app/admin/page.js builds it: per-field paths, the hold, the index drop. */
const cmsHeldSave = (slug, rec) => ({
  [`cms_stories/${slug}/title`]: rec.title,
  [`cms_stories/${slug}/readerMode`]: rec.readerMode ?? false,
  [`cms_stories/${slug}/published`]: false,
  [`cms_stories/${slug}/coverHold`]: true,
  [`cms_stories_index/${slug}`]: null,
  [`story_bodies/${slug}/content`]: '',
});

let env, founderA, founderB, reader, anon;
before(async () => {
  env = await makeEnv();
  founderA = env.authenticatedContext(FOUNDER_A).database();
  founderB = env.authenticatedContext(FOUNDER_B).database();
  reader = env.authenticatedContext(OWNER).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await seed(env, {
    [`${RETIRED_PATH}/${RETIRED}`]: { retiredAt: 1, retiredOn: '2026-08-16', reason: BOOK_READER_REASON },
    [`cms_stories/${RETIRED}`]: retiredRecord(),
    [`cms_stories/${ORDINARY}`]: ordinaryRecord(),
  });
});

const snapshot = async () => {
  let all, retired;
  await env.withSecurityRulesDisabled(async (ctx) => {
    all = (await ctx.database().ref('cms_stories').get()).val();
    retired = (await ctx.database().ref(RETIRED_PATH).get()).val();
  });
  return { all, retired };
};

describe('W35 · the 30 Sep sequence, replayed', () => {
  test('⛔ step 1 — the CMS save that held it for a cover is REFUSED, for both founders', async () => {
    await assertFails(founderA.ref().update(cmsHeldSave(RETIRED, retiredRecord())));
    await assertFails(founderB.ref().update(cmsHeldSave(RETIRED, retiredRecord())));
    const { all } = await snapshot();
    assert.equal(all[RETIRED].coverHold, undefined, 'no hold landed');
    assert.equal(all[RETIRED].published, false);
  });

  test('⛔ step 2 — the reconciler never selects it, EVEN IF the hold is already on the record', async () => {
    // The exact 30 Sep state: held for a cover. Seeded past the rules, as if written before W35.
    await seed(env, { [`cms_stories/${RETIRED}/coverHold`]: true });
    const { all, retired } = await snapshot();
    const { stories, skippedRetired } = storiesInScope(all, retired);
    assert.ok(!stories.some((s) => s.slug === RETIRED), 'a retired record is out of the reconciler\'s scope');
    assert.deepEqual(skippedRetired, [RETIRED], 'and it is named in the skip line, by slug');
  });

  test('…and without the marker, the same data WOULD have been published — the replay is real', async () => {
    await seed(env, { [`cms_stories/${RETIRED}/coverHold`]: true });
    const { all } = await snapshot();
    const { stories } = storiesInScope(all, null);
    assert.ok(stories.some((s) => s.slug === RETIRED && s.held), 'the 30 Sep selection, reproduced');
  });
});

describe('W35 · every other client path refuses a retired record', () => {
  test('⛔ Unhide (the CMS\'s own unhidePlan + index entry)', async () => {
    const rec = retiredRecord();
    const plan = unhidePlan(RETIRED, rec);
    assert.equal(plan.live, true, 'it has a generated cover, so Unhide would publish it outright');
    await assertFails(founderA.ref().update({ ...plan.paths, ...indexUpdatePaths(RETIRED, { ...rec, published: true, hiddenAt: null }) }));
    await assertFails(founderA.ref().update(plan.paths));
  });
  test('⛔ published:true, alone or with the index entry', async () => {
    await assertFails(founderA.ref(`cms_stories/${RETIRED}/published`).set(true));
    await assertFails(founderA.ref().update({
      [`cms_stories/${RETIRED}/published`]: true,
      ...indexUpdatePaths(RETIRED, { ...retiredRecord(), published: true }),
    }));
  });
  test('⛔ a full-record overwrite that drops hiddenAt (the CMS\'s old whole-node save)', async () => {
    const { hiddenAt: _dropped, ...rest } = retiredRecord();
    await assertFails(founderA.ref(`cms_stories/${RETIRED}`).set(rest));
  });
  test('⛔ clearing hiddenAt, so the Worker\'s tick would consider it', async () => {
    await assertFails(founderA.ref(`cms_stories/${RETIRED}/hiddenAt`).remove());
    await assertFails(founderA.ref().update({ [`cms_stories/${RETIRED}/hiddenAt`]: null, [`cms_stories/${RETIRED}/publishAt`]: '2026-01-01T00:00:00Z' }));
  });
  test('⛔ coverHold:true on its own', async () => {
    await assertFails(founderA.ref(`cms_stories/${RETIRED}/coverHold`).set(true));
  });
  test('⛔ an index entry, written directly', async () => {
    await assertFails(founderA.ref(`cms_stories_index/${RETIRED}`).set({ title: 'x', published: true }));
  });
  test('⛔ the marker itself: no client writes or removes it, founders included', async () => {
    await assertFails(founderA.ref(`${RETIRED_PATH}/${RETIRED}`).remove());
    await assertFails(founderA.ref(`${RETIRED_PATH}/${ORDINARY}`).set({ reason: 'x' }));
    await assertFails(reader.ref(`${RETIRED_PATH}/${RETIRED}`).remove());
  });
  test('the marker is public to read (slugs and a date only) — the reconciler reads it signed out', async () => {
    await assertSucceeds(anon.ref(RETIRED_PATH).get());
  });
  test('harmless writes still land: a reader\'s read count, and a founder\'s Hide', async () => {
    await assertSucceeds(reader.ref(`cms_stories/${RETIRED}/reads`).set(3));
    await assertSucceeds(founderA.ref().update(hidePaths(RETIRED)));
  });
});

describe('W35 · an ORDINARY story is untouched by all of this', () => {
  test('a CMS save held for a cover lands', async () => {
    await assertSucceeds(founderA.ref().update(cmsHeldSave(ORDINARY, ordinaryRecord())));
    const { all, retired } = await snapshot();
    assert.ok(storiesInScope(all, retired).stories.some((s) => s.slug === ORDINARY && s.held),
      'and the reconciler still picks it up to cover and publish');
  });
  test('the reconciler\'s publish lands (published:true + index, as coverFlipPaths writes it — via a founder here)', async () => {
    await assertSucceeds(founderA.ref().update({
      [`cms_stories/${ORDINARY}/published`]: true,
      [`cms_stories/${ORDINARY}/coverHold`]: null,
      [`cms_stories/${ORDINARY}/cover`]: TYPO,
      ...indexUpdatePaths(ORDINARY, { ...ordinaryRecord(), cover: TYPO, published: true }),
    }));
  });
  test('Hide and Unhide both land', async () => {
    await assertSucceeds(founderA.ref().update(hidePaths(ORDINARY)));
    const rec = ordinaryRecord({ cover: TYPO });
    const plan = unhidePlan(ORDINARY, rec);
    await assertSucceeds(founderA.ref().update({ ...plan.paths, ...indexUpdatePaths(ORDINARY, { ...rec, published: true, hiddenAt: null }) }));
  });
  test('a full-record set and a direct publish land', async () => {
    await assertSucceeds(founderA.ref(`cms_stories/${ORDINARY}`).set(ordinaryRecord({ published: true })));
    await assertSucceeds(founderA.ref(`cms_stories/${ORDINARY}/published`).set(false));
  });
  test('a reader still cannot publish anything, retired or not (unchanged)', async () => {
    await assertFails(reader.ref(`cms_stories/${ORDINARY}/published`).set(true));
  });
});

describe('W35 · the Worker\'s own rule already skips a retired record', () => {
  // Sliced out of the Worker source and run, as tests/ci/w6-worker.test.mjs does with its other
  // pure parts — the deployed function, not a transcription of it.
  const src = readFileSync(new URL('../../workers-external/calvary-newsletter.worker.js', import.meta.url), 'utf8');
  const start = src.indexOf('function publishDecision(');
  const end = src.indexOf('\n}\n', start) + 2;
  const publishDecision = new Function(`${src.slice(start, end)}; return publishDecision;`)();

  test('due, generated cover, no hold — and hiddenAt, so: "hidden", never "publish"', async () => {
    const { all } = await snapshot();
    const rec = { ...all[RETIRED], publishAt: '2026-01-01T00:00:00Z' };
    assert.equal(publishDecision(rec, new Date()), 'hidden');
  });
  test('the retirement write leaves every record in that shape', () => {
    const p = retirePaths(RETIRED, { published: true, coverHold: true }, { now: 5 });
    assert.equal(p[`cms_stories/${RETIRED}/published`], false);
    assert.equal(p[`cms_stories/${RETIRED}/hiddenAt`], 5);
    assert.equal(p[`cms_stories/${RETIRED}/coverHold`], null);
    assert.equal(p[`cms_stories_index/${RETIRED}`], null);
    assert.equal(p[`${RETIRED_PATH}/${RETIRED}`].reason, BOOK_READER_REASON);
    // an existing hiddenAt is kept, not restamped
    assert.equal(retirePaths(RETIRED, { hiddenAt: 7 }, { now: 5 })[`cms_stories/${RETIRED}/hiddenAt`], 7);
  });
});
