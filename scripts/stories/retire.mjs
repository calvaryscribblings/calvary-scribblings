// RETIRE A cms_stories RECORD — or, deliberately, bring one back. W35.
//
// DRY RUN BY DEFAULT. Writes ONLY with --apply. Needs serviceAccountKey.json at the repo root.
//
//   node scripts/stories/retire.mjs                              # plan: the Book Reader pull
//   node scripts/stories/retire.mjs --apply                      # back up, then retire them
//   node scripts/stories/retire.mjs --unretire <slug>            # plan: what un-retiring touches
//   node scripts/stories/retire.mjs --unretire <slug> --apply    # back up, then remove ONE marker
//
// What "retired" means, and every path that honours it, is in app/lib/retiredStories.js.
//
// ── RETIRE ────────────────────────────────────────────────────────────────────────────────
// One atomic multi-path update per run:
//   cms_stories_retired/{slug}     the marker — { retiredAt, retiredOn, reason }
//   cms_stories/{slug}/published   false
//   cms_stories/{slug}/hiddenAt    kept if present, else now — the Worker's own "taken down" mark
//   cms_stories/{slug}/coverHold   null — a held record is what the reconciler publishes
//   cms_stories_index/{slug}       null
// Nothing else on the record is touched: not readerMode, not bookReader, not quizMeta (see
// scripts/pull-book-reader-collection.mjs on why un-ticking readerMode would revive two quizzes).
//
// ── UN-RETIRE ─────────────────────────────────────────────────────────────────────────────
// Removes cms_stories_retired/{slug} and NOTHING ELSE. The record stays unpublished and hidden.
// An editor then opens it in /admin and unhides it like any hidden story — a second, separate,
// visible act. There is no button for this half, by design.
//
// Prints slugs, titles and flags. Never a story's text.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { RETIRED_PATH, BOOK_READER_REASON, BOOK_READER_PULLED } from '../../app/lib/retiredStories.js';
import { INDEX_PATH } from '../../app/lib/storyIndex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const ui = process.argv.indexOf('--unretire');
const UNRETIRE = ui >= 0 ? process.argv[ui + 1] : null;

/** The update a retirement writes. Pure — tests/ci/retired-stories.test.mjs asserts its shape. */
export function retirePaths(slug, story, { now = Date.now(), reason = BOOK_READER_REASON, retiredOn = '2026-08-16' } = {}) {
  return {
    [`${RETIRED_PATH}/${slug}`]: { retiredAt: now, retiredOn, reason },
    [`cms_stories/${slug}/published`]: false,
    [`cms_stories/${slug}/hiddenAt`]: typeof story?.hiddenAt === 'number' ? story.hiddenAt : now,
    [`cms_stories/${slug}/coverHold`]: null,
    [`${INDEX_PATH}/${slug}`]: null,
  };
}

/** The update an un-retirement writes: the marker, and only the marker. */
export function unretirePaths(slug) {
  return { [`${RETIRED_PATH}/${slug}`]: null };
}

function backup(name, data) {
  mkdirSync(resolve(ROOT, 'backups'), { recursive: true });
  const f = resolve(ROOT, 'backups', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(f, JSON.stringify(data, null, 2));
  if (readFileSync(f, 'utf8') !== JSON.stringify(data, null, 2)) throw new Error('backup did not read back identically');
  return f;
}

const without = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)));

async function main() {
  const svc = JSON.parse(readFileSync(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(svc), databaseURL: DB_URL });
  const db = getDatabase();
  const read = async (p) => (await db.ref(p).get()).val();

  if (UNRETIRE) {
    const marker = await read(`${RETIRED_PATH}/${UNRETIRE}`);
    if (!marker) { console.log(`${UNRETIRE} is not retired. Nothing to do.`); return; }
    console.log(`UN-RETIRE ${UNRETIRE} — removes ${RETIRED_PATH}/${UNRETIRE} only (reason: ${marker.reason}).`);
    console.log('The record stays unpublished and hidden; unhide it in /admin afterwards if that is the decision.');
    if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); return; }
    const f = backup(`unretire-${UNRETIRE}`, { marker, story: await read(`cms_stories/${UNRETIRE}`) });
    console.log(`backup: ${f}`);
    await db.ref().update(unretirePaths(UNRETIRE));
    console.log(`✓ marker removed: ${!(await read(`${RETIRED_PATH}/${UNRETIRE}`))}`);
    return;
  }

  const before = {};
  for (const slug of BOOK_READER_PULLED) {
    before[slug] = {
      story: await read(`cms_stories/${slug}`),
      index: await read(`${INDEX_PATH}/${slug}`),
      marker: await read(`${RETIRED_PATH}/${slug}`),
    };
  }
  const present = BOOK_READER_PULLED.filter((s) => before[s].story);
  const absent = BOOK_READER_PULLED.filter((s) => !before[s].story);
  console.log(`Book Reader pull of 16 Aug 2026 — ${BOOK_READER_PULLED.length} records, ${present.length} present, ${absent.length} deleted since`);
  for (const slug of BOOK_READER_PULLED) {
    const s = before[slug].story;
    if (!s) { console.log(`   ${slug.padEnd(40)} DELETED — no record to mark; skipped`); continue; }
    console.log(`   ${slug.padEnd(40)} published=${s.published} hiddenAt=${s.hiddenAt ? 'set' : '—'} coverHold=${s.coverHold ?? '—'} index=${before[slug].index ? 'YES' : '—'} retired=${before[slug].marker ? 'already' : '—'}`);
  }

  const now = Date.now();
  const updates = Object.assign({}, ...present.map((slug) => retirePaths(slug, before[slug].story, { now })));
  console.log(`\n${Object.keys(updates).length} paths in one atomic update.`);
  if (!APPLY) { console.log('DRY RUN — re-run with --apply.'); return; }

  const f = backup('w35-retire-book-reader', before);
  console.log(`backup: ${f}`);
  await db.ref().update(updates);

  // Re-read every record touched and compare it to the pre-write read (CLAUDE.md, probes rule 4).
  let bad = 0;
  for (const slug of present) {
    const s = await read(`cms_stories/${slug}`);
    const okMarker = !!(await read(`${RETIRED_PATH}/${slug}`));
    const okIndex = !(await read(`${INDEX_PATH}/${slug}`));
    const okState = s.published === false && typeof s.hiddenAt === 'number' && s.coverHold == null;
    const rest = (o) => JSON.stringify(without(o, ['published', 'hiddenAt', 'coverHold']));
    const okRest = rest(s) === rest(before[slug].story);
    const ok = okMarker && okIndex && okState && okRest;
    if (!ok) bad++;
    console.log(`   ${ok ? '✓' : '✗'} ${slug.padEnd(40)} marker=${okMarker} unindexed=${okIndex} state=${okState} everything-else-unchanged=${okRest}`);
  }
  if (bad) { console.error(`\n${bad} record(s) did not verify.`); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(process.exitCode || 0), (e) => { console.error(e?.message || e); process.exit(1); });
}
