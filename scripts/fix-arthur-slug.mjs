// R46.2 — arthor-eze → arthur-eze. This is NOT a rename.
//
//   node scripts/fix-arthur-slug.mjs                 # plan
//   node scripts/fix-arthur-slug.mjs --stage         # step 1: create the new record as a DRAFT
//   node scripts/fix-arthur-slug.mjs --cutover       # step 3: publish new + delete old, ATOMICALLY
//
// ── THE SLUG IS THE KEY ──────────────────────────────────────────────────────────────────
// There is no rename operation. `arthor-eze` → `arthur-eze` is a NEW RECORD plus a REDIRECT,
// and the redirect is the real work: /voices/arthor-eze may be in a bookmark, a social post
// or a search index, and it must not 404.
//
// ── WHAT ACTUALLY POINTS AT THE OLD SLUG (swept 9 Sep 2026, admin read) ─────────────────
// All 81 top-level RTDB nodes: `arthor-eze` appears in cms_voices AND NOWHERE ELSE.
//   · cms_stories / cms_stories_index : 0. Stories link a voice by authorUid ↔ matchUid, never
//     by slug, so NOTHING carries it as a foreign key and the rename breaks no link.
//   · newsletter_sends (9 issues)     : 0. One issue's subject contains the word "voices";
//     no issue links a voice page at all.
//   · sitemap                         : lists /voices, not individual slugs. Nothing to update.
//   · public/_redirects               : no rule either way (yet).
// The only other occurrences are 10 files in out/, regenerated every build.
//
// So the exposure is entirely EXTERNAL — bookmarks, shares, search results — which is exactly
// why the 301 is required and why no amount of grepping this repo can enumerate it.
//
// ── THE STORAGE PATH KEEPS THE OLD SPELLING, ON PURPOSE ──────────────────────────────────
// cardImage/cardSizes point at voices/arthor-eze/card.png. Those are absolute URLs with
// download tokens: the path is a file location, not a key, and nothing derives it from the
// slug at read time. Copying them verbatim is correct. ⚠ Do NOT "tidy" the bucket to match —
// moving the objects invalidates the tokens and blanks the card.
//
// ── THE ORDER OF OPERATIONS, AND WHY THIS SHAPE ─────────────────────────────────────────
//   1. --stage    create arthur-eze, byte-identical but for `slug`, PUBLISHED:FALSE.
//                 generateStaticParams enumerates every slug including drafts, so the page
//                 FILE gets built; the client gates on published, so it resolves to not-found
//                 and no second Arthur appears on the grid.
//   2. build      verify out/voices/arthur-eze.html exists.
//   3. redirect   add the rule to scripts/generate-redirects.mjs (public/_redirects is
//                 generated — "do not edit by hand"), rebuild, verify it is in the output.
//   4. --cutover  ONE multi-path PATCH: publish the new record and delete the old in the same
//                 write. ⚠ Not two calls. Publishing first shows two Arthur cards on a live
//                 grid; deleting first leaves a window where NEITHER resolves, and a window
//                 where neither resolves is worse than the typo.
//   5. build      redeploy so the old page stops generating and the redirect ships.
import { readFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const OLD = 'arthor-eze';
const NEW = 'arthur-eze';
const STAGE = process.argv.includes('--stage');
const CUTOVER = process.argv.includes('--cutover');

const token = async () => {
  const svc = JSON.parse(await readFile(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
  return (await cert(svc).getAccessToken()).access_token;
};
const readAll = async () => (await (await fetch(`${DB}/cms_voices.json`)).json()) || {};

const before = await readAll();
const old = before[OLD];

if (STAGE) {
  if (!old) { console.error(`${OLD} is gone — nothing to copy from`); process.exit(1); }
  if (before[NEW]) { console.error(`${NEW} already exists — refusing to overwrite`); process.exit(1); }
  // Byte-identical but for `slug`, and held as a draft.
  const record = { ...old, slug: NEW, published: false };
  console.log(`staging ${NEW} from ${OLD} — ${Object.keys(record).length} fields`);
  for (const f of Object.keys(record).sort()) {
    const same = JSON.stringify(record[f]) === JSON.stringify(old[f]);
    console.log(`  ${f.padEnd(13)} ${same ? 'copied verbatim' : 'CHANGED -> ' + JSON.stringify(record[f])}`);
  }
  const t = await token();
  const res = await fetch(`${DB}/cms_voices/${NEW}.json?access_token=${t}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
  });
  if (!res.ok) { console.error('WRITE FAILED', res.status, await res.text()); process.exit(1); }

  const after = await readAll();
  const n = after[NEW];
  let diff = 0;
  for (const f of Object.keys(old)) {
    if (f === 'slug' || f === 'published') continue;
    if (JSON.stringify(old[f]) !== JSON.stringify(n[f])) { diff += 1; console.error(`  ✗ ${f} did not copy`); }
  }
  let moved = 0;
  for (const s of Object.keys(before)) for (const f of Object.keys(before[s])) {
    if (JSON.stringify(before[s][f]) !== JSON.stringify(after[s]?.[f])) { moved += 1; console.error(`  ✗ ${s}.${f} moved`); }
  }
  console.log(`\nrecords         : ${Object.keys(before).length} -> ${Object.keys(after).length}`);
  console.log(`copied verbatim : ${Object.keys(old).length - 2 - diff}/${Object.keys(old).length - 2} non-slug, non-published fields`);
  console.log(`${OLD} still live: ${after[OLD] ? 'yes ✓ (nothing 404s yet)' : 'NO ✗'}`);
  console.log(`${NEW} published : ${n.published} (draft — page builds, grid ignores it)`);
  console.log(`other records   : ${moved} moved ${moved === 0 ? '✓' : '✗'}`);
  process.exit(diff || moved ? 1 : 0);
}

if (CUTOVER) {
  const n = before[NEW];
  if (!n) { console.error(`${NEW} not staged — run --stage first`); process.exit(1); }
  if (!old) { console.log(`${OLD} already gone; nothing to cut over`); process.exit(0); }
  // ⚠ ONE WRITE. A multi-path PATCH on the PARENT applies both changes atomically: there is
  // never a moment with two Arthur cards, and never one with none.
  const t = await token();
  const res = await fetch(`${DB}/cms_voices.json?access_token=${t}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [`${NEW}/published`]: true, [OLD]: null }),
  });
  if (!res.ok) { console.error('CUTOVER FAILED', res.status, await res.text()); process.exit(1); }

  const after = await readAll();
  let moved = 0;
  for (const s of Object.keys(before)) {
    if (s === OLD || s === NEW) continue;
    for (const f of Object.keys(before[s])) {
      if (JSON.stringify(before[s][f]) !== JSON.stringify(after[s]?.[f])) { moved += 1; console.error(`  ✗ ${s}.${f} moved`); }
    }
  }
  console.log(`${OLD} removed        : ${after[OLD] ? 'NO ✗' : 'yes ✓'}`);
  console.log(`${NEW} published      : ${after[NEW]?.published === true ? 'yes ✓' : 'NO ✗'}`);
  console.log(`${NEW} fields intact  : ${Object.keys(after[NEW] || {}).length} (was ${Object.keys(n).length})`);
  console.log(`records            : ${Object.keys(before).length} -> ${Object.keys(after).length}`);
  console.log(`untouched records  : ${moved} moved ${moved === 0 ? '✓ every one byte-identical' : '✗'}`);
  process.exit(moved ? 1 : 0);
}

console.log(`plan for ${OLD} -> ${NEW}\n`);
console.log(`  ${OLD} present : ${old ? 'yes (order ' + old.order + ', published ' + old.published + ')' : 'no'}`);
console.log(`  ${NEW} present : ${before[NEW] ? 'yes' : 'no'}`);
console.log(`\n  --stage    create ${NEW} as a draft, verify the copy`);
console.log(`  --cutover  publish ${NEW} and delete ${OLD} in ONE atomic write`);
