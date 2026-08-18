// THE COVER SYSTEM'S SUITE — determinism first, then layout, then the edge cases.
//
//   npm run covers:verify
//
// "Deterministic" is the whole claim of this subsystem, and it is a claim about FOUR things
// at once: the fonts, the fleuron, the renderer version, and the seeded grain. Any one of
// them drifting breaks it silently — the covers still generate, they are just different from
// the ones in Storage. So the first block asserts all four as literal values. When one of
// these fails, the correct response is almost never to update the constant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { renderCover, planCover, registerFonts, measureCanaries, formatDescriptor } from '../../scripts/covers/render.mjs';
import { LIVERIES, liveryFor, eyebrowFor, isKnownCategory, IMPRINT_EYEBROW } from '../../scripts/covers/liveries.mjs';
import { AUTHOR, CANVAS, DESCRIPTOR, EYEBROW, FOOTER, RULE, STACK, STACK_REGION, TITLE, instalmentFooter } from '../../scripts/covers/layout.mjs';
import { breakParts, caps, clusters, wrapTracked } from '../../scripts/covers/text.mjs';
import { rngForSlug, seedFrom } from '../../scripts/covers/random.mjs';
import { FLEURON_PATH, FLEURON_PATH_SHA256 } from '../../assets/covers/fleuron-2766.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const png = (rec) => renderCover(rec).png;

const BASE = {
  slug: 'a-test-story', title: 'Odeluwa', author: 'Chimamanda Adichie',
  category: 'short', subcategory: 'Drama',
};

