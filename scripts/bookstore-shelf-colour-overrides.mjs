// ═════════════════════════════════════════════════════════════════════════════════════════
// R30.1 — THE CLASSICS GO CHROMATIC.  THE OVERRIDE RECORD.
// ═════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/bookstore-shelf-colour-overrides.mjs            # plan + the walk, no writes
//   node scripts/bookstore-shelf-colour-overrides.mjs --apply    # write coverColourOverride
//   node scripts/bookstore-shelf-colour-overrides.mjs --slug mrs-dalloway --apply
//
// ⚠ THIS FILE IS THE RECORD, NOT A MIGRATION. The values below live in the database, where a
// reader of the code cannot see them and a reader of the database cannot see WHY. So they live
// here too, with their reasons, in git, under review. If one is ever changed, changed it here.
//
// ── THE RULING ─────────────────────────────────────────────────────────────────────────────
//
// Ikenna, 30 August 2026, on reading R30's proposed shelf: the Calvary-liveried classics must
// not sort as a near-black block. They sort by their COVER ARTWORK — the museum paintings — so
// the shelf reads chromatically rather than as a short rainbow followed by a wall.
//
// ⚠ THE EXTRACTION RULE IS UNTOUCHED, AND MUST STAY UNTOUCHED. This is the whole reason the
// change is expressed as eight editorial values rather than as a smarter extractor:
//
//   A BOARD WHOSE DOMINANT COLOUR IS #080710 IS CORRECTLY READ AS NEUTRAL. rgb(8,7,16) is a
//   near-black. app/lib/bookstore/spectrum.js is right about it, chroma 32 is still the line,
//   and every future cover that arrives through the CMS door is still measured exactly the way
//   R30 measured these. NOBODY SHOULD LATER "FIX" THE EXTRACTOR TO PRODUCE THE VALUES BELOW
//   AUTOMATICALLY. Doing so would mean teaching a general rule to see past a livery that only
//   these titles wear, and it would silently re-file every honest near-black in the catalogue.
//
//   What is true of these eight is not a defect in the measurement. It is that a reader's
//   experience of them IS THE PAINTING and not the board: the livery puts the artwork on the
//   top 60% of the cover and a dark plate under it, and the plate is what wins a whole-cover
//   histogram. A curator saying "file this book under the colour a reader sees" is an
//   editorial act, and coverColourOverride is the field R30 built for exactly it.
//
// ── THE METHOD, AND WHY THE OBVIOUS VERSION OF IT FAILS ────────────────────────────────────
//
// 1. THE CROP WAS MEASURED, NOT GUESSED. Mean luminance across each cover in twentieths of its
//    height: every liveried cover holds high through band 12 and has collapsed to 8-28 by band
//    16. So the painting is the TOP 60% — above the scrim, above the wordmark and its gold
//    rule, above the title, the author, the CS number and the museum credit line.
//
// 2. ⚠ RE-RUNNING THE PLAIN DOMINANT-COLOUR RULE ON THAT CROP RETURNS MUD, and this is the
//    finding that made the round work. Measured:
//
//        Marrow of Tradition   #1d1c12      Mrs Dalloway   #343433
//        The Awakening         #9baeaa      Tenant         #434b3c
//
//    All neutral. All arithmetically correct. All useless — the change would have moved these
//    books from one grey to another. A NINETEENTH-CENTURY OIL'S MOST COMMON PIXEL IS ITS TONAL
//    GROUND, because that is what an oil painting mostly is; its colour lives in smaller,
//    more saturated regions. The dominant swatch of a painting is not the colour of a painting.
//
// 3. SO: the painting's own HUE FAMILY first — a circular mean over every swatch carrying real
//    colour (chroma >= 8), weighted by area AND saturation — and then, within that family, the
//    MOST SATURATED COLOUR THAT STILL COVERS AT LEAST 2% of the board. A real colour, really in
//    the painting, in the painting's own dominant hue.
//
// 4. AND A GATE, so the method cannot invent a colour for a picture that has none: at least
//    25% of the painting must carry chroma >= 20. The measured spread was 30.6% (Wildfell Hall,
//    the weakest kept) against 11.8% (The Rescue) and 0.0% (Equiano) — a clean gap, and the two
//    below it are LEFT ALONE. Ikenna's brief: "say so rather than forcing a hue".
//
// ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────────────────
//
// ⛔ NO CS NUMBER IS TOUCHED, read or written, anywhere in this file. Accession marks are
//    permanent. R30.1 changes where a book STANDS, never what it is called.
// ⛔ NOTHING WRITES `coverColour`. That key belongs to the machine, and the whole point of two
//    keys is that re-cutting the extraction can never erase a human's decision. This script
//    writes `coverColourOverride` and nothing else.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { coverColourFromHex, coverColourOf, spectralBandOf, arrangeShelf, NEUTRAL_CHROMA_MAX } from '../app/lib/bookstore/spectrum.js';
import { titlesInGroup, sortGenres, GENRE_SEED, groupLabel } from '../app/lib/bookstore/genres.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const TITLES_PATH = 'bookstore_titles';

