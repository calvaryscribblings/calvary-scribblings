// R49 — THE INDEX RECONCILER, and the instrument check that has to come first.
//
//   node --test tests/reconcile/reconcile.test.mjs      (npm run test:reconcile)
//
// ⚠⚠ A RECONCILER THAT FINDS NOTHING ON A CLEAN CORPUS IS INDISTINGUISHABLE FROM ONE THAT
// CANNOT SEE. The live index is clean right now, so a green scheduled run proves exactly
// nothing about whether the thing works — and it would go on proving nothing, quietly, for as
// long as the cron kept firing. Every test below therefore works from a corpus this file
// DAMAGES ON PURPOSE, and the first one asserts the damage is found before any other test is
// allowed to mean anything.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planRepairs, driftByField, DEFAULT_MAX_RECORDS } from '../../scripts/reconcile-index.mjs';
import { buildIndexRecord } from '../../app/lib/storyIndex.js';

/** A story rich enough that the projection populates every key it can. */
function story(i, over = {}) {
  return {
    title: `Story ${i}`, author: 'A Writer', authorUid: `uid${i}`, authorHandle: `h${i}`,
    category: 'short', categoryName: 'Short Story', subcategory: 'Drama',
    cover: `https://example.test/${i}.png`, coverHash: 'LKO2', trailerQuote: 'a quote',
    content: `<p>The ${i}th story opens on a sentence long enough to be an opening line.</p>`,
    date: 'Jul 4, 2026', published: true,
    coverSizes: { w360: 'a', w720: 'b' }, quizMeta: { hasQuiz: true, scribblesReward: 50 },
    ...over,
  };
}

/** n stories, and a perfectly projected index for them. */
function corpus(n = 5) {
  const src = {};
  for (let i = 1; i <= n; i++) src[`slug-${i}`] = story(i);
  const idx = {};
  for (const s of Object.keys(src)) idx[s] = buildIndexRecord(s, src[s]);
  return { src, idx };
}

describe('⚠ THE INSTRUMENT — prove it sees damage before trusting a quiet run', () => {
  test('a CLEAN corpus plans nothing (the baseline the other tests are measured against)', () => {
    const { src, idx } = corpus();
    const plan = planRepairs(src, idx);
    assert.deepEqual(plan.repairs, [], 'a clean corpus produced repairs — the projection is not deterministic');
    assert.deepEqual(plan.refusals, []);
    assert.equal(plan.tooMany, false);
  });

  test('⭑ A RECORD SHORT OF `opening` IS DETECTED — the exact live defect', () => {
    const { src, idx } = corpus();
    // Exactly what the scheduled-publish cron writes: a complete-looking record with the one
    // field its hand-copied projection has never carried.
    delete idx['slug-3'].opening;

    const plan = planRepairs(src, idx);
    assert.equal(plan.repairs.length, 1, 'the missing `opening` was not detected');
    assert.equal(plan.repairs[0].slug, 'slug-3');
    assert.deepEqual(plan.repairs[0].changed, ['opening']);
    // And the repair carries the REAL derived line, not a placeholder.
    assert.match(plan.repairs[0].want.opening, /^The 3th story opens on a sentence/);
    assert.deepEqual(driftByField(plan), { opening: 1 });
  });

  test('⭑ A RECORD SHORT OF `publishedAtMs` IS DETECTED — the entitlement one', () => {
    const { src, idx } = corpus();
    delete idx['slug-2'].publishedAtMs;
    const plan = planRepairs(src, idx);
    assert.equal(plan.repairs.length, 1);
    assert.deepEqual(plan.repairs[0].changed, ['publishedAtMs']);
    assert.equal(typeof plan.repairs[0].want.publishedAtMs, 'number');
  });

  test('the live cron shape — BOTH fields missing on one record — is detected as one repair', () => {
    const { src, idx } = corpus();
    delete idx['slug-4'].opening;
    delete idx['slug-4'].publishedAtMs;
    const plan = planRepairs(src, idx);
    assert.equal(plan.repairs.length, 1);
    assert.deepEqual(plan.repairs[0].changed, ['opening', 'publishedAtMs']);
  });

  test('a record ABSENT from the index entirely is detected and flagged as absent', () => {
    const { src, idx } = corpus();
    delete idx['slug-5'];
    const plan = planRepairs(src, idx);
    assert.equal(plan.repairs.length, 1);
    assert.equal(plan.repairs[0].absent, true);
    assert.deepEqual(plan.missing, ['slug-5']);
    // The repair is a COMPLETE record, not a patch of the missing keys.
    assert.deepEqual(Object.keys(plan.repairs[0].want).sort(),
      Object.keys(buildIndexRecord('slug-5', src['slug-5'])).sort());
  });

  test('a STALE VALUE — not merely a missing key — is detected', () => {
    const { src, idx } = corpus();
    idx['slug-1'].title = 'The Wrong Title';
    const plan = planRepairs(src, idx);
    assert.equal(plan.repairs.length, 1);
    assert.deepEqual(plan.repairs[0].changed, ['title']);
    assert.equal(plan.repairs[0].want.title, 'Story 1');
  });
});

