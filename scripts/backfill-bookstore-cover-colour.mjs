// R30 — CUT THE DOMINANT COLOUR FOR EVERY BOOKSTORE COVER THAT PREDATES THE DOOR.
//
//   node scripts/backfill-bookstore-cover-colour.mjs            # plan + THE PROPOSED SHELF, no writes
//   node scripts/backfill-bookstore-cover-colour.mjs --apply    # extract and write coverColour
//   node scripts/backfill-bookstore-cover-colour.mjs --slug basil --apply
//   node scripts/backfill-bookstore-cover-colour.mjs --force --apply    # re-cut existing ones
//   node scripts/backfill-bookstore-cover-colour.mjs --json report.json # the run, machine-readable
//
// Requires serviceAccountKey.json at the repo root, like every other script here.
//
// It is the same shape, the same flags and the same posture as
// scripts/backfill-bookstore-cover-lqip.mjs, deliberately: one backfill pattern in this tree,
// not three. /admin/bookstore cuts the colour in the browser at upload time (makeCoverColour in
// app/lib/bookstore/admin-writes.js), so this catches only what was uploaded before that line
// existed.
//
// ── IT ALSO PRINTS THE SHELF, AND THAT IS NOT A CONVENIENCE ─────────────────────────────────
//
// The brief for this round was VERIFY-FIRST: extract every live cover and put the proposed
// walk order in front of Ikenna BEFORE the shop is rearranged, so the shelf can be read before
// it is walked. Plan mode therefore ends by running the REAL arrangeShelf() from
// app/lib/bookstore/spectrum.js over the extracted values — not a second implementation that
// could agree with the shop today and drift tomorrow.
//
// ⚠ NOTHING IS UPLOADED, and no CS number is touched. The colour is five small values on the
// record. `catalogueNumber` is not read by this script except to print it beside a title, and
// is never written.
//
// ⚠ AN OVERRIDE IS NEVER OVERWRITTEN, not even by --force. `coverColourOverride` is a human
// decision and this script writes `coverColour` only. When a title carries an override, the
// proposed shelf below places it by the override — because that is what the shop will do —
// and the row is marked so the report never looks like the machine agreed.
//
// ⚠ sharp IS SCRIPT-ONLY and deliberately out of package.json, exactly as the derivative and
// stand-in backfills say of it. This never runs in a build.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import sharp from 'sharp';
import { coverSizeKey, COVER_DERIVATIVE_WIDTHS } from '../app/lib/bookstore/covers.js';
// The fiction / non-fiction split, read from the SAME module the shop reads it from and
// applied to the SAME live bookstore_genres records. A report that split the catalogue by a
// list of its own would be describing a shop that does not exist.
import { GENRE_SEED, sortGenres, titlesInGroup, groupLabel } from '../app/lib/bookstore/genres.js';
import {
  COVER_COLOUR_SAMPLE_WIDTH,
  dominantColourFromPixels,
  normaliseCoverColour,
  coverColourOf,
  isColourOverridden,
  spectralBandOf,
  arrangeShelf,
  NEUTRAL_CHROMA_MAX,
  HUE_ORIGIN,
  HUE_BAND_DEGREES,
  AUTHOR_NUDGE_WINDOW,
} from '../app/lib/bookstore/spectrum.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const TITLES_PATH = 'bookstore_titles';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };
const ONLY = argAfter('--slug');
const JSON_OUT = argAfter('--json');

// A cover whose dominant bucket is a weak plurality is a photograph or a gradient, not a field
// of colour — the extraction is arithmetically right and may still feel wrong on the shelf.
// Under this share the row is FLAGGED for a human to look at, which is the whole reason
// coverColourOverride exists. It is a reporting threshold only: nothing sorts on it and it is
// never stored.
const WEAK_SHARE = 0.14;

/** The lightest honest source, exactly as the stand-in backfill picks it: w360, else original. */
function sourceFor(t) {
  for (const w of COVER_DERIVATIVE_WIDTHS) {
    const u = t.coverSizes?.[coverSizeKey(w)];
    if (u) return { url: u, from: coverSizeKey(w) };
  }
  return t.coverUrl ? { url: t.coverUrl, from: 'original' } : null;
}