/**
 * THE EIGHT. Slug → the colour a reader sees, and why.
 *
 * `area` is how much of the painting carries chroma >= 20; `family` is the painting's hue and
 * how coherent it is (1.00 = every coloured pixel agrees). Both are recorded because they are
 * the evidence the value rests on, and a later reader deserves to see it without re-running
 * anything.
 */
export const SHELF_COLOUR_OVERRIDES = {
  'the-marrow-of-tradition': {
    hex: '#48290b', area: 0.431, family: 36, coherence: 0.93,
    art: 'Winslow Homer, Dressing for the Carnival, 1877',
    why: 'Deep russet. 95% of the painting is warm and it is very coherent — greens sit behind '
       + 'the figures but the ink is umber, red and gold. ⚠ Its hue rounds to EXACTLY 30, the '
       + 'band edge, so it files as the darkest book in 30-60 rather than the reddest in 0-30. '
       + 'The hue family is 36, so gold is the honest home; this is the boundary landing where '
       + 'the painting already pointed, not a near-miss to be nudged.',
  },
  'the-autobiography-of-an-ex-colored-man': {
    hex: '#46361b', area: 0.646, family: 47, coherence: 0.92,
    art: 'Henry Ossawa Tanner, The Young Sabot Maker, 1895',
    why: 'Ochre. After Nietzsche the most coherent warm painting of the nine — a workshop '
       + 'interior lit in amber, 65% of it carrying colour.',
  },
  'the-sport-of-the-gods': {
    hex: '#3c6267', area: 0.426, family: 174, coherence: 0.74,
    art: 'Childe Hassam, Broadway and 42nd Street, 1902',
    why: 'Teal. Every populous swatch in the painting sits between hue 162 and 189 — a night '
       + 'city, unmistakably blue-green. It opens the 180-210 band, which nothing in this '
       + 'catalogue occupied before.',
  },
  'beyond-good-and-evil': {
    hex: '#e4cca8', area: 0.677, family: 34, coherence: 0.99,
    art: 'the arches at sunset',
    why: 'Gold. The most strongly coloured of the nine — 68% of the painting carries chroma at '
       + 'a coherence of 0.99. No judgement call in this one at all.',
  },
  'the-tenant-of-wildfell-hall': {
    hex: '#666749', area: 0.306, family: 63, coherence: 0.91,
    art: 'John Atkinson Grimshaw, A Moonlit Lane, 1874',
    why: 'Olive green, and coherent — but its most saturated real colour is CHROMA 30, two '
       + 'under the line. ⚠ THIS BOOK DOES NOT REACH A HUE BAND, and that is the rule working '
       + 'rather than failing: a muted moonlit lane is a neutral. What the override buys is '
       + 'that it stands at the painting\'s own lightness of 35 instead of the plate\'s 2, so '
       + 'it sorts to the right place WITHIN the neutral band. Do not raise it to clear the '
       + 'threshold — that would be editing the measurement to beat a rule Ikenna kept.',
  },
  'the-awakening': {
    hex: '#8dacb4', area: 0.487, family: 50, coherence: 0.62,
    art: 'Winslow Homer, a beach scene',
    why: '⭑ AN EDITORIAL CALL THAT OVERRIDES A MEASUREMENT, and the one value here that a '
       + 'later reader would otherwise "correct". This is the only genuinely SPLIT painting of '
       + 'the nine — coherence 0.62, warm 60% of the board against cool 38% — and the warm '
       + 'reading (#93866b, the sand) WON ON AREA and was the defensible default I proposed. '
       + 'Ikenna took the cool: "the novel is a woman and the sea, and the cover is a beach '
       + 'scene; the sky is what the book is about." That is precisely what coverColourOverride '
       + 'exists for, so it is written down as such: DO NOT RESTORE THE MAJORITY COLOUR. The '
       + 'measurement is not wrong and the value is not a mistake — a person chose between two '
       + 'true readings of the same picture, on grounds a histogram cannot hold.',
  },
  'mrs-dalloway': {
    hex: '#786846', area: 0.476, family: 45, coherence: 0.93,
    art: "Roger Fry, The Artist's Garden at Durbins, 1915",
    why: 'Warm ochre — and this swatch will argue with your eye, which goes to the foliage. '
       + 'The measurement holds: Fry\'s greens are heavily desaturated (a single green swatch, '
       + '3% of the board at chroma 12) while the path, the grass and the dress carry all the '
       + 'actual colour in the picture.',
  },
  // ── AND ONE THAT IS NOT A HUE ────────────────────────────────────────────────────────────
  'the-interesting-narrative-of-the-life-of-olaudah-equiano': {
    hex: '#787977', area: 0.0, family: null, coherence: null,
    art: 'A Shipwreck in a Storm, 1782',
    why: 'A NEUTRAL CORRECTION, NOT A COLOUR. Not one swatch in this painting reaches chroma 8 '
       + '— it is a grey storm and there is no hue to give it, so it stays in the neutral band '
       + 'either way. What this buys is truthfulness about WHERE in that band: the stored '
       + 'extraction is the dark PLATE at lightness 5, and the painting reads at 47. Cheap, and '
       + 'it stops a light grey standing among the near-blacks.',
  },
};

