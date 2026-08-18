// THE DESCRIPTOR REVIEW SHEET — the backfill's second sweep.
//
//   node scripts/covers/descriptor-sheet.mjs --extract          # story text → batches to read
//   node scripts/covers/descriptor-sheet.mjs --sheet            # drafts.json → the review sheet
//   node scripts/covers/descriptor-sheet.mjs --ingest           # REFUSED without ratification
//
// ════════════════════════════════════════════════════════════════════════════════════════
// NOTHING IN THIS FILE PUBLISHES ANYTHING TONIGHT
// ════════════════════════════════════════════════════════════════════════════════════════
// The sweep has three steps and a person sits between the second and the third:
//
//   1. EXTRACT   every published story's full text, in batches, for reading.
//   2. DRAFT     three words per story against the rubric below → covers-descriptors/drafts.json
//                → `--sheet` renders ONE review sheet, one line per story: title, then the
//                  three words. That is the artefact Ikenna edits and ratifies on the iPad.
//   3. INGEST    read the RATIFIED sheet back, write descriptors, regenerate those covers
//                through the same new-path-and-flip mechanics as scripts/covers/migrate.mjs.
//
// Step 3 is built and it is GATED. `--ingest` refuses unless covers-descriptors/RATIFIED.md
// exists, for the same reason the migration refuses without a sign-off: a draft is a
// proposal, and only a person turns a proposal into copy that goes on 150 covers.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// THE RUBRIC — derived from the three approved examples
// ════════════════════════════════════════════════════════════════════════════════════════
//   DUTY. SACRIFICE. RUIN.      BIRTH. RHYTHM. FAREWELL.      RAIN. REPETITION. DREAD.
//
// Reading those three back, the pattern they share:
//
//   · SINGLE PUNCHY WORDS. One word each, short. No phrases, no hyphenated compounds
//     standing in for a phrase, nothing that needs a second breath to say.
//   · FROM THE STORY'S OWN THEMES — not from its plot summary and not from its genre.
//     "RAIN. REPETITION. DREAD." is what that story FEELS like, not what happens in it.
//   · MOSTLY ABSTRACT NOUNS, WITH THE OCCASIONAL CONCRETE ONE. Note that each example
//     carries at most one concrete noun — RAIN, BIRTH — and it is doing the work of an
//     image against two abstractions. Three abstractions in a row reads as a thesaurus;
//     three concrete nouns reads as a props list.
//   · NEVER A WORD FROM THE TITLE. A cover that says ODELUWA over "ODELUWA. GRIEF. RETURN."
//     has spent a third of its descriptor saying nothing.
//   · AN ARC, LOOSELY. All three examples move: duty → sacrifice → ruin is a cost mounting,
//     birth → rhythm → farewell is a life. The third word is where the story lands.
//
// And the rule that outranks all of them: IF THERE IS NO GOOD ANSWER, LEAVE IT EMPTY. The
// generator treats absence as a finished design; a padded descriptor is worse than none, and
// roughly half a library wearing no descriptor at all is the expected outcome, not a gap.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDescriptor, canonicalDescriptor, wordsEchoingTitle, DESCRIPTOR_EXAMPLES } from '../../app/lib/coverDescriptor.js';
import { isIndexed } from '../../app/lib/storyIndex.js';
import { parseArgs } from './generate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const WORK = join(ROOT, 'covers-descriptors');
const DRAFTS = join(WORK, 'drafts.json');
const RATIFIED = join(WORK, 'RATIFIED.md');
const BATCH_SIZE = 12;