const swatch = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  // A true-colour block, so the terminal shows the shelf rather than describing it.
  return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m    \x1b[0m`;
};

const pad = (s, n) => String(s).length >= n ? String(s).slice(0, n) : String(s) + ' '.repeat(n - String(s).length);
const csMark = (n) => (Number.isInteger(n) && n > 0 ? `CS ${String(n).padStart(3, '0')}` : '  —    ');

function printShelf(label, rows) {
  const { order, unbroken } = arrangeShelf(rows);
  console.log(`\n── ${label} — ${order.length} book(s), in walk order ${'─'.repeat(Math.max(0, 46 - label.length))}`);
  let lastBand = null;
  order.forEach((t, i) => {
    const c = coverColourOf(t);
    const b = spectralBandOf(c);
    if (b.label !== lastBand) {
      console.log(`   · ${b.label === 'neutral' ? 'NEUTRALS (dark → light)' : b.label === 'unplaced' ? 'NO COLOUR YET' : `HUE ${b.label}°`}`);
      lastBand = b.label;
    }
    const marks = [
      isColourOverridden(t) ? 'override' : null,
      t.__weak ? 'weak-plurality' : null,
    ].filter(Boolean);
    console.log(
      `  ${pad(i + 1, 3)} ${c ? swatch(c.hex) : '  ??'} ${c ? c.hex : '       '} ` +
      `h${pad(c ? c.h : "-", 4)}l${pad(c ? c.l : "-", 4)}c${pad(c ? c.c : "-", 5)} ` +
      `${csMark(t.catalogueNumber)}  ${pad(t.title, 34)} ${pad(t.author, 22)}${marks.length ? '  ⚑ ' + marks.join(', ') : ''}`,
    );
  });
  if (unbroken.length) {
    console.log(`  ⚠ ${unbroken.length} same-author adjacency could not be broken within ${AUTHOR_NUDGE_WINDOW} position(s):`);
    for (const u of unbroken) console.log(`      ${u.author} — ${u.before} / ${u.after}`);
  } else {
    console.log('  ✓ no same-author adjacency remains');
  }
  return { order, unbroken };
}

async function main() {
  const key = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(key), databaseURL: DB_URL });
  const db = getDatabase();

  const snap = await db.ref(TITLES_PATH).once('value');
  const all = snap.val() || {};
  const rows = Object.entries(all)
    .map(([id, t]) => ({ id, ...t }))
    .filter((t) => (ONLY ? t.slug === ONLY : true))
    .filter((t) => t.coverUrl || t.coverSizes);

  console.log(`${rows.length} title(s) with a cover${ONLY ? ` matching --slug ${ONLY}` : ''}`);
  console.log(`origin ${HUE_ORIGIN}°, bands of ${HUE_BAND_DEGREES}°, neutral at chroma ≤ ${NEUTRAL_CHROMA_MAX}/255, nudge window ${AUTHOR_NUDGE_WINDOW}`);
  console.log(APPLY ? 'APPLYING — coverColour will be written.\n' : 'PLAN ONLY — nothing will be written. Add --apply.\n');

  let done = 0; let skipped = 0; let failed = 0;
  const report = [];
  for (const t of rows) {
    const already = normaliseCoverColour(t.coverColour);
    if (already && !FORCE) {
      skipped++;
      console.log(`  · ${pad(t.slug, 30)} already has a colour ${swatch(already.hex)} ${already.hex} (--force to re-cut)`);
      report.push({ slug: t.slug, status: 'skipped', colour: already });
      continue;
    }
    const src = sourceFor(t);
    if (!src) { skipped++; console.log(`  · ${pad(t.slug, 30)} no cover to extract from`); report.push({ slug: t.slug, status: 'no-cover' }); continue; }
    try {
      const buf = Buffer.from(await (await fetch(src.url)).arrayBuffer());
      // `raw` after the resize, so the arithmetic below sees exactly the pixels sharp produced
      // and never a re-encode. Alpha kept so a transparent margin is skipped, not read as black.
      const { data, info } = await sharp(buf)
        .resize({ width: COVER_COLOUR_SAMPLE_WIDTH })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cut = dominantColourFromPixels(data, info.channels);
      if (!cut) throw new Error('no opaque pixels');
      const colour = normaliseCoverColour(cut);
      t.coverColour = colour;
      t.__weak = cut.share < WEAK_SHARE;
      done++;
      console.log(
        `  ✓ ${pad(t.slug, 30)} ${swatch(colour.hex)} ${colour.hex} ` +
        `h${pad(colour.h, 4)}l${pad(colour.l, 4)}c${pad(colour.c, 5)} ` +
        `${(cut.share * 100).toFixed(1).padStart(5)}% of board from ${src.from}${t.__weak ? '   ⚑ weak plurality — look at this one' : ''}`,
      );
      report.push({ slug: t.slug, status: 'extracted', colour, share: cut.share, from: src.from });
      if (APPLY) await db.ref(`${TITLES_PATH}/${t.id}/coverColour`).set(colour);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${pad(t.slug, 30)} ${err.message}`);
      report.push({ slug: t.slug, status: 'failed', error: err.message });
    }
  }

  console.log(`\n${done} extracted, ${skipped} skipped, ${failed} failed`);

  // ── THE PROPOSED SHELF ────────────────────────────────────────────────────────────────
  //
  // Published titles only, split into the TWO SHELVES THE SHOP ACTUALLY DRAWS and arranged by
  // the shop's own function. This is the list the round is approved against, so it has to be
  // the shop's arrangement and not a summary of it: the whole catalogue in one list would read
  // as a walk nobody can take, because /bookstore never puts fiction and non-fiction on the
  // same shelf.
  const published = rows.filter((t) => t.status === 'published');
  const gsnap = await db.ref('bookstore_genres').once('value');
  const gval = gsnap.val() || {};
  const genres = Object.keys(gval).length
    ? sortGenres(Object.entries(gval).map(([slug, g]) => ({ slug, ...g })))
    : sortGenres(GENRE_SEED);

  const shelves = {};
  for (const group of ['fiction', 'nonfiction']) {
    const half = titlesInGroup(genres, published, group);
    if (half.length) shelves[group] = printShelf(`ALL ${groupLabel(group).toUpperCase()}`, half);
  }
  // Every genre tab is the same function over the filtered set — printed so the report shows
  // what a reader who touches a tab will actually walk, not just the two unfiltered shelves.
  console.log('\n── THE GENRE TABS ' + '─'.repeat(52));
  for (const g of genres) {
    const tab = published.filter((t) => t.genre === g.slug);
    if (!tab.length) continue;
    const { order, unbroken } = arrangeShelf(tab);
    console.log(`  ${pad(g.label, 26)} ${order.map((t) => (coverColourOf(t) ? swatch(coverColourOf(t).hex) : ' ?? ')).join('')}` +
      `  ${order.map((t) => t.slug).join(' · ')}${unbroken.length ? `   ⚠ ${unbroken.length} adjacency kept` : ''}`);
  }

  if (JSON_OUT) {
    await writeFile(resolve(ROOT, JSON_OUT), JSON.stringify({
      generatedAt: new Date().toISOString(),
      constants: { HUE_ORIGIN, HUE_BAND_DEGREES, NEUTRAL_CHROMA_MAX, AUTHOR_NUDGE_WINDOW },
      // The curator's own spelling and order, from bookstore_genres. Carried into the report so
      // that anything reading this file prints the label Ikenna typed rather than deriving one
      // from a slug — the exact drift the old CMS GENRE_OPTIONS caused on four of twelve.
      genres: genres.map((g) => ({ slug: g.slug, label: g.label, group: g.group, order: g.order })),
      extraction: report,
      shelves: Object.fromEntries(Object.entries(shelves).map(([g, v]) => [g, {
        order: v.order.map((t, i) => ({
          position: i + 1,
          slug: t.slug,
          title: t.title,
          author: t.author,
          catalogueNumber: t.catalogueNumber ?? null,
          genre: t.genre,
          colour: coverColourOf(t),
          overridden: isColourOverridden(t),
          weakPlurality: !!t.__weak,
        })),
        unbroken: v.unbroken,
      }])),
      // ⚠ NO MERGED "whole catalogue" ORDER. /bookstore never puts fiction and non-fiction on
      // one shelf, so a single combined list would be a walk nobody can take — and the app
      // round reads this file. Two shelves, because there are two shelves.
    }, null, 2), 'utf8');
    console.log(`\nwrote ${JSON_OUT}`);
  }

  if (!APPLY && done) console.log('\nRe-run with --apply to write them.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
