// Strip the paragraphs that wrap a lone closing tag out of stored story content.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/strip-wrapped-closing-tags.mjs                    # plan only
//   node scripts/strip-wrapped-closing-tags.mjs --lists-only       # plan, lists only
//   node scripts/strip-wrapped-closing-tags.mjs --apply            # write
//
// ── The artefact ─────────────────────────────────────────────────────────────
// The composer's convertToHTML() matched OPENING block tags only, so a closing
// tag typed on its own line was not recognised as markup and got wrapped like
// prose:
//
//     <ul> <li>One</li> <p style="text-indent:1.5em; margin-bottom:0"></ul></p>
//
// A browser closes the paragraph at </ul> and discards the orphaned </p>, so what
// survives parsing is an EMPTY <p> inside the list — which the app's renderer drew
// as an extra bullet. Inside a <figure> the same shape leaves an empty paragraph
// under the image.
//
// R11.2 fixed the generator (blockTags now matches the closing form). This strips
// what the old generator already stored. Doing it the other way round — cleaning
// content while the source still emits it — just refills the bucket.
//
// ── What it does NOT touch ───────────────────────────────────────────────────
// The 1107 legitimate paragraphs that carry style="text-indent:1.5em;
// margin-bottom:0" are LEFT ALONE. They are redundant with proseCSS
// (`.prose:not(.is-verse) p + p`), but removing them is a rendering change, not a
// cleanup: the inline style indents every paragraph but the first, while `p + p`
// indents only paragraphs directly preceded by another paragraph — so a paragraph
// after an image or a heading would lose its indent. That is a typography
// decision, not an artefact, and it belongs to its own round.
//
// The transform is conservative: a paragraph is removed only when its ENTIRE
// content is a single closing tag, and the result is verified to preserve the
// story's text content byte-for-byte before anything is written.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');
const LISTS_ONLY = process.argv.includes('--lists-only');

// A <p> — with or without attributes — whose whole content is one closing tag.
const WRAPPED = (tags) => new RegExp(`<p(?:\\s+[^>]*)?>\\s*<\\/(${tags})>\\s*<\\/p>`, 'gi');
const TAGS = LISTS_ONLY ? 'ul|ol' : 'ul|ol|figure|div|blockquote|table';

// Text content with all markup removed, for the safety check. Entities are left
// as-is: the transform never touches them, so any difference is a real change.
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const countTag = (html, tag) => (html.match(new RegExp(`<\\/${tag}>`, 'gi')) || []).length;

async function main() {
  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) { console.error(`read failed: HTTP ${res.status}`); process.exit(1); }
  const stories = await res.json();

  const planned = [];
  const unsafe = [];

  for (const [slug, s] of Object.entries(stories || {})) {
    const before = s?.content;
    if (typeof before !== 'string' || !before) continue;
    const hits = before.match(WRAPPED(TAGS)) || [];
    if (!hits.length) continue;

    // The replacement keeps the closing tag and drops the paragraph around it.
    const after = before.replace(WRAPPED(TAGS), (_m, tag) => `</${tag}>`);

    // Three safety checks, all of which must hold before this story is written:
    //   1. the visible text is unchanged — nothing of the story itself moved
    //   2. every closing tag we touched is still present in the same number
    //   3. the <p> count fell by exactly the number of paragraphs removed
    const textSame = textOf(before) === textOf(after);
    const tagsSame = TAGS.split('|').every(t => countTag(before, t) === countTag(after, t));
    const pBefore = (before.match(/<p[\s>]/gi) || []).length;
    const pAfter = (after.match(/<p[\s>]/gi) || []).length;
    const pDropped = pBefore - pAfter === hits.length;

    const row = { slug, title: s.title || slug, hits: hits.length, before, after, textSame, tagsSame, pDropped,
      tags: hits.map(h => (h.match(/<\/([a-z][a-z0-9]*)>/i) || [])[1]).join(' ') };
    if (textSame && tagsSame && pDropped) planned.push(row); else unsafe.push(row);
  }

  console.log(`Wrapped-closing-tag strip — scope: ${LISTS_ONLY ? 'LISTS ONLY (ul, ol)' : 'ALL block tags (ul, ol, figure, div, blockquote, table)'}\n`);
  console.log(`  stories to change : ${planned.length}`);
  console.log(`  paragraphs removed: ${planned.reduce((n, r) => n + r.hits, 0)}`);
  console.log(`  REJECTED as unsafe: ${unsafe.length}`);
  for (const u of unsafe) {
    console.log(`   ✗ ${u.slug} — text ${u.textSame ? 'ok' : 'CHANGED'}, tags ${u.tagsSame ? 'ok' : 'CHANGED'}, <p> delta ${u.pDropped ? 'ok' : 'WRONG'}`);
  }
  if (!planned.length) { console.log('\nNothing to do.'); return; }

  console.log('\n  story                                                    removed  tags');
  for (const r of planned.sort((a, b) => b.hits - a.hits)) {
    console.log(`   ${r.slug.padEnd(56)} ${String(r.hits).padStart(4)}   ${r.tags}`);
  }

  // Show one before/after so the edit is eyeballable rather than trusted.
  const sample = planned[0];
  const at = sample.before.search(WRAPPED(TAGS));
  console.log(`\n  sample — ${sample.slug}`);
  console.log(`    before: …${sample.before.slice(Math.max(0, at - 60), at + 90)}…`);
  const at2 = Math.max(0, at - 60);
  console.log(`    after : …${sample.after.slice(at2, at2 + 150)}…`);

  if (!APPLY) {
    console.log(`\nDRY RUN — no writes. Re-run with --apply${LISTS_ONLY ? ' --lists-only' : ''}.`);
    return;
  }
  if (unsafe.length) {
    console.error('\nREFUSING TO WRITE — at least one story failed a safety check. Fix or exclude it first.');
    process.exit(1);
  }

  // One atomic multi-path PATCH, one path per story's content field. Nothing else
  // on the record is touched, so this cannot disturb quizMeta or any other sibling.
  const updates = {};
  for (const r of planned) updates[`cms_stories/${r.slug}/content`] = r.after;

  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const token = (await cert(svc).getAccessToken()).access_token;
  console.log(`\nWriting ${Object.keys(updates).length} story content field(s) …`);
  const w = await fetch(`${DB_URL}/.json?access_token=${token}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
  });
  if (!w.ok) { console.error(`WRITE FAILED: HTTP ${w.status} — ${await w.text()}`); process.exit(1); }

  // Read back and prove the artefact is gone and the prose survived.
  console.log('\nVerifying against a fresh read …\n');
  const after = await (await fetch(`${DB_URL}/cms_stories.json`)).json();
  let bad = 0;
  const ok = (c, l) => { if (!c) bad++; console.log(`   ${c ? '✓' : '✗'} ${l}`); };
  const remaining = Object.entries(after || {})
    .filter(([, s]) => typeof s?.content === 'string' && WRAPPED(TAGS).test(s.content))
    .map(([slug]) => slug);
  ok(remaining.length === 0, `no wrapped closing tag remains in scope${remaining.length ? ` — ${remaining.join(', ')}` : ''}`);
  const textIntact = planned.every(r => textOf(after?.[r.slug]?.content || '') === textOf(r.before));
  ok(textIntact, `every changed story's visible text is byte-identical to before`);
  const stored = planned.every(r => after?.[r.slug]?.content === r.after);
  ok(stored, `every write landed exactly as planned`);
  console.log(bad === 0 ? '\n✓ migration verified' : `\n✗ ${bad} check(s) failed`);
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
