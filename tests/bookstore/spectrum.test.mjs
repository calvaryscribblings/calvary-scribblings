// R30 — THE SPECTRAL SHELF, as arithmetic.
//
// The order is the only thing this round changes, so it is the only thing this suite asserts.
// It is a NODE test and not a Playwright one on purpose: arrangeShelf is pure, and a pure
// function tested through a browser is a slower test of the same thing plus a build.
//
// ⚠ EVERY FIXTURE BELOW IS INVENTED. That is deliberate and it is the opposite of the decision
// live-slug.mjs makes for the surface suites. Those must not hardcode a slug because the
// catalogue is Ikenna's; this one must not READ the catalogue, because it is asserting that
// the arrangement is a pure function — a suite whose expected order came from the same
// database as its input would pass no matter what the function did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  arrangeShelf,
  spectralOrder,
  spectralWalk,
  authorPass,
  spectralBandOf,
  coverColourOf,
  coverColourFromHex,
  normaliseCoverColour,
  rgbToHsl,
  dominantColourFromPixels,
  NEUTRAL_CHROMA_MAX,
  HUE_ORIGIN,
  HUE_BAND_DEGREES,
  AUTHOR_NUDGE_WINDOW,
  COVER_COLOUR_VERSION,
} from '../../app/lib/bookstore/spectrum.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SPECTRUM_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/spectrum.js'), 'utf8');

let nextCs = 1;
/** A title carrying a real extracted-shape colour. `hex` is the only thing a case has to say. */
const book = (slug, hex, author = 'Someone', extra = {}) => ({
  id: slug,
  slug,
  title: slug,
  author,
  catalogueNumber: nextCs++,
  coverColour: hex ? coverColourFromHex(hex) : null,
  ...extra,
});

const slugs = (list) => list.map((t) => t.slug);

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE ORDER IS A PURE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────────────

test('the same books produce the same shelf, whatever order they arrive in', () => {
  nextCs = 1;
  const shelf = [
    book('crimson', '#b40100'),
    book('gold', '#f6a300', 'B'),
    book('cream', '#f5f5f5', 'C'),
    book('forest', '#036b45', 'D'),
    book('ink', '#080710', 'E'),
    book('rust', '#713219', 'F'),
  ];
  const expected = slugs(spectralOrder(shelf));

  // Every rotation, and a reversal. The INPUT order must contribute nothing.
  for (let i = 0; i < shelf.length; i += 1) {
    const rotated = shelf.slice(i).concat(shelf.slice(0, i));
    assert.deepEqual(slugs(spectralOrder(rotated)), expected, `rotation by ${i} changed the shelf`);
  }
  assert.deepEqual(slugs(spectralOrder(shelf.slice().reverse())), expected, 'reversing the input changed the shelf');

  // And calling it twice on the same input is the same answer — no hidden clock, no random.
  assert.deepEqual(slugs(spectralOrder(shelf)), expected);
});

test('the walk runs through the spectrum from the origin, not by hash', () => {
  nextCs = 1;
  // One book per 60° of the wheel, fed in backwards.
  const wheel = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];
  const shelf = wheel.map((hex, i) => book(`h${i * 60}`, hex, `A${i}`)).reverse();
  assert.deepEqual(slugs(spectralOrder(shelf)), ['h0', 'h60', 'h120', 'h180', 'h240', 'h300']);
  assert.equal(HUE_ORIGIN, 0, 'the shop is documented as opening warm; a new origin needs a new ruling');
});

