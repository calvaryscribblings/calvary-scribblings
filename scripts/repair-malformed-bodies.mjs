// Repair the story bodies that fail the preview validation gate.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/repair-malformed-bodies.mjs           # plan only, no writes
//   node scripts/repair-malformed-bodies.mjs --apply   # write
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The preview cutter refuses to cut a body it cannot prove well-formed
// (app/lib/htmlBlocks.js; STORY-SERVING-CONTRACT.md §4.2 rule 4 and §5.5). Run
// over the live corpus on 2026-08-08 the gate rejected SIX bodies, FOUR of them
// gateable — so four stories would answer `500 preview_failed` to every free
// reader the day the gate ships. The gate is right and the bodies are wrong;
// this fixes the bodies.
//
// This is the SAME shape of job as scripts/strip-wrapped-closing-tags.mjs, and
// deliberately follows its discipline: fix the generator first, then strip what
// the old generator stored. Doing it the other way round just refills the bucket.
//
// ── Is the source already closed? YES, and it was checked ────────────────────
// Defect A below carries `style="text-indent:1.5em; margin-bottom:0"`. The
// composer's convertToHTML() emits a BARE `<p>` and has done since R11.2 removed
// the inline style (see the note above that function in app/admin/page.js). It
// cannot produce a styled paragraph today by any path. So this is residue from
// the old generator, exactly like the wrapped closing tags were, and there is no
// source-side fix left to make first.
//
// ── Defect A — a phantom OUTER figure (5 stories, 21 occurrences) ────────────
//
// The first read of this was wrong and the safety checks below caught it, which is
// the only reason this comment is right. It looked like a stray duplicate:
//
//     <p style="text-indent:1.5em; margin-bottom:0"><figure style="margin:1.5em 0;"></p>
//
// Byte-identical every time, containing nothing but an opening `<figure>`, and
// followed immediately by the real figure block. Deleting it seemed obvious. It is
// not — figure opens and closes BALANCE on every affected story (odeluwa 6/6,
// clarity-of-mind 4/4, what-are-cookies 2/2). That paragraph is not a duplicate,
// it is the OPENING HALF of a phantom outer figure that wraps the real one:
//
//     <p …><figure …></p>                     ← opens the phantom
//     <p …> <figure …> <img/> <figcaption>…</figcaption> </figure> </p>
//     <p …><figcaption …></figcaption></p>    ← empty, renders nothing
//     </figure>                                ← closes the phantom
//
// Delete only the opener and the orphaned `</figure>` further down is left with
// nothing to close. So BOTH halves go, and the second half cannot be found by a
// regex — it is whichever `</figure>` no longer has a matching opener, which is a
// question about balance, not about text. Hence dropUnmatchedClosers() below.
//
// A browser repairs all of this silently (`<figure>` implies `</p>`, and orphan
// closers are dropped), which is exactly why it has gone unnoticed for so long: it
// renders as nothing at all. Nothing here carries text, so nothing is rewritten.
//
// The empty `<p><figcaption></figcaption></p>` is LEFT ALONE. It is balanced, it is
// invisible, and it does not fail the gate. This script's job is to make bodies
// parseable, not tidy.
//
// ── Defect B — the unterminated closing tag (1 story, 2 occurrences) ─────────
//
//     …</h3 <p style="…">His statement continued…
//              ↑ no '>'
//
// `</h3` runs into whatever follows it, so the parser consumes the next tag as
// part of the closing tag's attributes and the document loses a level. Repaired by
// closing the tag: `</h3` → `</h3>`.
//
// ── The safety property ──────────────────────────────────────────────────────
// Every repair is verified before anything is written:
//   1. the body's TEXT CONTENT is unchanged, byte for byte
//   2. the repaired body PASSES the validation gate
//   3. the repaired body still CUTS to a preview
// A story failing any of the three is reported and skipped, never written. The
// point is to make bodies parseable, not to edit anybody's prose.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { validateBody } from '../app/lib/htmlBlocks.js';
import { cutPreview } from '../app/lib/previewCut.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');

// A <p> whose entire content is one opening <figure> tag. Anchored on both ends so
// a paragraph that actually contains a figure WITH CONTENT can never match.
const STRAY_FIGURE_P = /<p[^>]*>\s*<figure[^>]*>\s*<\/p>\s*/gi;

// A closing tag missing its '>', recognised only when the next thing is another
// tag — `</h3 <p …>`. Requiring the following '<' is what keeps this off prose that
// happens to contain a stray '</'.
const UNCLOSED_CLOSER = /<\/([a-zA-Z][a-zA-Z0-9-]*)\s+(?=<)/g;

/** Text with all markup removed — the invariant every repair must preserve. */
const textOf = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/**
 * Delete closing tags that have nothing to close — the other half of defect A.
 *
 * A balance walk, not a regex, because "which `</figure>` is the orphan" is a
 * question about the tags around it. Deleting an unmatched closer is precisely what
 * a browser's parser does with one, so this changes no rendering; it only makes the
 * source say what the browser was already reading.
 *
 * ONLY unmatched closers are removed. A closer that matches something other than the
 * innermost open element (genuinely crossed nesting) is LEFT IN PLACE so the body
 * still fails the gate and gets reported rather than silently mangled.
 */
