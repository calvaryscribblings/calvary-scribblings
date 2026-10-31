// THE DESCRIPTOR FITS ITS MEASURE — COVERS-R19 and R19.1.
//
// A descriptor that does not fit the title's measure on one line breaks the way a title does,
// filling each line with as many words as fit, at the same size and tracking (render.mjs,
// fitDescriptor). Its leading is its cap height plus its word gap (descriptorLeading). And a
// title breaks at an existing hyphen only with HYPHEN_MIN letters each side (text.mjs). This
// suite holds the library to all three, and a synthetic worst case beside it.
//
// LIVE DATA, DELIBERATELY. The question is whether every descriptor the reconciler will draw
// fits, so the suite reads what the reconciler reads: cms_stories and cms_stories_retired over
// the public REST endpoint, in scope by the reconciler's own storiesInScope, with a pending
// descriptor taking the place of the current one exactly as on-publish.mjs does. It writes
// nothing. The design lock stays offline; this is a property of the library, not of the design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { descriptorLeading, fitDescriptor, formatDescriptor, planCover, registerFonts } from '../../scripts/covers/render.mjs';
import { toRecord } from '../../scripts/covers/generate.mjs';
import { DESCRIPTOR, TITLE } from '../../scripts/covers/layout.mjs';
import { breakParts, HYPHEN_MIN, trackedWidth, wrapDetailed } from '../../scripts/covers/text.mjs';
import { DB_URL, RETIRED_NODE, SOURCE_NODE, storiesInScope } from '../../scripts/covers/store.mjs';

registerFonts();
const ctx = createCanvas(10, 10).getContext('2d');
const width = (t) => { ctx.font = `${DESCRIPTOR.size}px "EB Garamond"`; return trackedWidth(ctx, t, DESCRIPTOR.tracking); };

async function liveRecords() {
  const get = async (p) => {
    const r = await fetch(`${DB_URL}/${p}.json`);
    assert.ok(r.ok, `${p} read failed: HTTP ${r.status}`);
    return r.json();
  };
  const { stories } = storiesInScope(await get(SOURCE_NODE), await get(RETIRED_NODE));
  return stories.map(({ slug, story }) => {
    const record = toRecord(slug, story);
    if (typeof story.descriptorPending === 'string') record.descriptor = story.descriptorPending || null;
    return record;
  });
}

/** Every line inside the measure, the words intact and in order, size and tracking untouched. */
function assertFits(text, fit, label) {
  for (const l of fit.lines) {
    assert.ok(l.width <= TITLE.maxWidth, `${label}: "${l.text}" is ${l.width.toFixed(1)}px on a ${TITLE.maxWidth}px measure`);
    assert.equal(l.width, width(l.text), `${label}: a line was measured at another size or tracking`);
  }
  assert.equal(fit.lines.map((l) => l.text).join(DESCRIPTOR.separator), text, `${label}: words lost, reordered or re-spaced`);
  for (const l of fit.lines) assert.ok(!/^\s|\s$/.test(l.text), `${label}: a line starts or ends with a space`);
  assert.ok(fit.lines.every((l) => /\.$/.test(l.text)), `${label}: a full stop left its word`);
}

