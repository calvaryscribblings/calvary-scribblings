// THE DESCRIPTOR FITS ITS MEASURE — COVERS-R19.
//
// A descriptor that does not fit the title's measure on one line breaks between words onto
// the fewest lines that fit, at the same size and tracking (render.mjs, fitDescriptor). This
// suite holds the library to that, and a synthetic worst case beside it.
//
// LIVE DATA, DELIBERATELY. The question is whether every descriptor the reconciler will draw
// fits, so the suite reads what the reconciler reads: cms_stories and cms_stories_retired over
// the public REST endpoint, in scope by the reconciler's own storiesInScope, with a pending
// descriptor taking the place of the current one exactly as on-publish.mjs does. It writes
// nothing. The design lock stays offline; this is a property of the library, not of the design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { fitDescriptor, formatDescriptor, planCover, registerFonts } from '../../scripts/covers/render.mjs';
import { toRecord } from '../../scripts/covers/generate.mjs';
import { DESCRIPTOR, TITLE } from '../../scripts/covers/layout.mjs';
import { trackedWidth } from '../../scripts/covers/text.mjs';
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

  await t.test('one that fits on one line stays on one line, and one that does not takes the fewest lines', () => {
    for (const r of withDesc) {
      const text = formatDescriptor(r.descriptor);
      const fit = fitDescriptor(ctx, text);
      if (width(text) <= TITLE.maxWidth) assert.equal(fit.lines.length, 1, `${r.slug} fits but was broken`);
      else assert.ok(fit.lines.length >= 2, `${r.slug} does not fit but was not broken`);
      if (fit.lines.length > 2) {
        // fewer lines must be impossible: every two-line break leaves a line over the measure
        const words = text.split(DESCRIPTOR.separator);
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(DESCRIPTOR.separator);
          const b = words.slice(i).join(DESCRIPTOR.separator);
          assert.ok(width(a) > TITLE.maxWidth || width(b) > TITLE.maxWidth, `${r.slug}: two lines would have fitted`);
        }
      }
    }
  });

  await t.test('the break chosen is the one whose lines are closest in width', () => {
    for (const r of withDesc) {
      const text = formatDescriptor(r.descriptor);
      const fit = fitDescriptor(ctx, text);
      if (fit.lines.length !== 2) continue;
      const words = text.split(DESCRIPTOR.separator);
      const spread = (i) => {
        const a = width(words.slice(0, i).join(DESCRIPTOR.separator));
        const b = width(words.slice(i).join(DESCRIPTOR.separator));
        return Math.max(a, b) <= TITLE.maxWidth ? Math.abs(a - b) : Infinity;
      };
      const chosen = Math.abs(fit.lines[0].width - fit.lines[1].width);
      for (let i = 1; i < words.length; i++) assert.ok(chosen <= spread(i), `${r.slug}: a more even break existed`);
    }
  });

  await t.test('a synthetic worst case fits: the library\'s three longest descriptor words', () => {
    const words = [...new Set(withDesc.flatMap((r) => formatDescriptor(r.descriptor).split(DESCRIPTOR.separator)))];
    const longest = words.sort((a, b) => width(b) - width(a) || b.length - a.length).slice(0, 3);
    const text = longest.join(DESCRIPTOR.separator);
    assert.ok(width(text) > TITLE.maxWidth, `the worst case "${text}" fits on one line, so it proves nothing about the break`);
    const fit = fitDescriptor(ctx, text);
    assertFits(text, fit, `worst case "${text}"`);
    // and on a cover with the library's longest title, the stack still fits its region
    const longestTitle = records.reduce((a, b) => (b.title.length > a.title.length ? b : a));
    const plan = planCover(ctx, { ...longestTitle, descriptor: text });
    assert.equal(plan.overflow, false, 'the worst case overflows the stack region under the longest live title');
    assertFits(text, plan.descriptor, 'worst case on the longest title');
  });

  await t.test('a word wider than the measure raises — nothing is drawn over the keyline again', () => {
    assert.throws(() => fitDescriptor(ctx, `${'W'.repeat(40)}.  RUIN.`), /cannot fit/);
  });
});
