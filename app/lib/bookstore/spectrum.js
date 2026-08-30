// ═════════════════════════════════════════════════════════════════════════════════════════
// R30 — THE SPECTRAL SHELF
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 30 August 2026: "arrange the books by colour. Make the store beautiful."
// With a second ruling folded into the same round — no author may cluster, because publication
// order had put every one of one author's titles in a row.
//
// ⚠ CS NUMBERS ARE NOT TOUCHED BY ANY OF THIS. `catalogueNumber` is an ACCESSION MARK: it is
// permanent, never reused, never resequenced, and it is printed on the shelf ticket, the
// bookplate, the reader and My Library. What this file changes is the WALK ORDER of a shelf —
// which book stands next to which — and nothing else. The one and only place a CS number
// appears below is as the FINAL TIEBREAK, and there is a test that reads this file as text to
// keep it that way.
//
// ── WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────
//
// It is PURE. No DOM, no node built-ins, no clock, no database. It takes title records that
// already carry their colour and returns an order. That is what makes the order "a pure
// function of the catalogue": the same books produce the same shelf on every visit, in a
// browser, in a test, and — next round — in the app, which reads the SAME FIELD off the SAME
// records and runs the same arithmetic.
//
// It is NOT an extractor. Deciding what colour a cover IS happens once, at the CMS door
// (app/lib/coverDerivatives.js → buildCoverColour) or in the backfill
// (scripts/backfill-bookstore-cover-colour.mjs), and the answer is stored on the record. The
// PIXEL half of that work is the one thing here that both engines share — see
// dominantColourFromPixels below, which takes a raw buffer and knows nothing about where it
// came from. The sort itself never opens an image.
//
// THAT SEPARATION IS THE POINT AND NOT A TIDINESS PREFERENCE. R20 and R29 both learned that a
// static export has no server: there is no moment between "the reader asks for the shop" and
// "the shop paints" in which twenty-two covers could be decoded. A shelf whose order depended
// on pixels would either be wrong on first paint or not exist until the images landed.

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE RECORD — `coverColour`, and its editorial twin
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// THIS IS AN INTERFACE, NOT AN IMPLEMENTATION DETAIL. The app reads it next round. Its shape
// is written down in docs/cover-colour.md and any change to it is a change to a contract two
// repositories hold.
//
//   coverColour          { h, s, l, hex, v }   cut from the cover, by machine
//   coverColourOverride  { h, s, l, hex, v }   typed by a human in the CMS, and it wins
//
//   h    integer 0-359    degrees around the wheel
//   s    integer 0-100    HSL saturation, percent
//   l    integer 0-100    lightness, percent
//   c    integer 0-255    CHROMA — max(r,g,b) - min(r,g,b). What neutrality is judged on.
//   hex  '#rrggbb'        the same colour, for a swatch to paint. NEVER SORTED ON.
//   v    integer          shape version, currently 1
//
// ⚠ h/s/l/c ARE STORED, NOT DERIVED AT READ TIME, and the brief was explicit about it: "store
// what sorting needs — hue, saturation, lightness — not just a hex, so the sort never
// re-derives from pixels". `hex` rides along because a CMS swatch and a report both want
// something to paint, and because a human typing an override thinks in hex. It is redundant
// BY DESIGN and it is never the input to a comparison.
//
// ── WHY `c` IS ON THE RECORD WHEN IT IS ARITHMETICALLY DERIVABLE FROM s AND l ───────────────
//
// It is: c = (1 - |2l - 1|) × s × 255, exactly. It is stored anyway, and the reason is the
// sentence at the top of this section — THE APP READS THIS FIELD. Chroma is the value the
// single most consequential decision in the whole sort turns on (which end of the shop a book
// stands at), and s and l are stored ROUNDED, so re-deriving it costs about ±1 of rounding
// error in each repository independently. Making a second codebase reconstruct the sort's
// pivotal input from two rounded integers, with its own idea of the formula, is precisely the
// kind of thing an interface exists to prevent. One integer is cheaper than that argument.
//
// ── WHY THE OVERRIDE EXISTS FROM THE FIRST COMMIT AND NOT AFTER THE FIRST COMPLAINT ────────
//
// Colour is editorial the moment it is wrong. A dark painting reads as a near-neutral; a
// duotone reads as whichever of its two inks covers more board; a cover that is 70% cream with
// a red title is CREAM on a 106px shelf board, which is correct, right up until the day Ikenna
// looks at it and says it is red. There is no extractor that settles that argument, so the
// answer is a field, and a field that is designed in is a field the CMS, the backfill, the
// resolver and the tests all already know about.
//
// THE TWO ARE SEPARATE KEYS ON PURPOSE. If an override were written into `coverColour` the
// next `--force` backfill would silently erase a human decision. Instead the machine owns one
// key, the human owns the other, and coverColourOf() below states which wins.
export const COVER_COLOUR_VERSION = 1;

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE WALK — every constant it turns on, named
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * WHERE THE WHEEL STARTS. 0° is red.
 *
 * PROPOSED AND NOT AGONISED OVER, as the brief asked. The shop opens warm: the masthead sits
 * on flat black under a gold lamp, the house tone is #c9a84c, and the first row a reader sees
 * should meet that rather than argue with it. Red → orange → gold → green → blue → violet is
 * also the order every reader already has in their head from a rainbow, which is the whole
 * reason a spectral shelf reads as arrangement rather than as randomness.
 *
 * Changing this one number rotates the entire shop and nothing else — that is the test that
 * it is genuinely the origin and not twelve hard-coded band edges wearing a constant's name.
 */