test('THE DESCRIPTOR FITS ITS MEASURE (COVERS-R19)', async (t) => {
  const records = await liveRecords();
  const withDesc = records.filter((r) => formatDescriptor(r.descriptor));
  assert.ok(withDesc.length > 100, `only ${withDesc.length} live descriptors read — the read is wrong, not the rule`);

  await t.test('every live descriptor fits the title\'s measure, line by line', () => {
    for (const r of withDesc) {
      const text = formatDescriptor(r.descriptor);
      const plan = planCover(ctx, r);
      assertFits(text, plan.descriptor, r.slug);
      assert.equal(plan.overflow, false, `${r.slug}: the stack overflows once its descriptor breaks`);
    }
  });

  await t.test('one that fits stays on one line; one that does not fills each line, as a title does', () => {
    for (const r of withDesc) {
      const text = formatDescriptor(r.descriptor);
      const fit = fitDescriptor(ctx, text);
      if (width(text) <= TITLE.maxWidth) { assert.equal(fit.lines.length, 1, `${r.slug} fits but was broken`); continue; }
      assert.ok(fit.lines.length >= 2, `${r.slug} does not fit but was not broken`);
      // Filled: the next line's first word would not have fitted on the line before it.
      for (let i = 0; i < fit.lines.length - 1; i++) {
        const next = fit.lines[i + 1].text.split(DESCRIPTOR.separator)[0];
        assert.ok(width(fit.lines[i].text + DESCRIPTOR.separator + next) > TITLE.maxWidth, `${r.slug}: "${next}" would have fitted on line ${i + 1}`);
      }
    }
  });

  await t.test('the leading is cap height plus word gap, measured by the engine', () => {
    const { leading, cap, gap } = descriptorLeading(ctx);
    ctx.font = `${DESCRIPTOR.size}px "EB Garamond"`;
    assert.equal(cap, ctx.measureText('H').actualBoundingBoxAscent);
    assert.equal(gap, 2 * ctx.measureText(' ').width + 3 * DESCRIPTOR.tracking, 'the word gap is two spaces and three tracking steps');
    assert.equal(leading, cap + gap);
    assert.ok(Math.abs(leading - 83.6) < 0.05, `leading ${leading} — the expected 35.0 + 48.6 = 83.6 at EB Garamond 54px tracked 9`);
    assert.equal('lineHeight' in DESCRIPTOR, false, 'DESCRIPTOR.lineHeight is gone: the leading is derived, not a second number');
    const plan = planCover(ctx, { slug: 'x', title: 'Chaff', author: 'A', category: 'short', descriptor: 'superstition. avoidance. confirmation.' });
    assert.equal(plan.descriptor.lines.length, 2);
    assert.equal(plan.descriptor.lines[1].y - plan.descriptor.lines[0].y, leading, 'the baselines are one leading apart');
  });

  // UNRELEASED-1 (31 Oct 2026): THIS SUBTEST USED TO PIN ITS ANSWER TO LIVE DATA, AND THAT
  // STOPPED THE COVERS. It asserted that the library's three longest words broke as
  // CONSOLIDATION. IMPERSONATION. / ESTRANGEMENT. — true at R19.1, false the moment an editor
  // typed INTERROGATION. into a descriptor on 30 Oct. verify failed, so reconcile never ran, and
  // every held story waited for a cover for over a day. No test may pin to live data that editors
  // change: the R19.1 numbers now sit on a FIXTURE below, and the live worst case asserts only the
  // property — that it fits — whatever its words are today, and with a longer one added.
  const worstOf = (words) => [...new Set(words)].sort((a, b) => width(b) - width(a) || b.length - a.length).slice(0, 3);
  const assertWorstCaseFits = (text, label) => {
    const fit = fitDescriptor(ctx, text);
    assertFits(text, fit, label);
    // and on a cover with the library's longest title, the stack still fits its region
    const longestTitle = records.reduce((a, b) => (b.title.length > a.title.length ? b : a));
    const plan = planCover(ctx, { ...longestTitle, descriptor: text });
    assert.equal(plan.overflow, false, `${label} overflows the stack region under the longest live title`);
    assertFits(text, plan.descriptor, `${label} on the longest title`);
    return fit;
  };

  await t.test('the R19.1 worst case, as a fixture: two words over the third, 1213.3px', () => {
    const text = ['CONSOLIDATION.', 'IMPERSONATION.', 'ESTRANGEMENT.'].join(DESCRIPTOR.separator);
    assert.ok(width(text) > TITLE.maxWidth, 'the fixture must not fit on one line, or it proves nothing about the break');
    const fit = assertWorstCaseFits(text, 'the R19.1 fixture');
    assert.deepEqual(fit.lines.map((l) => l.text), ['CONSOLIDATION.  IMPERSONATION.', 'ESTRANGEMENT.']);
    assert.ok(Math.abs(fit.lines[0].width - 1213.3) < 0.05, `first line ${fit.lines[0].width}`);
  });

  await t.test('a synthetic worst case fits: the library\'s three longest descriptor words, whatever they are', () => {
    const words = withDesc.flatMap((r) => formatDescriptor(r.descriptor).split(DESCRIPTOR.separator));
    const longest = worstOf(words);
    assertWorstCaseFits(longest.join(DESCRIPTOR.separator), `the live worst case "${longest.join(' ')}"`);
  });

  await t.test('and still fits with a longer word than any in the library added', () => {
    const words = withDesc.flatMap((r) => formatDescriptor(r.descriptor).split(DESCRIPTOR.separator));
    const longer = 'DISENFRANCHISEMENT.';
    assert.ok(width(longer) > width(worstOf(words)[0]), `${longer} is not longer than the library's longest word`);
    const longest = worstOf([...words, longer]);
    assert.equal(longest[0], longer);
    assertWorstCaseFits(longest.join(DESCRIPTOR.separator), `the worst case with ${longer} added`);
  });

  await t.test('a word wider than the measure raises — nothing is drawn over the keyline again', () => {
    assert.throws(() => fitDescriptor(ctx, `${'W'.repeat(40)}.  RUIN.`), /cannot fit/);
  });
});