// ── LEFT ALONE, DELIBERATELY, AND IT IS PART OF THE RECORD ─────────────────────────────────
//
// THE RESCUE (CS 012, Joseph Conrad) carries NO override and must not be given one. Only 11.8%
// of its painting reaches chroma 20, and that is a sliver of warm cloud-edge on a charcoal
// storm; filing it as brown on the strength of 2% of its area is the forcing the brief
// explicitly refused. Its cover is also not the Calvary classics livery at all — it has no dark
// plate — so its stored extraction is already the painting, and there is nothing to correct.
export const LEFT_NEUTRAL_ON_PURPOSE = ['the-rescue'];

const APPLY = process.argv.includes('--apply');
const ONLY = (() => { const i = process.argv.indexOf('--slug'); return i > -1 ? process.argv[i + 1] : null; })();

const swatch = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m    \x1b[0m`;
};
const pad = (s, n) => String(s).length >= n ? String(s).slice(0, n) : String(s) + ' '.repeat(n - String(s).length);

async function main() {
  const key = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(key), databaseURL: DB_URL });
  const db = getDatabase();

  const all = (await db.ref(TITLES_PATH).once('value')).val() || {};
  const gval = (await db.ref('bookstore_genres').once('value')).val() || {};
  const genres = Object.keys(gval).length
    ? sortGenres(Object.entries(gval).map(([slug, g]) => ({ slug, ...g })))
    : sortGenres(GENRE_SEED);
  const rows = Object.entries(all).map(([id, t]) => ({ id, ...t }));
  const bySlug = new Map(rows.map((t) => [t.slug, t]));

  console.log(`${Object.keys(SHELF_COLOUR_OVERRIDES).length} override(s) on record`);
  console.log(APPLY ? 'APPLYING — coverColourOverride will be written.\n' : 'PLAN ONLY — nothing will be written. Add --apply.\n');

  let done = 0; let failed = 0;
  const applied = new Map();
  for (const [slug, spec] of Object.entries(SHELF_COLOUR_OVERRIDES)) {
    if (ONLY && slug !== ONLY) continue;
    const t = bySlug.get(slug);
    if (!t) { failed++; console.log(`  ✗ ${pad(slug, 56)} no such title`); continue; }
    const colour = coverColourFromHex(spec.hex);
    if (!colour) { failed++; console.log(`  ✗ ${pad(slug, 56)} ${spec.hex} is not a hex colour`); continue; }
    applied.set(slug, colour);
    const band = spectralBandOf(colour).label;
    console.log(`  ✓ ${pad(slug, 56)} ${swatch(colour.hex)} ${colour.hex} h${String(colour.h).padStart(3)} l${String(colour.l).padStart(3)} c${String(colour.c).padStart(3)}  → ${band === 'neutral' ? 'NEUTRAL' : band + '°'}`);
    // ⚠ ONE KEY. Not the record, not coverColour, not catalogueNumber — the override alone.
    if (APPLY) await db.ref(`${TITLES_PATH}/${t.id}/coverColourOverride`).set(colour);
    done++;
  }
  console.log(`\n${done} written${APPLY ? '' : ' (planned)'}, ${failed} failed`);
  console.log(`left neutral on purpose: ${LEFT_NEUTRAL_ON_PURPOSE.join(', ')}`);

  // ── THE RESULTING WALK ───────────────────────────────────────────────────────────────────
  const published = rows.filter((t) => t.status === 'published')
    .map((t) => (applied.has(t.slug) ? { ...t, coverColourOverride: applied.get(t.slug) } : t));
  for (const group of ['fiction', 'nonfiction']) {
    const half = titlesInGroup(genres, published, group);
    if (!half.length) continue;
    const { order, unbroken } = arrangeShelf(half);
    console.log(`\n── ALL ${groupLabel(group).toUpperCase()} — ${order.length} book(s) ${'─'.repeat(30)}`);
    let last = null;
    order.forEach((t, i) => {
      const c = coverColourOf(t); const b = spectralBandOf(c);
      const bl = b.label === 'neutral' ? `NEUTRALS (chroma ≤ ${NEUTRAL_CHROMA_MAX}, dark → light)` : `HUE ${b.label}°`;
      if (bl !== last) { console.log(`   · ${bl}`); last = bl; }
      console.log(`  ${String(i + 1).padStart(3)} ${swatch(c.hex)} ${c.hex} h${String(c.h).padStart(3)} l${String(c.l).padStart(3)} c${String(c.c).padStart(3)}  CS ${String(t.catalogueNumber).padStart(3, '0')}  ${pad(t.title, 36)} ${pad(t.author, 22)}${applied.has(t.slug) ? ' ◆' : ''}`);
    });
    console.log(`  ${unbroken.length ? `⚠ ${unbroken.length} same-author adjacency kept: ` + unbroken.map((u) => `${u.author} (${u.before} / ${u.after})`).join('; ') : '✓ no same-author adjacency remains'}`);
  }
  if (!APPLY) console.log('\nRe-run with --apply to write them.');
  process.exit(failed ? 1 : 0);
}

// ⚠ ONLY WHEN RUN DIRECTLY. This file is a RECORD as much as a script — SHELF_COLOUR_OVERRIDES
// is imported by tests and by report generators, and an import that opened a database
// connection and started writing would make the record unreadable by anything but itself.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((err) => { console.error(err); process.exit(1); });