export const HUE_ORIGIN = 0;

/**
 * HOW WIDE A BAND IS. 30°, so twelve bands around the wheel.
 *
 * MEASURED AGAINST THE REAL CATALOGUE, not chosen for tidiness. The 22 live covers are
 * overwhelmingly warm — the extraction run in the R30 report put the great majority of the
 * chromatic titles between 0° and 60°. At 60° bands that entire cluster collapses into ONE
 * band and is then ordered by lightness, which destroys exactly the walk this round exists to
 * build: crimson would sit next to mustard because they are both "warm". At 30° the cluster
 * splits into a red band and an orange/gold band that each grade internally, and the walk
 * survives where the catalogue actually lives.
 *
 * At 15° the bands would hold one book each and "order by lightness within a band" would stop
 * meaning anything. 30° is the width at which both halves of the rule do work.
 */
export const HUE_BAND_DEGREES = 30;

/**
 * NEUTRALS ARE THEIR OWN SHELF-END, and this is the line.
 *
 * A near-black has a hue — every colour does, arithmetically — but it is not a COLOUR on a
 * shelf, it is a black with a temperature. Filing the cream essays at 48° because their
 * off-white leans warm would drop two quiet boards into the middle of the gold band and break
 * the only thing a spectral shelf promises.
 *
 * ── THE THRESHOLD IS ON CHROMA, AND THE BRIEF'S "SATURATION" WAS TRIED FIRST ────────────────
 *
 * The brief asked for "covers with low saturation (the cream essays, near-blacks, greys)" and
 * for the threshold to be a named constant. The first half of that sentence and the second
 * half of it disagree, and the verify run is what found it out: HSL SATURATION DOES NOT
 * IDENTIFY A NEAR-BLACK. Seven of this shop's classics share a near-black livery that extracts
 * to #080710 — rgb(8,7,16), a board no reader would call violet — and its HSL saturation is
 * 39%. The Tenant of Wildfell Hall's #030109 reads 72%. HSL's saturation is a RATIO against a
 * lightness that is nearly zero, so at the dark end it amplifies a difference of nine values
 * out of 255 into most of the scale. On the measured catalogue, an s-threshold that caught
 * those eight boards would also have to be above 39 — which would swallow the deep maroon of
 * Rogues of the East (s 84) long before it got there. There is no s that separates them.
 *
 * CHROMA — max(r,g,b) - min(r,g,b), the flat distance between the channels — does, and it does
 * it with a gap you could drive a shelf through. Measured over all 22 live covers:
 *
 *     0, 0, 0, 1, 2, 3, 8, 9, 9, 9, 9, 9, 9, 9, 11, 17   │   54, 88, 104, 190, 217, 245
 *     ─────────── the cream, the greys, the near-blacks ──┴── everything with ink in it ──────
 *
 * 32 sits in the middle of that gap — twice the highest neutral, well under half the lowest
 * chromatic — so a cover would have to change substantially before it changed shelf-end. It is
 * out of 255 rather than out of 100 because that is the space the pixels are in; as a
 * percentage it is 12.5%.
 *
 * `s` IS STILL STORED. It is not what neutrality is judged on, and it is genuinely useful to
 * anything that wants to describe a colour rather than file it.
 *
 * ⚠ THE MUTATION TEST TURNS ON THIS NUMBER. tests/bookstore/spectrum.test.mjs moves the
 * threshold and asserts the arrangement changes — a suite that passed at every threshold would
 * be a suite that never tested the band at all.
 */