// ════════════════════════════════════════════════════════════════════════════════════════
test('THE DETERMINISM ANCHORS', async (t) => {
  await t.test('the vendored fonts are the exact files PROVENANCE.md records', () => {
    // If this fails, someone replaced or re-instanced a font. EVERY COVER IN STORAGE WAS
    // RENDERED WITH THE OLD ONE. Do not update these hashes without regenerating the library.
    const expected = {
      'CormorantGaramond-Italic.ttf':  '682f6cbb7a64cf73a4bfbae0cf7c2953dba7a2214b08247ba7af0a59547a4a8e',
      'CormorantGaramond-SemiBold.ttf': '5b4a386a781a9ed9311536febe88366ee39fe7ac4969400b9a15cb6c71ca0e12',
      'EBGaramond-Regular.ttf':        'fb7eec6ce49c18df8a151b7aeb2f90d710d2c454a442c72180638328a95d8048',
    };
    for (const [file, want] of Object.entries(expected)) {
      assert.equal(sha(readFileSync(join(ROOT, 'assets/covers/fonts', file))), want, `${file} changed`);
    }
    // The licences travel with the fonts. The OFL requires it and the assets are useless without them.
    for (const f of ['OFL-CormorantGaramond.txt', 'OFL-EBGaramond.txt']) {
      const text = readFileSync(join(ROOT, 'assets/covers/fonts', f), 'utf8');
      assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/i, `${f} is not the OFL`);
    }
  });

  await t.test('the fleuron outline is unchanged and self-consistent', () => {
    assert.equal(sha(FLEURON_PATH), FLEURON_PATH_SHA256);
    assert.equal(FLEURON_PATH_SHA256, 'd2f98045a8e47045ef5f06b403b2bb7a7431dda50d2fa114b578fde9b52854cd');
  });

  await t.test('the renderer is pinned EXACTLY — no caret, no tilde', () => {
    // A caret here is the failure the pin exists to prevent: measureText and fillText must
    // come from the same engine build, and a minor bump can move a title down a ladder rung.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const spec = pkg.dependencies['@napi-rs/canvas'];
    assert.equal(spec, '1.0.6', `@napi-rs/canvas must be pinned exactly, found ${spec}`);
    assert.doesNotMatch(spec, /[\^~*x]|>|</, 'the renderer version must not be a range');
  });

  await t.test('the vendored faces are the ones being drawn with — not a system fallback', () => {
    // The host has DejaVu, Liberation and FreeSerif installed and Skia will fall back to them
    // SILENTLY. These widths come from the vendored files; a fallback misses by tens of px.
    assert.deepEqual(measureCanaries(), { title: 687.4, italic: 610.1, meta: 682.4 });
  });

  await t.test('the grain stream is seeded from the slug and is reproducible', () => {
    const a = rngForSlug('odeluwa'), b = rngForSlug('odeluwa'), c = rngForSlug('sim-swapping');
    const take = (r) => [...Array(6)].map(() => r());
    assert.deepEqual(take(a), take(b), 'same slug must give the same stream');
    assert.notDeepEqual(take(rngForSlug('odeluwa')), take(c), 'different slugs must differ');
    assert.equal(seedFrom('odeluwa'), seedFrom('odeluwa'));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('BYTE-IDENTICAL OUTPUT', async (t) => {
  await t.test('the same record renders to the same bytes', () => {
    assert.equal(sha(png(BASE)), sha(png(BASE)));
  });

  await t.test('the pooled scratch surfaces do not leak between covers', () => {
    // renderCover reuses its canvases — see the scratch-surface note in render.mjs, which
    // exists because allocating them per cover OOM-killed the full-library pass. This is the
    // assertion that pays for that optimisation: a cover rendered in isolation and the same
    // cover rendered after a dark one and a light one must be identical to the byte.
    const alone = sha(png(BASE));
    png({ slug: 'p', title: 'A Heart Trained for Battle', author: 'Kalu Rebecca', category: 'poetry', subcategory: 'Grief' });
    png({ slug: 'f', title: 'Chernobyl', author: 'X', category: 'flash', subcategory: 'Horror', descriptor: 'rain. repetition. dread.' });
    assert.equal(sha(png(BASE)), alone);
  });

  await t.test('the slug — and only the slug — moves the grain', () => {
    const a = sha(png(BASE));
    const b = sha(png({ ...BASE, slug: 'a-different-slug' }));
    assert.notEqual(a, b, 'a different slug must reseed the grain');
  });

  await t.test('every livery renders, and all six differ', () => {
    const shas = Object.keys(LIVERIES).map((key) =>
      sha(png({ ...BASE, slug: `s-${key}`, category: undefined, liveryKey: key })));
    assert.equal(new Set(shas).size, 6);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('THE LAYOUT', async (t) => {
  registerFonts();
  const plan = (rec) => planCover(createCanvas(CANVAS.w, CANVAS.h).getContext('2d'), rec);

  await t.test('the pinned rows are where the brief pins them', () => {
    assert.equal(EYEBROW.y, 203);
    assert.equal(AUTHOR.y, 2014);
    assert.equal(FOOTER.y, 2122);
    assert.deepEqual({ w: CANVAS.w, h: CANVAS.h }, { w: 1600, h: 2400 });
    assert.equal(CANVAS.h / CANVAS.w, 1.5, 'the canvas must be 2:3 portrait');
  });

  await t.test('the stack sits at 20% of its slack — NOT centred', () => {
    const p = plan(BASE);
    const expected = STACK_REGION.top + p.stack.slack * STACK.placement;
    assert.equal(+p.stack.top.toFixed(6), +expected.toFixed(6));
    const centred = STACK_REGION.top + p.stack.slack * 0.5;
    assert.ok(p.stack.top < centred - 100, 'the stack must sit visibly above centre');
  });

  await t.test('the title ladder steps DOWN for a long title and it lands small', () => {
    const short = plan({ ...BASE, title: 'Chaff' });
    const long = plan({ ...BASE, title: 'The Age of Agentic AI: when machines start hacking without permission — or a human' });
    assert.equal(short.title.size, 186);
    assert.equal(long.title.size, 68, 'the longest title in the library must land on the fallback rung');
    assert.ok(long.title.lines.length >= 4);
    assert.ok(!long.overflow, 'and it must still fit inside the frame');
  });

  await t.test('every rung honours its own line cap', () => {
    for (const rung of TITLE.ladder) {
      if (rung.maxLines === Infinity) continue;
      const words = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ');
      for (let n = 1; n <= words.length; n++) {
        const p = plan({ ...BASE, title: words.slice(0, n).join(' ') });
        const chosen = TITLE.ladder.find((r) => r.size === p.title.size);
        assert.ok(p.title.lines.length <= chosen.maxLines,
          `${p.title.size}px allowed ${p.title.lines.length} lines, cap is ${chosen.maxLines}`);
      }
    }
  });

  await t.test('the vertical constraint has headroom — if this fails, the ladder changed', () => {
    // The title ladder is chosen on WIDTH. A second, vertical constraint exists in fitTitle
    // and currently decides nothing, because every capped rung's worst-case stack — max
    // lines at that size, plus the rule gap, plus a descriptor row — is far inside the
    // region. This asserts that headroom rather than the inert behaviour it produces.
    //
    // WHEN THIS FAILS, nothing is broken: it means someone raised a line cap, shrank the
    // stack region, or grew the descriptor, and the vertical constraint has become LIVE.
    // Titles can now step down a rung for reasons of height. That is the ladder working —
    // but it is a real behaviour change, and it should be noticed here rather than in a
    // cover. Re-measure, and update the 0.5 below deliberately.
    const region = STACK_REGION.bottom - STACK_REGION.top;
    const descExtra = DESCRIPTOR.gapBelowRule + DESCRIPTOR.size * 0.72;
    for (const rung of TITLE.ladder) {
      if (rung.maxLines === Infinity) continue;   // the fallback: uncapped, nothing below it
      const worst = rung.maxLines * rung.size * TITLE.lineHeight + RULE.gapAboveFromTitle + descExtra;
      assert.ok(worst < region * 0.5,
        `${rung.size}px x ${rung.maxLines} lines needs ${worst.toFixed(0)}px of ${region}px — the vertical constraint is now live`);
    }
  });

  await t.test('a descriptor never pushes a cover out of its frame', () => {
    // The property that actually matters, stated directly: adding three words must never
    // produce a cover that cannot be drawn.
    for (const title of ['Chaff', 'Beyond Saving', 'Arrival: Again', 'Brown-Skinned Girl',
      'The Age of Agentic AI: when machines start hacking without permission — or a human']) {
      const bare = plan({ ...BASE, title });
      const withDesc = plan({ ...BASE, title, descriptor: 'duty. sacrifice. ruin.' });
      assert.equal(withDesc.overflow, false, `${title} overflowed once it gained a descriptor`);
      assert.ok(withDesc.title.size <= bare.title.size, `${title} grew its title when given a descriptor`);
    }
  });

  await t.test('the fleuron sits at 42% of the gap below the stack', () => {
    const p = plan(BASE);
    assert.ok(p.fleuronY > p.stack.bottom && p.fleuronY < AUTHOR.y);
    const frac = (p.fleuronY - p.stack.bottom) / (AUTHOR.y - p.stack.bottom);
    assert.ok(frac > 0.30 && frac < 0.45, `fleuron at ${(frac * 100).toFixed(1)}% of the gap to the baseline`);
  });

  await t.test('no cover in any livery overflows its frame', () => {
    for (const key of Object.keys(LIVERIES)) {
      const p = plan({ ...BASE, slug: `o-${key}`, category: undefined, liveryKey: key, title: 'The Age of Agentic AI: when machines start hacking without permission — or a human' });
      assert.equal(p.overflow, false, `${key} overflowed`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('THE DESCRIPTOR — absence is a design, not a gap', async (t) => {
  registerFonts();
  const plan = (rec) => planCover(createCanvas(CANVAS.w, CANVAS.h).getContext('2d'), rec);

  await t.test('formatting: three words, full stops, TWO spaces between', () => {
    assert.equal(formatDescriptor(['duty', 'sacrifice', 'ruin']), 'DUTY.  SACRIFICE.  RUIN.');
    assert.equal(formatDescriptor('duty. sacrifice. ruin.'), 'DUTY.  SACRIFICE.  RUIN.');
    assert.equal(formatDescriptor('birth. rhythm. farewell.'), 'BIRTH.  RHYTHM.  FAREWELL.');
  });

  await t.test('absence returns null — never a placeholder', () => {
    for (const v of [null, undefined, '', '   ', [], ['', ' ']]) assert.equal(formatDescriptor(v), null);
  });

  await t.test('without a descriptor the RULE is the bottom of the stack', () => {
    const withOut = plan(BASE);
    assert.equal(withOut.descriptor, null);
    assert.equal(withOut.stack.bottom, withOut.ruleY);
  });

  await t.test('with a descriptor the stack extends and the fleuron moves DOWN', () => {
    const a = plan(BASE);
    const b = plan({ ...BASE, descriptor: 'duty. sacrifice. ruin.' });
    assert.ok(b.stack.bottom > b.ruleY);
    assert.ok(b.fleuronY > a.fleuronY, 'the fleuron takes the space only when the descriptor is absent');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('THE EDGE CASES THE GATE REQUIRES', async (t) => {
  registerFonts();
  const plan = (rec) => planCover(createCanvas(CANVAS.w, CANVAS.h).getContext('2d'), rec);

  await t.test('an unknown or missing category falls back without looking broken', () => {
    assert.equal(isKnownCategory(''), false);
    assert.equal(liveryFor('').key, 'short', 'unknown falls back to the house livery');
    assert.equal(eyebrowFor('', ''), IMPRINT_EYEBROW);
    const p = plan({ slug: 'u', title: 'The Unfiled Story', author: 'A. N. Other', category: '', subcategory: '' });
    assert.equal(p.eyebrow, 'CALVARY SCRIBBLINGS');
    assert.equal(p.footer, '', 'a missing subcategory omits the footer rather than printing a hole');
  });

  await t.test('an explicit livery names the eyebrow when the record has no category', () => {
    // The contact-sheet regression: a series instalment read CALVARY SCRIBBLINGS.
    assert.equal(plan({ slug: 's', title: 'Halfway Around the Moon', author: 'I O', liveryKey: 'series', instalmentOrdinal: 1 }).eyebrow, 'SERIES');
    // …but a real category still wins over the livery override.
    assert.equal(plan({ slug: 's2', title: 'X', author: 'Y', category: 'poetry', liveryKey: 'series' }).eyebrow, 'POETRY');
  });

  await t.test('a series instalment carries an ordinal where a story carries a subcategory', () => {
    assert.equal(instalmentFooter(1), 'INSTALMENT ONE');
    assert.equal(instalmentFooter(20), 'INSTALMENT TWENTY');
    assert.equal(instalmentFooter(21), 'INSTALMENT 21', 'past twenty it numerals rather than overrun the measure');
    assert.equal(instalmentFooter(0), '');
    assert.equal(plan({ slug: 's', title: 'X', author: 'Y', liveryKey: 'series', instalmentOrdinal: 3 }).footer, 'INSTALMENT THREE');
  });

  await t.test('accented and non-ASCII text survives composition and casing', () => {
    assert.deepEqual(clusters('Àkúdáàya'.normalize('NFD')), ['À', 'k', 'ú', 'd', 'á', 'à', 'y', 'a']);
    assert.equal(caps('Amoré'), 'AMORÉ');
    assert.equal(caps('Céline Beyoncé'), 'CÉLINE BEYONCÉ');
    const p = plan({ slug: 'a', title: 'Àkúdáàya', author: 'Céline Beyoncé Adékúnlé', category: 'poetry', subcategory: 'Spoken Word' });
    assert.deepEqual(p.title.lines, ['ÀKÚDÁÀYA']);
    assert.ok(!p.overflow);
  });

  await t.test('casing is locale-independent', () => {
    // toLocaleUpperCase under tr maps i → İ. A cover must not depend on the host locale.
    assert.equal(caps('inspiring'), 'INSPIRING');
    assert.equal(caps('i'), 'I');
  });

  await t.test('a colon title is nothing special, and neither are quotation marks', () => {
    assert.deepEqual(plan({ ...BASE, title: 'Arrival: Again' }).title.lines, ['ARRIVAL:', 'AGAIN']);
    assert.ok(!plan({ ...BASE, title: "'Release the Footage': How the Henry Nowak Case Became an International Debate" }).overflow);
  });

  await t.test('a two-word title stays on the top rung and does not step down', () => {
    assert.equal(plan({ ...BASE, title: 'Beyond Saving' }).title.size, 186);
    assert.equal(plan({ ...BASE, title: '1967' }).title.size, 186);
  });

  await t.test('a title is never split mid-word when a smaller size would set it whole', () => {
    // THE DEFECT THIS LOCKS DOWN, found on the live grid after the first sweep and not by
    // any test: "unstoppaBBL" is 1396px at 186px against a 1232px measure, so the character
    // breaker split it into UNSTOPPAB / BL — two lines, which SATISFIED the 186px rung's
    // two-line cap. The ladder stopped there and shipped a word broken across a line for no
    // reason: at 140px it is 1080px and sets whole. Three other live titles had the same
    // fault — Adadiorama, Disillusionment, Sapiosexual — all of them single long words.
    //
    // The rule now: a rung reached only by splitting a word has not fitted the title.
    for (const title of ['unstoppaBBL', 'Adadiorama', 'Disillusionment', 'Sapiosexual']) {
      const p = plan({ ...BASE, title });
      assert.equal(p.title.lines.length, 1, `${title} should set whole on one line, got ${JSON.stringify(p.title.lines)}`);
      assert.equal(p.title.lines[0], caps(title));
    }

    // THE LIMIT OF THE RULE, asserted so nobody mistakes it for a promise. A word that fits
    // at NO size on the ladder must still be broken — "never split mid-word" means "not while
    // a smaller size would help", not "never". Antidisestablishmentarianism is 28 characters
    // and overruns the measure even at the 68px fallback, so it breaks there, at the smallest
    // size, having exhausted every alternative first. That is the last resort behaving like
    // one.
    const impossible = plan({ ...BASE, title: 'Antidisestablishmentarianism' });
    assert.ok(impossible.title.lines.length > 1, 'a word too long for any rung must still break');
    assert.equal(impossible.title.size, 68, 'and it must break at the SMALLEST size, not the first');
    assert.equal(impossible.title.lines.join(''), caps('Antidisestablishmentarianism'),
      'breaking must lose no letters and invent no hyphen');
    // …but a multi-word title still wraps at spaces, and a hyphen is still preferred to both.
    assert.ok(plan({ ...BASE, title: 'Beyond Saving' }).title.lines.length <= 2);
    assert.ok(plan({ ...BASE, category: 'poetry', title: 'Brown-Skinned Girl' })
      .title.lines.some((l) => l.endsWith('-')));
  });

  await t.test("an existing hyphen is a break opportunity — the BROWN-SKI/NNED GIRL regression", () => {
    assert.deepEqual(breakParts('BROWN-SKINNED'), ['BROWN-', 'SKINNED']);
    assert.deepEqual(breakParts('CHERNOBYL'), ['CHERNOBYL']);
    assert.deepEqual(breakParts('WAIT-'), ['WAIT-'], 'a trailing hyphen creates no break after it');
    assert.deepEqual(breakParts('-30'), ['-30'], 'a leading hyphen is not a break either');
    const p = plan({ ...BASE, category: 'poetry', title: 'Brown-Skinned Girl' });
    assert.ok(p.title.lines.every((l) => !/^NNED/.test(l)), 'must never break mid-word when a hyphen was available');
    assert.ok(p.title.lines.some((l) => l.endsWith('-')), 'the hyphen stays on the leading part');
  });

  await t.test('the long author name fits', () => {
    const ctx = createCanvas(CANVAS.w, CANVAS.h).getContext('2d');
    const p = planCover(ctx, { ...BASE, author: 'Stanley Princewill McDaniels' });
    ctx.font = `${AUTHOR.size}px "Cormorant Garamond Italic"`;
    assert.ok(ctx.measureText(p.author).width < TITLE.maxWidth, 'the longest author in the library must fit the measure');
  });

  await t.test('a record with no slug or no title is refused rather than rendered', () => {
    assert.throws(() => renderCover({ title: 'X' }), /slug is required/);
    assert.throws(() => renderCover({ slug: 'x', title: '  ' }), /has no title/);
  });
});