function dropUnmatchedClosers(html) {
  const src = String(html || '');
  const stack = [];
  const cuts = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src)) !== null) {
    const tag = m[1].toLowerCase();
    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(m[0])) continue;
    if (m[0][1] !== '/') { stack.push(tag); continue; }
    const at = stack.lastIndexOf(tag);
    if (at === -1) { cuts.push([m.index, TAG_RE.lastIndex]); continue; }  // orphan
    stack.length = at;                                                    // matched
  }
  let out = src;
  for (let i = cuts.length - 1; i >= 0; i--) out = out.slice(0, cuts[i][0]) + out.slice(cuts[i][1]);
  return { out, dropped: cuts.length };
}

/**
 * Insert the closing tags the author left out — defects C and D.
 *
 * Two shapes, both of which a browser's parser already repairs the same way, so
 * neither changes what any reader has ever seen:
 *
 *   C. IMPLIED END TAG. `<figcaption>` left open, then `</figure>`. The closer
 *      matches something DEEPER in the stack than the innermost open element, so
 *      everything above it is closed first — `</figcaption></figure>`. This is
 *      exactly HTML5's implied-end-tag behaviour. (odeluwa, 2026-08-08)
 *
 *   D. NEVER CLOSED. An element still open when the body ends. Its closer is
 *      appended, innermost first. (clarity-of-mind-…, 2026-08-08)
 *
 * ADDS TAGS ONLY — it never deletes and never moves text, so the text-content
 * invariant is preserved by construction rather than by luck. The invariant is
 * still asserted before any write, because "by construction" is a claim and the
 * check is a fact.
 */
function closeImpliedTags(html) {
  const src = String(html || '');
  const stack = [];
  const inserts = [];   // [offset, text]
  let implied = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src)) !== null) {
    const tag = m[1].toLowerCase();
    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(m[0])) continue;
    if (m[0][1] !== '/') { stack.push(tag); continue; }
    const at = stack.lastIndexOf(tag);
    if (at === -1) continue;                       // orphan — dropUnmatchedClosers' job
    if (at !== stack.length - 1) {
      // Close everything opened inside it, innermost first, right before this tag.
      const missing = stack.slice(at + 1).reverse().map((t) => `</${t}>`).join('');
      inserts.push([m.index, missing]);
      implied += stack.length - 1 - at;
    }
    stack.length = at;
  }

  let out = src;
  for (let i = inserts.length - 1; i >= 0; i--) {
    out = out.slice(0, inserts[i][0]) + inserts[i][1] + out.slice(inserts[i][0]);
  }
  // Anything still open at the end of the body.
  const unterminated = stack.length;
  if (unterminated) out += stack.reverse().map((t) => `</${t}>`).join('');

  return { out, implied, unterminated };
}

function repair(html) {
  let out = String(html || '');

  const strayCount = (out.match(STRAY_FIGURE_P) || []).length;
  out = out.replace(STRAY_FIGURE_P, '');

  const unclosedCount = (out.match(UNCLOSED_CLOSER) || []).length;
  out = out.replace(UNCLOSED_CLOSER, '</$1>');

  const { out: dropped_, dropped } = dropUnmatchedClosers(out);
  const { out: closed, implied, unterminated } = closeImpliedTags(dropped_);

  return { out: closed, strayCount, unclosedCount, dropped, implied, unterminated };
}

async function main() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));

  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) { console.error(`cms_stories read failed: HTTP ${res.status}`); process.exit(1); }
  const all = await res.json();

  const broken = [];
  for (const [slug, story] of Object.entries(all)) {
    if (!story || typeof story.content !== 'string' || !story.content) continue;
    if (validateBody(story.content).ok) continue;
    broken.push([slug, story]);
  }

  console.log(`cms_stories: ${Object.keys(all).length} records, ${broken.length} failing the gate\n`);
  if (!broken.length) { console.log('Nothing to repair.'); return; }

  const patch = {};
  const backup = {};
  const skipped = [];

  for (const [slug, story] of broken) {
    const before = story.content;
    const { out, strayCount, unclosedCount, dropped, implied, unterminated } = repair(before);

    const reasons = [];
    if (textOf(out) !== textOf(before)) reasons.push('TEXT CHANGED');
    const check = validateBody(out);
    if (!check.ok) reasons.push(`still malformed: ${check.error}`);
    if (check.ok) {
      try { cutPreview(out); } catch (e) { reasons.push(`cut failed: ${e.message}`); }
    }

    const fixes = `${strayCount} phantom-opener, ${unclosedCount} unterminated-closer, ${dropped} orphan-closer, ${implied} implied-close, ${unterminated} never-closed`;
    if (reasons.length) {
      skipped.push({ slug, reasons, fixes });
      console.log(`  ✗ ${slug}\n      ${fixes}\n      SKIPPED — ${reasons.join('; ')}`);
      continue;
    }

    backup[slug] = before;
    patch[`${slug}/content`] = out;
    console.log(`  ✓ ${slug}\n      ${fixes}   ${before.length} → ${out.length} bytes, text identical`);
  }

  console.log(`\nrepairable ${Object.keys(patch).length}   skipped ${skipped.length}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    return;
  }
  if (!Object.keys(patch).length) { console.log('\nNothing to write.'); return; }

  // The originals go to disk BEFORE the write. These are people's stories; a
  // mechanical transform that turns out to be wrong must be reversible without a
  // database export.
  const backupPath = resolve(ROOT, 'scripts', 'malformed-bodies-backup.json');
  await writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\noriginals saved to ${backupPath}`);

  const token = (await cert(svc).getAccessToken()).access_token;
  const writeRes = await fetch(`${DB_URL}/cms_stories.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!writeRes.ok) {
    console.error(`PATCH failed: HTTP ${writeRes.status} ${(await writeRes.text()).slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`✓ repaired ${Object.keys(patch).length} body/bodies.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