export const NEUTRAL_CHROMA_MAX = 32;

/**
 * WHICH END THE NEUTRALS STAND AT, and which way they grade.
 *
 * They stand LAST, after the final hue band, and they grade DARK → LIGHT.
 *
 * That is a flow decision and it is derived from the measured catalogue, not preferred. With
 * the wheel starting at red the last chromatic book in this shop is Yahoo! Yahoo!, a deep
 * green at lightness 22. A neutral band running LIGHT → DARK would put the shop's brightest
 * board — a pure-white essay at lightness 100 — hard against it, then walk back down into
 * black: a jump, and then a decline. Running DARK → LIGHT continues almost exactly the tone
 * the green ends on (22 → 0 is a short step), and the whole shelf then resolves upward into
 * the two cream essays. The shop opens warm, deepens, and closes quiet and light.
 */
export const NEUTRALS_AT_END = true;
export const NEUTRALS_DARK_TO_LIGHT = true;

/**
 * HOW FAR A BOOK MAY BE NUDGED to break a same-author adjacency. Two positions.
 *
 * The brief's own words: "a nudge of one or two positions, not a shuffle". Two is the smallest
 * window that can break a RUN of three same-author books — with a window of one, the pass can
 * step over a single neighbour but not over a pair, so an author with three consecutive titles
 * would still show a join.
 *
 * It is also the largest window that keeps the spectrum legible. A book moved two places
 * inside a graded band moves within a few percent of lightness; a book allowed to travel five
 * places could cross a band edge, and then the author rule would be quietly editing the colour
 * ruling it is supposed to be applied AFTER.
 */
export const AUTHOR_NUDGE_WINDOW = 2;

/**
 * THE SAMPLE. 48px wide, and the cover's own aspect.
 *
 * Wide enough that a title band, a spine flash or a small figure cannot win the histogram on
 * its own; small enough that both engines (a browser canvas and sharp) resample to something
 * close, and that the whole extraction is instant. R29's stand-in is 16px and R20's smallest
 * rung is 360; this sits deliberately between them, because it is measuring a field of colour
 * rather than reproducing an image.
 */
export const COVER_COLOUR_SAMPLE_WIDTH = 48;

/**
 * THE HISTOGRAM'S GRAIN. 5 bits per channel — 32 levels each, 32,768 buckets.
 *
 * 8 bits would histogram noise: a photographic cover has few exactly-repeated pixels, so the
 * winner would be a plurality of one or two and effectively arbitrary. 4 bits merges colours a
 * reader can plainly tell apart. 5 is the grain at which a book cover's actual fields of
 * colour — the board, the sky, the cloth — come out as populous buckets and the ink does not.
 */
export const COLOUR_QUANTISE_BITS = 5;

// A pixel this transparent contributes no colour to a board, and a cover uploaded as a PNG
// with a transparent margin would otherwise be extracted as black.
const ALPHA_FLOOR = 16;

// ═════════════════════════════════════════════════════════════════════════════════════════
// COLOUR ARITHMETIC — shared by both engines, so there is one answer and not two
// ═════════════════════════════════════════════════════════════════════════════════════════

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

/** sRGB 0-255 → { h: 0-359, s: 0-100, l: 0-100 }, all integers. */
export function rgbToHsl(r, g, b) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  // Rounding 359.6 up must land on 0 and not on 360 — a hue of 360 is off the end of every
  // band and would file a red book after the neutrals.
  // `c` is taken from the CHANNELS, not reconstructed from the rounded s and l below — this is
  // the one place it can be computed exactly, so it is the only place it is computed.
  return {
    h: Math.round(h) % 360,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
    c: Math.round((max - min) * 255),
  };
}