describe('RAIL 2 — it refuses to drop a field', () => {
  test('a key the projection no longer emits is REFUSED, not silently deleted', () => {
    const { src, idx } = corpus();
    // A checkout behind production: the live record carries a field this build has never heard
    // of. Writing here would delete it, on a schedule, unattended.
    idx['slug-2'].someNewFieldShippedLastWeek = 'value the app is reading';
    const plan = planRepairs(src, idx);
    assert.deepEqual(plan.repairs, [], 'it planned a write that would drop a live field');
    assert.equal(plan.refusals.length, 1);
    assert.equal(plan.refusals[0].slug, 'slug-2');
    assert.deepEqual(plan.refusals[0].drops, ['someNewFieldShippedLastWeek']);
  });

  test('the refusal is PER RECORD — one behind record does not block repairing the others', () => {
    const { src, idx } = corpus();
    idx['slug-2'].someNewField = 'x';
    delete idx['slug-3'].opening;
    const plan = planRepairs(src, idx);
    assert.equal(plan.refusals.length, 1);
    assert.equal(plan.repairs.length, 1);
    assert.equal(plan.repairs[0].slug, 'slug-3');
    // ⚠ The CLI still exits non-zero on any refusal — a checkout behind production must be a
    // loud failure, not a partial success nobody reads. This assertion is about the PLAN.
  });
});

describe('RAIL 3 — a mass diff is a human decision', () => {
  test(`${DEFAULT_MAX_RECORDS + 1} differing records is REFUSED; ${DEFAULT_MAX_RECORDS} is not`, () => {
    const n = DEFAULT_MAX_RECORDS + 1;
    const { src, idx } = corpus(n + 4);
    // Eleven records short of a field is not "the cron published" — it is somebody having
    // changed the projection, which is a backfill.
    for (let i = 1; i <= n; i++) delete idx[`slug-${i}`].opening;
    const over = planRepairs(src, idx);
    assert.equal(over.repairs.length, n);
    assert.equal(over.tooMany, true, `${n} records did not trip the mass-diff refusal`);

    // And the boundary the other way, so the limit is a limit and not a coincidence.
    const { src: s2, idx: i2 } = corpus(DEFAULT_MAX_RECORDS + 4);
    for (let i = 1; i <= DEFAULT_MAX_RECORDS; i++) delete i2[`slug-${i}`].opening;
    const at = planRepairs(s2, i2);
    assert.equal(at.repairs.length, DEFAULT_MAX_RECORDS);
    assert.equal(at.tooMany, false, 'the limit refused at exactly the limit — it is off by one');
  });

  test('the limit is raisable deliberately, which is what makes it a rail and not a wall', () => {
    const { src, idx } = corpus(30);
    for (const s of Object.keys(idx)) delete idx[s].opening;
    assert.equal(planRepairs(src, idx).tooMany, true);
    assert.equal(planRepairs(src, idx, { maxRecords: 40 }).tooMany, false);
  });
});