const strip = (html) => String(html ?? '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

async function published() {
  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) throw new Error(`cms_stories read failed: HTTP ${res.status}`);
  const all = await res.json();
  return Object.entries(all).filter(([, s]) => isIndexed(s))
    .map(([slug, s]) => ({
      slug, title: s.title || '', author: s.author || '',
      category: s.categoryName || s.category || '', subcategory: s.subcategory || '',
      text: strip(s.content), existing: s.descriptor || '',
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Write the corpus out in batches for reading. Text only — no writes anywhere. */
async function extract() {
  const stories = await published();
  mkdirSync(WORK, { recursive: true });
  const batches = Math.ceil(stories.length / BATCH_SIZE);
  for (let b = 0; b < batches; b++) {
    const slice = stories.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const body = slice.map((s, i) => [
      `## [${b * BATCH_SIZE + i + 1}/${stories.length}] ${s.title}`,
      `slug: ${s.slug} · ${s.category}${s.subcategory ? ' / ' + s.subcategory : ''} · ${s.author}` +
      `${s.existing ? ` · EXISTING DESCRIPTOR: ${s.existing}` : ''}`,
      `words: ${s.text.split(/\s+/).filter(Boolean).length}`,
      '', s.text, '',
    ].join('\n')).join('\n---\n\n');
    writeFileSync(join(WORK, `batch-${String(b + 1).padStart(2, '0')}.md`), body);
  }
  writeFileSync(join(WORK, 'index.json'), JSON.stringify(
    stories.map(({ slug, title, author, category, subcategory, existing }) =>
      ({ slug, title, author, category, subcategory, existing })), null, 2));
  const words = stories.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  console.log(`${stories.length} published stories → ${batches} batches of ${BATCH_SIZE} in ${WORK}/`);
  console.log(`${words.toLocaleString()} words of story text to read`);
}

/**
 * Render the review sheet from drafts.json.
 *
 * ONE LINE PER STORY: title, then the proposed three words. That shape is the requirement,
 * and it is the requirement because the sheet is read and edited ON AN IPAD — anything with
 * more furniture per row stops being scannable at 150 rows. The Markdown table is what gets
 * ratified; the HTML beside it is only for reading comfortably.
 */
function sheet() {
  if (!existsSync(DRAFTS)) { console.error(`no drafts at ${DRAFTS} — run --extract, then draft.`); process.exit(2); }
  const drafts = JSON.parse(readFileSync(DRAFTS, 'utf8'));
  const index = JSON.parse(readFileSync(join(WORK, 'index.json'), 'utf8'));
  const bySlug = new Map(index.map((s) => [s.slug, s]));

  const rows = [];
  const problems = [];
  for (const d of drafts) {
    const meta = bySlug.get(d.slug);
    if (!meta) { problems.push(`${d.slug} — not a published story`); continue; }
    const v = validateDescriptor(d.descriptor);
    if (!v.ok) problems.push(`${d.slug} — ${v.error}`);
    const echo = wordsEchoingTitle(d.descriptor, meta.title);
    if (echo.length) problems.push(`${d.slug} — repeats "${echo.join(', ')}" from the title`);
    rows.push({ ...meta, descriptor: v.empty ? '' : canonicalDescriptor(d.descriptor), note: d.note || '' });
  }
  const missing = index.filter((s) => !drafts.some((d) => d.slug === s.slug));

  const md = [
    '# Cover descriptors — review sheet',
    '',
    'One line per story. **Edit the third column and nothing else.** Three words, each with a',
    'full stop. To reject a descriptor entirely, empty the cell — an empty cell is a decision,',
    'and the cover is finished without one: the fleuron takes the space.',
    '',
    `Rubric: single punchy words from the story's own themes · mostly abstract nouns with the`,
    'occasional concrete one · never a word from the title · the third word is where it lands.',
    '',
    `Approved examples: ${DESCRIPTOR_EXAMPLES.map((e) => `**${e.toUpperCase()}**`).join(' · ')}`,
    '',
    `${rows.length} stories · ${rows.filter((r) => r.descriptor).length} with a proposed descriptor · ` +
    `${rows.filter((r) => !r.descriptor).length} deliberately left empty`,
    '',
    '| # | Story | Descriptor |',
    '|---|---|---|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.title.replace(/\|/g, '\\|')} | ${r.descriptor} |`),
    '',
    '---',
    '',
    '## To ratify',
    '',
    'Rename this file to `RATIFIED.md` once the descriptors are as you want them.',
    '`npm run covers:descriptors -- --ingest` refuses to run until that file exists, and reads',
    'the third column back verbatim.',
    '',
  ].join('\n');
  writeFileSync(join(WORK, 'REVIEW-SHEET.md'), md);

  console.log(`review sheet → ${join(WORK, 'REVIEW-SHEET.md')}`);
  console.log(`  ${rows.length} rows · ${rows.filter((r) => r.descriptor).length} proposed · ${rows.filter((r) => !r.descriptor).length} left empty`);
  if (missing.length) console.log(`  ${missing.length} published stories have no draft row: ${missing.slice(0, 6).map((s) => s.slug).join(', ')}${missing.length > 6 ? '…' : ''}`);
  if (problems.length) {
    console.log(`\n  ${problems.length} rubric problem(s) — these are printed, not silently dropped:`);
    for (const p of problems) console.log(`    ${p}`);
  }
}

/** Parse the ratified sheet's table back into { slug, descriptor } rows, matching on title. */
export function parseRatified(md, index) {
  const byTitle = new Map(index.map((s) => [s.title.trim().toLowerCase(), s]));
  const out = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*\d+\s*\|(.+?)\|(.*?)\|\s*$/);
    if (!m) continue;
    const title = m[1].replace(/\\\|/g, '|').trim();
    const meta = byTitle.get(title.toLowerCase());
    if (!meta) { out.push({ title, error: 'no published story with this title' }); continue; }
    out.push({ slug: meta.slug, title, descriptor: m[2].trim() });
  }
  return out;
}

async function ingest() {
  if (!existsSync(RATIFIED)) {
    console.error(
      'REFUSED — the sheet has not been ratified.\n\n' +
      `  ${RATIFIED} does not exist. Nothing here writes a descriptor or regenerates a\n` +
      '  cover until it does. Review covers-descriptors/REVIEW-SHEET.md, edit the third\n' +
      '  column, and rename it to RATIFIED.md.',
    );
    process.exit(3);
  }
  const index = JSON.parse(readFileSync(join(WORK, 'index.json'), 'utf8'));
  const rows = parseRatified(readFileSync(RATIFIED, 'utf8'), index);
  const bad = rows.filter((r) => r.error || !validateDescriptor(r.descriptor).ok);
  if (bad.length) {
    console.error(`REFUSED — ${bad.length} row(s) in the ratified sheet do not validate:`);
    for (const r of bad) console.error(`  ${r.title} — ${r.error ?? validateDescriptor(r.descriptor).error}`);
    process.exit(4);
  }
  const withDesc = rows.filter((r) => validateDescriptor(r.descriptor).empty === false);
  console.log(`ratified sheet parsed: ${rows.length} rows, ${withDesc.length} carry a descriptor.`);

  // The ratified sheet, canonicalised into the shape the migration consumes. Written to disk
  // rather than passed in memory so that the exact input to the sweep is inspectable
  // afterwards — "what did it actually write?" should never need re-deriving from a Markdown
  // table. An EMPTY cell is preserved as '' and written as '': emptying a cell is a decision
  // to remove a descriptor, and it must survive the trip.
  const payload = Object.fromEntries(rows.map((r) => [r.slug, canonicalDescriptor(r.descriptor)]));
  const payloadPath = join(WORK, 'ratified.json');
  writeFileSync(payloadPath, JSON.stringify(payload, null, 1));
  console.log(`  → ${payloadPath}`);

  if (!args.apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to action the ratification.');
    console.log('It will: write each descriptor and the cover that displays it in ONE atomic');
    console.log('patch per story, regenerate every cover, and flip through the same preflight,');
    console.log('manifest and buildIndexRecord re-projection as the main sweep.\n');
    for (const r of withDesc.slice(0, 8)) console.log(`  ${r.slug.padEnd(46)} ${canonicalDescriptor(r.descriptor)}`);
    if (withDesc.length > 8) console.log(`  … and ${withDesc.length - 8} more`);
    return;
  }

  // ── HAND OFF TO THE MIGRATION ──────────────────────────────────────────────────────────
  // Deliberately NOT reimplemented here. migrate.mjs owns the preflight, the manifest, the
  // atomic patch, the index re-projection and the rollback snapshots; a second copy of that
  // logic living in the descriptor script is exactly how two subtly different migrations end
  // up in one repo. This runs THE migration, with descriptors supplied and regeneration on.
  console.log('\nhanding off to scripts/covers/migrate.mjs --apply --regenerate\n');
  const migrate = fileURLToPath(new URL('./migrate.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [migrate, '--apply', '--regenerate', '--descriptors', payloadPath],
    { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const args = parseArgs(process.argv.slice(2));
if (args.extract) await extract();
else if (args.sheet) sheet();
else if (args.ingest) await ingest();
else {
  console.log('usage: --extract | --sheet | --ingest');
  console.log('  --extract  pull every published story\'s full text into batches for reading');
  console.log('  --sheet    render covers-descriptors/REVIEW-SHEET.md from drafts.json');
  console.log('  --ingest   read the RATIFIED sheet back (refuses until RATIFIED.md exists)');
  console.log('             add --apply to action it: descriptors + regenerated covers');
}