export function rgbToHex(r, g, b) {
  const p = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** '#rgb' or '#rrggbb' → { r, g, b }, or null. The CMS override's only input. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * A hex a human typed → the stored shape. The ONE place an override becomes sortable, so an
 * override and an extraction are the same kind of object by construction and the sort cannot
 * tell them apart.
 */
export function coverColourFromHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { h, s, l, c } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return { h, s, l, c, hex: rgbToHex(rgb.r, rgb.g, rgb.b), v: COVER_COLOUR_VERSION };
}

/**
 * THE DOMINANT COLOUR OF A SAMPLED COVER.
 *
 * Takes a raw interleaved pixel buffer and knows nothing else — which is what lets the browser
 * door (canvas getImageData, RGBA) and the backfill (sharp raw, RGB or RGBA) run the SAME
 * arithmetic instead of two implementations that agree until they don't.
 *
 * The method, and why it is a histogram rather than a mean:
 *
 *   A MEAN IS ALWAYS MUD. Average a red cover with black type and a cream margin and you get a
 *   brown that appears nowhere on the board. Averages of colours are not colours.
 *
 *   So: quantise to COLOUR_QUANTISE_BITS per channel, count, take the most populous bucket,
 *   and return the MEAN OF THAT BUCKET'S MEMBERS — a precise value for the field the eye
 *   actually reads, rather than the bucket's blunt centre.
 *
 * TIES BREAK ON THE LOWEST BUCKET KEY. Two fields of exactly equal area is vanishingly
 * unlikely and completely possible in flat generated art, and "whichever the loop saw first"
 * is not a specification.
 *
 * `share` — the winning bucket's fraction of the sampled pixels — is RETURNED BUT NEVER
 * STORED. It is how a report flags a cover whose colour is a weak plurality (a photograph, a
 * gradient) so a human can look at it and, if it feels wrong, type an override. Putting it on
 * the record would invite something to sort on it.
 */
export function dominantColourFromPixels(data, channels = 4) {
  if (!data || typeof data.length !== 'number' || data.length < channels) return null;
  const step = channels;
  const shift = 8 - COLOUR_QUANTISE_BITS;
  const bits = COLOUR_QUANTISE_BITS;
  const counts = new Map();
  let sampled = 0;
  for (let i = 0; i + step - 1 < data.length; i += step) {
    if (channels === 4 && data[i + 3] < ALPHA_FLOOR) continue;
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const key = ((r >> shift) << (bits * 2)) | ((g >> shift) << bits) | (b >> shift);
    let acc = counts.get(key);
    if (!acc) { acc = { n: 0, r: 0, g: 0, b: 0 }; counts.set(key, acc); }
    acc.n += 1; acc.r += r; acc.g += g; acc.b += b;
    sampled += 1;
  }
  if (!sampled) return null;

  let bestKey = -1; let best = null;
  for (const [key, acc] of counts) {
    if (best === null || acc.n > best.n || (acc.n === best.n && key < bestKey)) { best = acc; bestKey = key; }
  }
  const r = best.r / best.n; const g = best.g / best.n; const b = best.b / best.n;
  const { h, s, l, c } = rgbToHsl(r, g, b);
  return { h, s, l, c, hex: rgbToHex(r, g, b), v: COVER_COLOUR_VERSION, share: best.n / sampled };
}

/**
 * The stored shape, or null. Applied on the way IN (admin-writes) and on the way OUT
 * (coverColourOf), exactly as R29 does with the stand-in: a value that cannot sort must never
 * reach the database, and a value already in the database that cannot sort must never reach
 * the shelf.
 *
 * ⚠ `share` IS DROPPED HERE. It is a property of an extraction run, not of a book.
 */
export function normaliseCoverColour(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const h = Number(v.h); const s = Number(v.s); const l = Number(v.l);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  const rgb = typeof v.hex === 'string' ? hexToRgb(v.hex) : null;
  if (!rgb) return null;
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  const sn = clamp(Math.round(s), 0, 100);
  const ln = clamp(Math.round(l), 0, 100);
  // A record written without `c` — a hand-edited row, or one from a writer that predates this
  // field — is DERIVED rather than rejected, using the exact identity given in the header. A
  // book must never fall off the shelf because one of five numbers is missing.
  const c = Number.isFinite(Number(v.c))
    ? clamp(Math.round(Number(v.c)), 0, 255)
    : Math.round((1 - Math.abs(2 * (ln / 100) - 1)) * (sn / 100) * 255);
  return {
    h: ((Math.round(h) % 360) + 360) % 360,
    s: sn,
    l: ln,
    c,
    hex,
    v: isInt(v.v) && v.v > 0 ? v.v : COVER_COLOUR_VERSION,
  };
}