describe('what it will not touch', () => {
  test('a HIDDEN story is not projected, and its index entry is reported as an orphan', () => {
    const { src, idx } = corpus();
    src['slug-2'].published = false;          // hidden after it was indexed
    const plan = planRepairs(src, idx);
    assert.ok(!plan.repairs.some((r) => r.slug === 'slug-2'), 'it planned to write a hidden story');
    assert.deepEqual(plan.orphans, ['slug-2']);
  });

  test('an orphan is REPORTED, never planned for deletion', () => {
    const { src, idx } = corpus();
    idx['a-story-that-no-longer-exists'] = { title: 'gone' };
    const plan = planRepairs(src, idx);
    assert.deepEqual(plan.orphans, ['a-story-that-no-longer-exists']);
    assert.deepEqual(plan.repairs, [], 'an orphan produced a write');
  });

  test('--slug narrows to one record and ignores drift elsewhere', () => {
    const { src, idx } = corpus();
    delete idx['slug-1'].opening;
    delete idx['slug-4'].opening;
    const plan = planRepairs(src, idx, { slug: 'slug-4' });
    assert.equal(plan.repairs.length, 1);
    assert.equal(plan.repairs[0].slug, 'slug-4');
  });

  test('an empty index is a mass diff, not a licence to rewrite the shelf', () => {
    const { src } = corpus(20);
    const plan = planRepairs(src, {});
    assert.equal(plan.repairs.length, 20);
    assert.equal(plan.tooMany, true, 'a wiped index would have been silently rebuilt by a cron');
  });
});

describe('⭑ RAIL 1 — it imports the real builder and copies nothing', () => {
  const SRC = readFileSync(new URL('../../scripts/reconcile-index.mjs', import.meta.url), 'utf8');

  test('the projection is IMPORTED from app/lib/storyIndex.js', () => {
    assert.match(SRC, /import\s*\{[^}]*\bbuildIndexRecord\b[^}]*\}\s*from\s*'\.\.\/app\/lib\/storyIndex\.js'/,
      'reconcile-index.mjs does not import the real buildIndexRecord');
  });

  test('⚠ IT DEFINES NO PROJECTION OF ITS OWN — the whole point of the reconciler', () => {
    // The failure this guards against is somebody "fixing" an import problem by pasting a
    // local copy of the projection in here, which would recreate the exact drift the
    // reconciler exists to end — with the added charm of a third copy.
    assert.ok(!/function\s+buildIndexRecord\w*\s*\(/.test(SRC),
      'reconcile-index.mjs defines its own buildIndexRecord — import it, never copy it');
    assert.ok(!/Mirror\s*\(/.test(SRC), 'reconcile-index.mjs carries a *Mirror function — it must not');
    // And it must not hand-copy the opening predicate either, which is the ~200 lines the whole
    // design exists to avoid transcribing.
    for (const forbidden of ['walkToProse', 'parseBlocks']) {
      assert.ok(!new RegExp(`function\\s+${forbidden}`).test(SRC),
        `reconcile-index.mjs defines ${forbidden} — that transcription is the thing being avoided`);
    }
  });

  test('the repair is a COMPLETE record PUT at the slug, never a deep path', () => {
    // A deep-path write creates the parent when the slug is absent, leaving a one-field record
    // that still counts as a member. See rule 2 in app/lib/storyIndex.js.
    assert.match(SRC, /\$\{INDEX_PATH\}\/\$\{r\.slug\}\.json/, 'the write is not addressed at the slug');
    assert.match(SRC, /body:\s*JSON\.stringify\(r\.want\)/, 'the write body is not the complete projected record');
    assert.ok(!/\$\{INDEX_PATH\}\/\$\{[^}]+\}\/\$\{/.test(SRC), 'a deep-path index write is present');
  });
});