test('within a hue band the shelf grades by lightness, dark to light', () => {
  nextCs = 1;
  // Four reds, all inside the 0-30° band, fed in lightness-scrambled order.
  const shelf = [
    book('mid', '#b40100', 'A'),
    book('darkest', '#3b0605', 'B'),
    book('lightest', '#ff8a80', 'C'),
    book('dark', '#6b0301', 'D'),
  ];
  const order = spectralOrder(shelf);
  for (const t of order) assert.equal(spectralBandOf(coverColourOf(t)).band, 0, `${t.slug} left the red band`);
  assert.deepEqual(slugs(order), ['darkest', 'dark', 'mid', 'lightest']);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// NEUTRALS BAND AT THE THRESHOLD — including the mutation the brief asked for
// ─────────────────────────────────────────────────────────────────────────────────────────

test('neutrals form one band at the end of the walk, dark to light', () => {
  nextCs = 1;
  const shelf = [
    book('white', '#fefefe', 'A'),
    book('scarlet', '#c62a08', 'B'),
    book('black', '#000000', 'C'),
    book('near-black-violet', '#080710', 'D'), // HSL says s=39%. It is a near-black.
    book('gold', '#f5bd1c', 'E'),
  ];
  const order = slugs(spectralOrder(shelf));
  assert.deepEqual(order, ['scarlet', 'gold', 'black', 'near-black-violet', 'white']);

  // Stated as the rule rather than as this one list: every chromatic book precedes every
  // neutral, and the neutrals never interleave.
  const kinds = spectralOrder(shelf).map((t) => spectralBandOf(coverColourOf(t)).label === 'neutral');
  assert.deepEqual(kinds, [...kinds].sort((a, b) => (a === b ? 0 : a ? 1 : -1)), 'a neutral stood among the colours');
});

test('THE MUTATION: moving the threshold moves books across the shelf-end', () => {
  // The brief's own test — "move the threshold, test reddens". If this passed at every
  // threshold, the neutral band would not be being tested at all.
  //
  // #6b3a30 has chroma 59: chromatic under the shipped threshold of 32, neutral under a
  // threshold of 64. The assertion is that the SHIPPED constant puts it with the colours, and
  // that a re-banded copy of the same arithmetic puts it with the neutrals — the mutation is
  // applied to a local re-implementation of spectralBandOf's one comparison, because mutating
  // an imported constant is not something a module can be asked to allow.
  const brown = coverColourFromHex('#6b3a30');
  assert.equal(brown.c, 59);
  assert.equal(spectralBandOf(brown).label, `${HUE_ORIGIN}-${HUE_ORIGIN + HUE_BAND_DEGREES}`, 'at the shipped threshold this is a colour');

  const bandUnder = (colour, threshold) => (colour.c <= threshold ? 'neutral' : 'chromatic');
  assert.equal(bandUnder(brown, NEUTRAL_CHROMA_MAX), 'chromatic');
  assert.equal(bandUnder(brown, 64), 'neutral', 'a raised threshold must reclassify it');
  assert.equal(bandUnder(coverColourFromHex('#080710'), NEUTRAL_CHROMA_MAX), 'neutral');
  assert.equal(bandUnder(coverColourFromHex('#080710'), 4), 'chromatic', 'a lowered threshold must reclassify it');
});

test('the near-blacks the live catalogue actually holds are neutrals, not violets', () => {
  // The finding that changed this round's design, pinned so it cannot regress: seven of the
  // shop's classics share a livery that extracts to #080710 — HSL saturation 39%, chroma 9.
  // Judged on saturation they file at 247° and stand in the middle of the shop.
  for (const hex of ['#080710', '#030109', '#0d0c0a', '#140b09', '#030314', '#010101']) {
    const c = coverColourFromHex(hex);
    assert.equal(spectralBandOf(c).label, 'neutral', `${hex} (s=${c.s}%, chroma=${c.c}) must be a neutral`);
  }
  // …and the deep maroon that a saturation threshold high enough to catch them would swallow.
  assert.equal(spectralBandOf(coverColourFromHex('#3b0605')).label, '0-30', '#3b0605 is a colour');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE AUTHOR PASS
// ─────────────────────────────────────────────────────────────────────────────────────────

test('the author pass breaks every breakable adjacency', () => {
  nextCs = 1;
  // Colour order puts three of A's books in a row with B's and C's either side.
  const shelf = [
    book('a1', '#3b0605', 'A'),
    book('a2', '#6b0301', 'A'),
    book('a3', '#b40100', 'A'),
    book('b1', '#c62a08', 'B'),
    book('c1', '#ff8a80', 'C'),
  ];
  const { order, unbroken } = arrangeShelf(shelf);
  assert.deepEqual(unbroken, [], 'this shelf is breakable and none should have survived');
  for (let i = 1; i < order.length; i += 1) {
    assert.notEqual(order[i].author, order[i - 1].author, `${order[i - 1].slug} / ${order[i].slug} still cluster`);
  }
});

test('the pass displaces minimally — never further than the window', () => {
  nextCs = 1;
  const shelf = [
    book('a1', '#3b0605', 'A'), book('a2', '#6b0301', 'A'), book('b1', '#8b0200', 'B'),
    book('c1', '#b40100', 'C'), book('c2', '#c62a08', 'C'), book('d1', '#e04a20', 'D'),
    book('e1', '#ff8a80', 'E'),
  ];
  const walk = slugs(spectralWalk(shelf));
  const order = slugs(arrangeShelf(shelf).order);
  for (const slug of walk) {
    const moved = Math.abs(order.indexOf(slug) - walk.indexOf(slug));
    assert.ok(moved <= AUTHOR_NUDGE_WINDOW, `${slug} moved ${moved} places — the window is ${AUTHOR_NUDGE_WINDOW}`);
  }
  // The pass is a permutation of the walk and not a filter of it.
  assert.deepEqual([...order].sort(), [...walk].sort());
});

test('the pass does not destroy the spectrum it was handed', () => {
  nextCs = 1;
  // The adversarial shape: books spread right across the wheel, and EVERY neighbouring pair in
  // the colour walk shares an author. A pass that re-sorted on an author key would drag a green
  // into the reds to make the names alternate.
  const shelf = [
    book('red-a', '#c62a08', 'A'), book('red-b', '#e04a20', 'A'),
    book('gold-a', '#f6a300', 'B'), book('gold-b', '#f5bd1c', 'B'),
    book('green-a', '#036b45', 'C'), book('green-b', '#2fbf7f', 'C'),
  ];
  const walk = slugs(spectralWalk(shelf));
  const order = slugs(arrangeShelf(shelf).order);

  // ⚠ THE GUARANTEE IS A BOUND, NOT MONOTONICITY, and the difference is worth stating because
  // the first version of this test asserted the wrong one and failed honestly.
  //
  // On the fixture above the pass DOES cross a band edge: it lifts gold-a over red-b to break
  // A/A, so a gold stands between two reds. That is a swap of one position, which is exactly
  // what a nudge is, and forbidding it would forbid the author ruling from applying at a band
  // edge at all. What must not happen is a book travelling far enough to arrive somewhere it
  // has no business being.
  //
  // So: ANY TWO BOOKS FURTHER APART IN THE WALK THAN TWO NUDGES CAN REACH STAY IN WALK ORDER.
  // The spectrum survives intact at every scale larger than the nudge, which is the whole of
  // what "a nudge, not a shuffle" can mean.
  const reach = 2 * AUTHOR_NUDGE_WINDOW;
  for (let i = 0; i < walk.length; i += 1) {
    for (let j = i + reach + 1; j < walk.length; j += 1) {
      assert.ok(
        order.indexOf(walk[i]) < order.indexOf(walk[j]),
        `${walk[i]} and ${walk[j]} were ${j - i} apart in the spectrum and the pass reversed them`,
      );
    }
  }
  // And a red never ends up after a green — the ends of the walk are untouched.
  assert.ok(order.indexOf('red-a') < order.indexOf('green-a'));
  assert.ok(order.indexOf('red-b') < order.indexOf('green-b'));
});

test('an unbreakable shelf degrades and reports, and does not loop', () => {
  nextCs = 1;
  const shelf = [book('a1', '#3b0605', 'A'), book('a2', '#6b0301', 'A'), book('a3', '#b40100', 'A')];
  const { order, unbroken } = arrangeShelf(shelf);
  assert.equal(order.length, 3, 'every book must still be on the shelf');
  assert.equal(unbroken.length, 2, 'both adjacencies must be reported, not hidden');
  assert.deepEqual(unbroken.map((u) => u.author), ['A', 'A']);
});

test('author matching ignores case and surrounding space, and nothing else', () => {
  nextCs = 1;
  const shelf = [
    book('one', '#3b0605', 'Ikenna Okeh'),
    book('two', '#6b0301', '  ikenna okeh '),
    book('three', '#b40100', 'Someone Else'),
  ];
  const order = arrangeShelf(shelf).order;
  assert.notEqual(order[0].author.trim().toLowerCase(), order[1].author.trim().toLowerCase());
});

test('the pass is applied to the filtered set, so a tab cannot re-open a cluster', () => {
  nextCs = 1;
  // On the whole shelf, B's book separates A's two. Filter B away — as a genre tab does — and
  // the arrangement must break the pair that has just closed up, rather than inheriting an
  // order computed against books that are no longer on the page.
  const a1 = book('a1', '#3b0605', 'A', { genre: 'literary' });
  const b1 = book('b1', '#6b0301', 'B', { genre: 'crime' });
  const a2 = book('a2', '#b40100', 'A', { genre: 'literary' });
  const c1 = book('c1', '#c62a08', 'C', { genre: 'literary' });
  assert.deepEqual(slugs(spectralOrder([a1, b1, a2, c1])), ['a1', 'b1', 'a2', 'c1']);
  const tab = [a1, a2, c1].filter((t) => t.genre === 'literary');
  const order = arrangeShelf(tab);
  assert.deepEqual(order.unbroken, []);
  assert.deepEqual(slugs(order.order), ['a1', 'c1', 'a2']);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// CS NUMBERS ARE A TIEBREAK AND NOTHING ELSE
// ─────────────────────────────────────────────────────────────────────────────────────────

test('CS number breaks a tie, and only a tie', () => {
  nextCs = 1;
  const same = '#080710';
  const shelf = [
    { ...book('third', same, 'A'), catalogueNumber: 30 },
    { ...book('first', same, 'B'), catalogueNumber: 10 },
    { ...book('second', same, 'C'), catalogueNumber: 20 },
  ];
  assert.deepEqual(slugs(spectralWalk(shelf)), ['first', 'second', 'third']);

  // But a HIGHER CS number that is a different colour still sorts by colour: the number never
  // outranks the walk.
  nextCs = 1;
  const mixed = [
    { ...book('late-red', '#c62a08', 'A'), catalogueNumber: 99 },
    { ...book('early-neutral', '#f5f5f5', 'B'), catalogueNumber: 1 },
  ];
  assert.deepEqual(slugs(spectralOrder(mixed)), ['late-red', 'early-neutral']);
});

test('CS numbers are never resequenced and appear nowhere but the tiebreak', () => {
  nextCs = 1;
  const shelf = [book('a', '#c62a08', 'A'), book('b', '#f5f5f5', 'B'), book('c', '#036b45', 'C')];
  const before = shelf.map((t) => [t.slug, t.catalogueNumber]);
  spectralOrder(shelf);
  assert.deepEqual(shelf.map((t) => [t.slug, t.catalogueNumber]), before, 'the sort mutated a record');

  // Read as text: `catalogueNumber` may be mentioned in this module exactly where the key is
  // built and in the prose that explains it, and must never be assigned.
  assert.equal(/catalogueNumber\s*=[^=]/.test(SPECTRUM_SRC), false, 'spectrum.js assigns a catalogue number');
  const reads = SPECTRUM_SRC.split('\n').filter((l) => /title\??\.catalogueNumber/.test(l));
  assert.equal(reads.length, 1, `catalogueNumber is read on ${reads.length} lines; it may be read once, to build the tiebreak`);
});

test('a title with no CS number still has a fixed place', () => {
  nextCs = 1;
  const shelf = [
    { ...book('zeta', '#080710', 'A'), catalogueNumber: null },
    { ...book('alpha', '#080710', 'B'), catalogueNumber: null },
    { ...book('numbered', '#080710', 'C'), catalogueNumber: 5 },
  ];
  // The numbered one first — an absent number sorts last, not as zero — then slug order.
  assert.deepEqual(slugs(spectralWalk(shelf)), ['numbered', 'alpha', 'zeta']);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE RECORD, AND THE OVERRIDE
// ─────────────────────────────────────────────────────────────────────────────────────────

test('the override wins, and clearing it hands the book back to the machine', () => {
  const t = {
    slug: 'x',
    coverColour: coverColourFromHex('#080710'),
    coverColourOverride: coverColourFromHex('#c62a08'),
  };
  assert.equal(coverColourOf(t).hex, '#c62a08');
  assert.equal(spectralBandOf(coverColourOf(t)).label, '0-30', 'the override must move the book off the neutral end');
  assert.equal(coverColourOf({ ...t, coverColourOverride: null }).hex, '#080710');
  assert.equal(coverColourOf({ ...t, coverColourOverride: '' }).hex, '#080710');
  assert.equal(coverColourOf({ ...t, coverColourOverride: { hex: 'nonsense' } }).hex, '#080710');
});

test('a book with no colour at all is filed at the end, in CS order, never dropped', () => {
  nextCs = 1;
  const shelf = [
    { ...book('nocolour-b', null, 'A'), catalogueNumber: 20 },
    book('red', '#c62a08', 'B'),
    { ...book('nocolour-a', null, 'C'), catalogueNumber: 10 },
    book('cream', '#f5f5f5', 'D'),
  ];
  assert.deepEqual(slugs(spectralOrder(shelf)), ['red', 'cream', 'nocolour-a', 'nocolour-b']);
});

test('normaliseCoverColour refuses what cannot sort and derives what it can', () => {
  assert.equal(normaliseCoverColour(null), null);
  assert.equal(normaliseCoverColour({ h: 1, s: 2 }), null, 'a partial record must not sort');
  assert.equal(normaliseCoverColour({ h: 1, s: 2, l: 3, hex: 'red' }), null, 'hex must be #rrggbb');
  // Chroma derived from a record that predates the field — the identity in the header.
  const derived = normaliseCoverColour({ h: 247, s: 39, l: 5, hex: '#080710' });
  assert.ok(Math.abs(derived.c - 9) <= 2, `derived chroma ${derived.c} should be about 9`);
  assert.equal(spectralBandOf(derived).label, 'neutral');
  // Out-of-range values are clamped and wrapped rather than rejected.
  const wild = normaliseCoverColour({ h: 400, s: 300, l: -5, c: 999, hex: '#c62a08', v: 1 });
  assert.deepEqual([wild.h, wild.s, wild.l, wild.c], [40, 100, 0, 255]);
  assert.equal(wild.v, COVER_COLOUR_VERSION);
});

test('a hue of 359.6 rounds to 0 and stays a red', () => {
  // Rounding to 360 would put the book off the end of every band, after the neutrals.
  const c = rgbToHsl(255, 0, 2);
  assert.ok(c.h === 0 || c.h === 359, `hue came back as ${c.h}`);
  assert.notEqual(c.h, 360);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE EXTRACTOR — the one piece both writers share
// ─────────────────────────────────────────────────────────────────────────────────────────

test('the dominant colour is the most populous field, not the average', () => {
  // Three-quarters deep red, one quarter white. The mean would be pink; the answer is red.
  const px = [];
  for (let i = 0; i < 300; i += 1) px.push(180, 1, 0, 255);
  for (let i = 0; i < 100; i += 1) px.push(255, 255, 255, 255);
  const cut = dominantColourFromPixels(Uint8ClampedArray.from(px), 4);
  assert.equal(cut.hex, '#b40100');
  assert.equal(cut.share, 0.75);
});

test('fully transparent pixels contribute nothing', () => {
  const px = [];
  for (let i = 0; i < 500; i += 1) px.push(0, 0, 0, 0);      // a transparent margin
  for (let i = 0; i < 100; i += 1) px.push(246, 163, 0, 255); // the artwork
  const cut = dominantColourFromPixels(Uint8ClampedArray.from(px), 4);
  assert.equal(cut.hex, '#f6a300');
  assert.equal(cut.share, 1, 'the margin should not be in the denominator either');
  assert.equal(dominantColourFromPixels(Uint8ClampedArray.from([0, 0, 0, 0]), 4), null);
});

test('the extractor takes RGB as happily as RGBA, so both writers can feed it', () => {
  const rgba = []; const rgb = [];
  for (let i = 0; i < 40; i += 1) { rgba.push(3, 107, 69, 255); rgb.push(3, 107, 69); }
  assert.equal(dominantColourFromPixels(Uint8ClampedArray.from(rgba), 4).hex,
               dominantColourFromPixels(Uint8ClampedArray.from(rgb), 3).hex);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS ROUND IS NOT ALLOWED TO HAVE TOUCHED
// ─────────────────────────────────────────────────────────────────────────────────────────

test('the sort is the only change the storefront made', () => {
  const SHOP = readFileSync(join(ROOT, 'app/bookstore/page.js'), 'utf8');
  // Applied to the filtered grid, once.
  const calls = SHOP.split('\n').filter((l) => /spectralOrder\(/.test(l) && !l.trim().startsWith('//'));
  assert.equal(calls.length, 1, `spectralOrder is called on ${calls.length} lines; the shelf has one order`);
  // R15's placement arithmetic still reads the shelf's LENGTH and the cut DEPTHS, which a
  // re-ordering cannot change. If either of these disappears, the placement suite's guarantee
  // that the tables did not move has quietly stopped being structural.
  assert.match(SHOP, /planShopFlow\(curatedBanded, shelvesOnPage\)/);
  assert.match(SHOP, /shelfRuns\(grid, interleaves\)/);
  // R29's stand-in, R27's absent fade and R25's rhythm are not order questions and must not
  // have been re-opened by this round.
  assert.equal(/spectral/i.test(readFileSync(join(ROOT, 'app/bookstore/components/BoundBook.js'), 'utf8')), false,
    'the board learned about the sort; it must not need to');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R30.1 — THE OVERRIDES ARE EDITORIAL, AND THE EXTRACTOR STAYS HONEST
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// Ikenna, 30 Aug 2026: the Calvary-liveried classics sort by their painting, not their board.
// The mechanism is the override field, and the RULE IS UNTOUCHED. These tests exist so that the
// second half of that sentence keeps being true — the failure they are guarding against is a
// later round deciding to be helpful and teaching the extractor to see past the livery.

test('⛔ the extractor knows nothing about any particular book', () => {
  // ⚠ AGAINST THE CODE, NOT THE PROSE. spectrum.js names The Tenant of Wildfell Hall and the
  // #080710 livery in its comments ON PURPOSE — they are the measured evidence the chroma
  // threshold rests on, and deleting that evidence to satisfy a test would make the file worse.
  // What must never appear is a BRANCH on a particular book. So: strip the comments, then look.
  const code = SPECTRUM_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/\/\/.*$/gm, '');
  for (const name of ['marrow', 'dalloway', 'awakening', 'equiano', 'wildfell', 'nietzsche', 'calvary', 'livery']) {
    assert.equal(code.toLowerCase().includes(name), false,
      `the executable half of spectrum.js mentions "${name}" — the sort must not know which books these are`);
  }
  // And no override value is written into the rule, in code OR comment: an editorial colour
  // sitting in the extractor is the first step towards the extractor producing it.
  for (const hex of ['48290b', '46361b', '3c6267', 'e4cca8', '666749', '8dacb4', '786846', '787977']) {
    assert.equal(SPECTRUM_SRC.toLowerCase().includes(hex), false,
      `spectrum.js contains the override value #${hex}; editorial values live in the CMS, not in the rule`);
  }
  // No per-title table of any kind reached the module.
  assert.equal(/coverColourOverride\s*=/.test(code), false, 'spectrum.js assigns an override; it may only read one');
});

test('⛔ a near-black board is still read as a neutral — the rule R30.1 did NOT change', () => {
  // The livery's board. If a later round "fixes" the extractor to make these titles chromatic,
  // this is what breaks, and it is meant to.
  assert.equal(NEUTRAL_CHROMA_MAX, 32, 'the threshold moved; R30.1 was explicit that it must not');
  assert.equal(spectralBandOf(coverColourFromHex('#080710')).label, 'neutral');
  assert.equal(spectralBandOf(coverColourFromHex('#030109')).label, 'neutral');
  // The plain dominant-colour rule over the painting crop returns these — measured, and the
  // reason the overrides are hand-set rather than extracted. All four must still read neutral.
  for (const mud of ['#1d1c12', '#343433', '#9baeaa', '#434b3c']) {
    assert.equal(spectralBandOf(coverColourFromHex(mud)).label, 'neutral',
      `${mud} is what the plain rule returns for one of these paintings; it is a neutral and must stay one`);
  }
});

test('the eight approved values land where the record says they land', () => {
  // Read from the override record itself, so this cannot drift from what was written.
  const REC = readFileSync(join(ROOT, 'scripts/bookstore-shelf-colour-overrides.mjs'), 'utf8');
  const expected = {
    'the-marrow-of-tradition': ['#48290b', '30-60'],
    'the-autobiography-of-an-ex-colored-man': ['#46361b', '30-60'],
    'the-sport-of-the-gods': ['#3c6267', '180-210'],
    'beyond-good-and-evil': ['#e4cca8', '30-60'],
    'the-tenant-of-wildfell-hall': ['#666749', 'neutral'],
    'the-awakening': ['#8dacb4', '180-210'],
    'mrs-dalloway': ['#786846', '30-60'],
    'the-interesting-narrative-of-the-life-of-olaudah-equiano': ['#787977', 'neutral'],
  };
  for (const [slug, [hex, band]] of Object.entries(expected)) {
    assert.ok(new RegExp(`'${slug}':\\s*\\{\\s*\\n?\\s*hex: '${hex}'`).test(REC),
      `the record no longer carries ${slug} at ${hex}`);
    assert.equal(spectralBandOf(coverColourFromHex(hex)).label, band, `${slug} (${hex}) changed band`);
  }
  // ⚠ The Awakening is an EDITORIAL call over a measurement — the warm reading won on area and
  // was overruled. If someone "corrects" it back to the majority colour, this fails.
  assert.equal(spectralBandOf(coverColourFromHex('#93866b')).label, '30-60',
    'the warm reading of The Awakening is the one that was overruled; it is still a gold');
  assert.ok(/93866b/.test(REC), 'the record must keep the overruled warm value, or the decision is invisible');
  // ⚠ The Rescue is left alone deliberately, and its absence is load-bearing.
  assert.ok(/LEFT_NEUTRAL_ON_PURPOSE = \['the-rescue'\]/.test(REC), 'The Rescue is no longer recorded as deliberately left alone');
  assert.equal(/'the-rescue':\s*\{/.test(REC), false, 'The Rescue was given an override; 11.8% coloured area is the forcing the brief refused');
});

test('the override record writes ONE key, and never a CS number', () => {
  const REC = readFileSync(join(ROOT, 'scripts/bookstore-shelf-colour-overrides.mjs'), 'utf8');
  // db.ref(...).set(...) only. A Map.set on a local variable is not a write to anything.
  const writes = REC.split('\n')
    .filter((l) => /db\.ref\(/.test(l) && /\.set\(/.test(l) && !l.trim().startsWith('//'));
  assert.equal(writes.length, 1, `the record performs ${writes.length} database writes; it may perform exactly one`);
  assert.match(writes[0], /coverColourOverride/, 'the one database write is not to coverColourOverride');
  // ⛔ Never the machine's key, and never an accession mark.
  assert.equal(/\/coverColour`/.test(REC), false, "the record writes coverColour; that key belongs to the machine");
  assert.equal(/catalogueNumber`\)/.test(REC), false, 'the record writes a catalogue number');
});

test('the module is pure — no clock, no database, no DOM', () => {
  for (const forbidden of ['Date.now', 'Math.random', 'firebase', 'document.', 'window.', 'localStorage']) {
    assert.equal(SPECTRUM_SRC.includes(forbidden), false, `spectrum.js reaches for ${forbidden}`);
  }
  assert.equal(/^import /m.test(SPECTRUM_SRC), false, 'spectrum.js imports something; it is meant to stand alone');
});