test('A TITLE HYPHEN BREAKS ONLY WITH TWO LETTERS BEHIND AND THREE FORWARD (COVERS-R19.1)', async (t) => {
  await t.test('the minimums are the ruling: two behind, three forward', () => {
    assert.deepEqual({ ...HYPHEN_MIN }, { before: 2, after: 3 });
  });

  await t.test('Wi-Fi is refused: two letters would be carried forward', () => {
    assert.deepEqual(breakParts('WI-FI'), ['WI-FI']);
    const plan = planCover(ctx, { slug: 'x', title: 'Public Wi-Fi Is a Trap', author: 'A', category: 'news', subcategory: 'Tech' });
    assert.equal(plan.title.size, 140);
    assert.deepEqual(plan.title.lines, ['PUBLIC WI-FI IS', 'A TRAP']);
  });

  await t.test('Step-by-Step, Brown-Skinned, Tug-of-War and Red-White-Red keep their breaks', () => {
    assert.deepEqual(breakParts('STEP-BY-STEP'), ['STEP-', 'BY-', 'STEP']);
    assert.deepEqual(breakParts('BROWN-SKINNED'), ['BROWN-', 'SKINNED']);
    assert.deepEqual(breakParts('TUG-OF-WAR'), ['TUG-', 'OF-', 'WAR']);
    assert.deepEqual(breakParts('RED-WHITE-RED'), ['RED-', 'WHITE-', 'RED']);
    const lines = (title) => planCover(ctx, { slug: 'x', title, author: 'A', category: 'short' }).title.lines;
    assert.deepEqual(lines('Brown-Skinned Girl'), ['BROWN-', 'SKINNED GIRL']);
    assert.ok(lines('Become a Content Creator: The Step-by-Step Guide').some((l) => l.endsWith('STEP-')), 'STEP- / BY-STEP');
  });

  await t.test('counted across the whole word on each side, letters and numerals only', () => {
    assert.deepEqual(breakParts('X-RAY'), ['X-RAY'], 'one letter behind');
    assert.deepEqual(breakParts('RE-ENTRY'), ['RE-', 'ENTRY']);
    assert.deepEqual(breakParts('9-5ER'), ['9-5ER'], 'one numeral behind');
    assert.deepEqual(breakParts('A-B-CDE'), ['A-B-', 'CDE'], 'A- alone is refused, A-B- leaves two behind');
    assert.deepEqual(breakParts('-30'), ['-30'], 'a leading hyphen is still not a break');
    ctx.font = '186px "Cormorant Garamond SemiBold"';
    assert.equal(wrapDetailed(ctx, 'WI-FI', 12, 1232).lines.length, 1);
  });
});