/**
 * THE COLOUR THIS BOOK SORTS BY — the override if there is one, else the extraction, else null.
 *
 * NULL IS A SUPPORTED ANSWER and it is the same posture coverSrcSet() and coverLqip() take: a
 * title whose colour has not been cut yet is a normal title, not a broken one. arrangeShelf
 * files it at the very end of the walk in CS order — see UNPLACED below — so it is present,
 * findable and obviously un-arranged, rather than dropped from the shop or scattered through
 * it at hue 0.
 */
export function coverColourOf(title) {
  return normaliseCoverColour(title?.coverColourOverride) || normaliseCoverColour(title?.coverColour) || null;
}

/** Did a human decide this one? Reports and the CMS want to say so; the sort must not care. */
export function isColourOverridden(title) {
  return normaliseCoverColour(title?.coverColourOverride) !== null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE ORDER
// ═════════════════════════════════════════════════════════════════════════════════════════

// The three shelf-ends, in walk order. Numbers, because they are compared.
const BAND_CHROMATIC = 0;
const BAND_NEUTRAL = 1;
const BAND_UNPLACED = 2;

export const HUE_BAND_COUNT = Math.ceil(360 / HUE_BAND_DEGREES);

/**
 * Which band a colour belongs to, and where that band stands in the walk.
 *
 * Returns { kind, band, label } — `kind` is one of the three shelf-ends above, `band` is the
 * index WITHIN it (a hue band 0..HUE_BAND_COUNT-1, or 0 for the others).
 */
export function spectralBandOf(colour) {
  if (!colour) return { kind: BAND_UNPLACED, band: 0, label: 'unplaced' };
  if (colour.c <= NEUTRAL_CHROMA_MAX) return { kind: BAND_NEUTRAL, band: 0, label: 'neutral' };
  // Rotated to the origin first, so HUE_ORIGIN genuinely rotates the shop rather than
  // relabelling fixed edges.
  const rotated = ((colour.h - HUE_ORIGIN) % 360 + 360) % 360;
  const band = Math.min(Math.floor(rotated / HUE_BAND_DEGREES), HUE_BAND_COUNT - 1);
  const from = (HUE_ORIGIN + band * HUE_BAND_DEGREES) % 360;
  return { kind: BAND_CHROMATIC, band, label: `${from}-${(from + HUE_BAND_DEGREES) % 360 || 360}` };
}

/**
 * THE SORT KEY, as an array of numbers compared left to right. One place, so a test can read
 * it and so the app can transcribe it.
 *
 *   [0] shelf-end      chromatic → neutral → unplaced
 *   [1] hue band       0..11 within the chromatic end; 0 for the others
 *   [2] lightness      within a hue band, so the band itself grades
 *   [3] CS number      ⚠ THE FINAL TIEBREAK, AND THE ONLY APPEARANCE OF A CS NUMBER IN THIS
 *                      WHOLE ROUND. It is here so that two books of indistinguishable colour
 *                      stand in the same order on every visit and in both repositories — a
 *                      stable sort is not enough, because the INPUT order differs between a
 *                      Firebase key walk and an app's local store.
 *   [4] slug           the last resort, for a title with no CS number yet. Compared as a
 *                      string by the comparator below, never as a number.
 *
 * ── WHY LIGHTNESS ASCENDS ──────────────────────────────────────────────────────────────────
 * Dark → light inside every band, and the neutral end takes the same direction, so the eye is
 * doing one thing for the length of the shelf instead of reversing at each edge.
 */
export function spectralKey(title) {
  const colour = coverColourOf(title);
  const { kind, band } = spectralBandOf(colour);
  const cs = isInt(title?.catalogueNumber) && title.catalogueNumber > 0 ? title.catalogueNumber : Number.MAX_SAFE_INTEGER;
  return {
    kind,
    band,
    l: colour ? colour.l : 0,
    cs,
    slug: typeof title?.slug === 'string' ? title.slug : '',
  };
}

function compareKeys(a, b) {
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.band !== b.band) return a.band - b.band;
  if (a.l !== b.l) return a.l - b.l;
  if (a.cs !== b.cs) return a.cs - b.cs;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** The colour walk alone, with no author pass. Exported so a test can assert the pass's effect. */
export function spectralWalk(titles) {
  const list = Array.isArray(titles) ? titles.filter(Boolean) : [];
  return list
    .map((t, i) => ({ t, i, k: spectralKey(t) }))
    .sort((a, b) => compareKeys(a.k, b.k) || a.i - b.i)
    .map((x) => x.t);
}

// An author key that treats "  Chinua Achebe" and "chinua achebe" as one person. Nothing else
// is normalised — two spellings of a name are a data problem for the CMS, not something a
// shelf sort should be guessing at.
const authorKey = (t) => String(t?.author || '').trim().toLowerCase();

/**
 * THE AUTHOR PASS.
 *
 * Ikenna's second ruling: no author may cluster. This is the pass that enforces it, and it
 * runs AFTER the colour walk and takes the walk as given.
 *
 * ── THE METHOD, and why it is a greedy forward pick rather than a sort ─────────────────────
 *
 * Walk the colour order as a queue. Normally take the head. If the head shares an author with
 * the book just placed, look ahead up to AUTHOR_NUDGE_WINDOW positions for the first book that
 * does not, and place THAT one first — which is the same movement as nudging the clashing book
 * down one or two places, described from the other side.
 *
 * THIS IS A NUDGE AND NOT A SHUFFLE, and the bound is structural rather than a promise: no
 * book can be displaced further than the window, because the window is the only distance the
 * pass can see. A pass that re-sorted on an author key could move a book the length of the
 * shelf and would be arranging by author with colour as a tiebreak — the opposite of the
 * ruling.
 *
 * ── IT DEGRADES, IT DOES NOT LOOP ──────────────────────────────────────────────────────────
 *
 * If no book within the window has a different author — a two-title shelf by one author, a
 * genre tab an author dominates — the pass PLACES THE CLASHING BOOK ANYWAY and records the
 * adjacency in `unbroken`. It never searches further, never backtracks and never retries. A
 * shop that hung because one author was prolific would be a worse failure than a shop with two
 * of their books side by side, and the report says which pairs it could not break.
 *
 * Returns { order, unbroken } — `unbroken` is [{ author, before, after }], the pairs that
 * survived.
 */
export function authorPass(walk) {
  const queue = walk.slice();
  const order = [];
  const unbroken = [];
  let lastAuthor = null;
  while (queue.length) {
    let pick = 0;
    if (lastAuthor !== null && authorKey(queue[0]) === lastAuthor) {
      let found = -1;
      for (let j = 1; j <= AUTHOR_NUDGE_WINDOW && j < queue.length; j += 1) {
        if (authorKey(queue[j]) !== lastAuthor) { found = j; break; }
      }
      if (found > -1) pick = found;
      else unbroken.push({ author: queue[0].author, before: order[order.length - 1]?.slug, after: queue[0].slug });
    }
    const [chosen] = queue.splice(pick, 1);
    order.push(chosen);
    lastAuthor = authorKey(chosen);
  }
  return { order, unbroken };
}

/**
 * THE SHELF. The colour walk, then the author pass. This is the whole function, and it is the
 * same one every surface calls with whatever set of books it is about to draw.
 *
 * ⚠ IT IS APPLIED TO THE FILTERED SET, NOT TO THE CATALOGUE AND THEN FILTERED. The brief:
 * "every genre tab (the order is the same function applied to the filtered set)". The colour
 * walk alone would give the same answer either way — a total order's subsequence is that
 * order — but the AUTHOR PASS would not: an adjacency that a third book separated on the All
 * Fiction shelf becomes a real adjacency the moment a tab filters that third book away, and a
 * shelf that only obeys the ruling when unfiltered does not obey it.
 *
 * Returns { order, unbroken }. spectralOrder() is the same thing for callers that only want
 * the books.
 */
export function arrangeShelf(titles) {
  return authorPass(spectralWalk(titles));
}

export function spectralOrder(titles) {
  return arrangeShelf(titles).order;
}
