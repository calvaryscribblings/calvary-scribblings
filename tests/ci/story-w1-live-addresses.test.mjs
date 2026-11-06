// STORY-W1 (ruling 304) — NEW story addresses drop apostrophes; NO LIVE ADDRESS CHANGES.
//
//   node --test tests/ci/story-w1-live-addresses.test.mjs      (npm run test:ci)
//
// WHAT THIS PROVES, AND WHY IT IS NOT A TAUTOLOGY
//
// tests/fixtures/live-story-addresses.json is every live story address, read once (6 Nov 2026,
// read-only) from the keys of cms_stories_index, with each record's title. Every index record's
// url field was /stories/<key> at the time of the read.
//
// "The fixture slug equals the fixture slug" proves nothing. What can move a live address under
// ruling 304 is code that RECOMPUTES it from the title, because the title now slugs differently.
// So the proof is built on the stories where the two disagree:
//
//   1. THE WITNESSES. For 25 of the live addresses, slugify(title) today is NOT the address. 19 of
//      them are exactly ruling 304's case: written by the old rule, with an apostrophe's hyphen
//      ("widow-s-fire"), which the new rule writes differently ("widows-fire"). The others were
//      typed by hand or kept after a title edit. The test computes that set and pins it, so the
//      count is measured, not asserted into being. Any code path that derived an address from a
//      title would give a wrong answer for each of them.
//   2. THE REAL CODE PATHS, RUN on every live record (title included): the index projection
//      (buildIndexRecord — the admin dual-write, the reconciler, the covers writers, and the
//      /api/story-index/build endpoint the scheduled-publish Worker calls), the index update
//      fragment (indexUpdatePaths), and the CMS's Unhide write (unhideUpdate). Each must return
//      the stored KEY for every witness. If one of them reached for the title, the witnesses fail.
//   3. THE PATHS THAT CANNOT RUN UNDER NODE (they read Firebase at build time: the static pages'
//      generateStaticParams, the sitemap, public/_redirects; and the Worker's own mirror) are
//      pinned in source to map the record's KEY, and the whole repo is scanned: the story slugify
//      is imported only by the CMS, and no other file carries a copy of the rule. A new copy
//      fails here and has to be looked at.
//   4. THE EDIT PATH. In app/admin/page.js every call of slugify / newStorySlug sits behind
//      `!editingId`. An edit writes to editingId, the key it opened, and never asks for a slug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { slugify } from '../../app/lib/storySlug.js';
import { buildIndexRecord, indexUpdatePaths, INDEX_PATH } from '../../app/lib/storyIndex.js';
import { unhideUpdate } from '../../app/lib/storyState.js';
import { onRequestPost as buildIndexEndpoint } from '../../functions/api/story-index/build.js';
import { isId } from '../../app/lib/ids.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const FIXTURE = JSON.parse(read('tests/fixtures/live-story-addresses.json'));
const LIVE = FIXTURE.addresses;

// The rule as it was before ruling 304, frozen here ONLY to show which addresses it wrote.
const legacySlugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Every live address the new rule would have written differently. Pinned by hand from the
// measurement; the test recomputes it and must agree.
const APOSTROPHE_ADDRESSES = [
  'apple-s-foldable-arrives-the-iphone-18-doesn-t',
  'apple-s-quiet-health-overhaul',
  'blaqbonez-s-nomadinho-4th-prime',
  'can-marvel-s-new-x-men-escape-the-shadow-of-hugh-jackman-and-the-original-cast',
  'can-t-challa-s-son-carry-wakanda',
  'clarity-of-mind-omah-lay-s-introspective-return-album-review',
  'in-your-20-s',
  'murdoch-s-torment',
  'new-alliances-and-old-tactics-inside-nigeria-s-shifting-political-landscape',
  'records-fell-at-the-emmys-one-didn-t',
  'the-bots-are-reading-your-cv-before-any-human-does-here-s-how-to-beat-them',
  'the-copyright-war-nobody-s-winning-who-owns-what-ai-creates',
  'the-songbird-s-birdsong',
  'therapist-s-note-on-love',
  'there-s-always-light',
  'things-i-m-owed',
  'why-ai-will-take-your-job-and-here-s-what-you-can-do-about-it',
  'widow-s-fire',
  'you-ve-been-using-ai-wrong',
];

const witnesses = LIVE.filter((r) => slugify(r.title) !== r.slug);

test('the fixture is every live address, each one a valid key, once', () => {
  assert.equal(LIVE.length, 218);
  const slugs = LIVE.map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'no address twice');
  assert.deepEqual(slugs, [...slugs].sort(), 'sorted, so a diff of a refresh reads cleanly');
  for (const r of LIVE) {
    assert.ok(isId('slug', r.slug), `${r.slug} is a valid story key`);
    assert.equal(typeof r.title, 'string');
  }
});

test('ruling 304: a new address drops straight, curly and modifier-letter apostrophes', () => {
  assert.equal(slugify('Nobody’s Winning'), 'nobodys-winning');
  assert.equal(slugify("Nobody's Winning"), 'nobodys-winning');
  assert.equal(slugify('Nobodyʼs Winning'), 'nobodys-winning');
  assert.equal(slugify('‘Quoted’ Words'), 'quoted-words');
  assert.equal(slugify("In Your 20's"), 'in-your-20s');
  assert.equal(slugify('Rock ‘n’ Roll'), 'rock-n-roll');
});

test('19 live addresses carry an apostrophe hyphen that the new rule would write differently', () => {
  const moved = LIVE
    .filter((r) => legacySlugify(r.title) === r.slug && slugify(r.title) !== r.slug)
    .map((r) => r.slug);
  assert.deepEqual(moved, APOSTROPHE_ADDRESSES);
  assert.equal(moved.length, 19);
  // Every one of them is a witness, and the witnesses are where a recomputation would show.
  for (const s of APOSTROPHE_ADDRESSES) assert.ok(witnesses.some((w) => w.slug === s));
  assert.equal(witnesses.length, 25, 'live addresses that slugify(title) does not reproduce today');
});

// A record shaped as the CMS stores a live story: its title (the thing a recomputation would
// read), published, with a generated cover so the Unhide write treats it as live.
const recordFor = (r) => ({
  title: r.title, author: 'A', category: 'fiction', categoryName: 'Fiction', date: '2026-01-01',
  published: true, cover: 'https://example.invalid/covers-typographic/x.webp', content: '<p>Text.</p>',
});

test('the index projection keeps the stored key for every live address', () => {
  for (const r of LIVE) {
    const rec = buildIndexRecord(r.slug, recordFor(r));
    assert.equal(rec.url, `/stories/${r.slug}`, r.slug);
    const paths = indexUpdatePaths(r.slug, recordFor(r));
    assert.deepEqual(Object.keys(paths), [`${INDEX_PATH}/${r.slug}`], r.slug);
    assert.equal(paths[`${INDEX_PATH}/${r.slug}`].url, `/stories/${r.slug}`, r.slug);
  }
});

test('the Worker\'s index endpoint keeps the stored key for every witness', async () => {
  for (const r of witnesses) {
    const req = new Request('https://x.invalid/api/story-index/build', {
      method: 'POST', body: JSON.stringify({ slug: r.slug, story: recordFor(r) }),
    });
    const res = await buildIndexEndpoint({ request: req });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).record.url, `/stories/${r.slug}`, r.slug);
  }
});

test('the CMS Unhide write lands every path under the stored key, never a recomputed one', () => {
  for (const r of witnesses) {
    const { paths } = unhideUpdate(r.slug, recordFor(r), { content: '<p>Text.</p>' });
    const keys = Object.keys(paths);
    assert.ok(keys.length > 0);
    for (const k of keys) assert.equal(k.split('/')[1], r.slug, `${k} for ${r.slug}`);
    assert.ok(!keys.some((k) => k.includes(`/${slugify(r.title)}/`) || k.endsWith(`/${slugify(r.title)}`)), r.slug);
  }
});

test('the build-time address paths map the record KEY, never a title', () => {
  const page = read('app/stories/[slug]/page.js');
  assert.match(page, /\.filter\(\(\[, story\]\) => hasStaticPage\(story\)\)\s*\.map\(\(\[slug\]\) => \(\{ slug \}\)\)/,
    'generateStaticParams: one page per cms_stories key');
  const sitemap = read('app/sitemap.js');
  assert.match(sitemap, /\.map\(\(\[slug\]\) => \(\{\s*url: `\$\{BASE_URL\}\/stories\/\$\{slug\}`/, 'sitemap: the key');
  const redirects = read('scripts/generate-redirects.mjs');
  assert.match(redirects, /\.map\(\(\[slug\]\) => slug\);/, 'redirects: the key');
  assert.match(redirects, /\[`\/\$\{slug\}`, `\/stories\/\$\{slug\}`\]/);
  // The scheduled-publish Worker (workers-external, not edited here) publishes by the key it
  // enumerates and projects the index's url from that key.
  const worker = read('workers-external/calvary-newsletter.worker.js');
  assert.match(worker, /for \(const \[slug, story\] of Object\.entries\(stories\)\)/);
  assert.match(worker, /url: s\.url \|\| `\/stories\/\$\{slug\}`,/);
  for (const src of [page, sitemap, redirects, worker]) assert.doesNotMatch(src, /lib\/storySlug|\bslugify\(/);
});

// Every source file outside node_modules, build output, vestigial checkouts and tests.
function sourceFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.next', 'out', 'calvary-scribblings-next', 'calvary-app', 'tests', 'public'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) sourceFiles(p, out);
    else if (/\.(m?js|jsx|cjs|ts|tsx)$/.test(name)) out.push(relative(ROOT, p));
  }
  return out;
}

test('only the CMS imports the story slugify, and no file carries another copy of the rule', () => {
  const files = sourceFiles();
  const importers = files.filter((f) => /from ['"][./]*(?:\.\.\/)*(?:app\/)?lib\/storySlug(?:\.js)?['"]/.test(read(f)));
  assert.deepEqual(importers, ['app/admin/page.js']);
  // The collapse `[^a-z0-9]+ → -` is the slug rule. Each copy below makes a different kind of
  // address (voices, series, bookstore, publishers, newsletter image names) or, for the cover
  // generator's CLI, a local file name when run by hand with --title. None makes a story address.
  const copies = files.filter((f) => /replace\(\/\[\^a-z0-9\]\+\/g, '-'\)/.test(read(f))).sort();
  assert.deepEqual(copies, [
    'app/admin/bookstore/page.js',
    'app/admin/publishers/page.js',
    'app/admin/voices/page.js',
    'app/lib/bookstore/admin-writes.js',
    'app/lib/newsletterImages.js',
    'app/lib/series/admin-writes.js',
    'app/lib/storySlug.js',
    'scripts/covers/generate.mjs',
  ]);
});

test('an edit never asks for a slug: every slugify / newStorySlug call in the CMS is behind !editingId', () => {
  const admin = read('app/admin/page.js');
  // Code only: a `// … slugify(title)` remark in a comment is not a call.
  const calls = (re) => [...admin.matchAll(re)]
    .filter((m) => !admin.slice(admin.lastIndexOf('\n', m.index) + 1, m.index).includes('//'))
    .map((m) => m.index);
  const slugifyCalls = calls(/\bslugify\(/g);
  const newCalls = calls(/\bnewStorySlug\(/g);
  assert.equal(slugifyCalls.length, 1, 'one slugify call: the New Story heading preview');
  assert.equal(newCalls.length, 1, 'one newStorySlug call: the new-story guard in saveStory');
  // The preview: rendered only when there is no editingId.
  assert.match(admin, /\{!editingId && form\.title && <div style=\{s\.h2sub\}>Slug: \/stories\/\{form\.slug \|\| slugify\(form\.title\)\}<\/div>\}/);
  // The save: the slug IS editingId unless this is a new story.
  const save = admin.slice(admin.indexOf('const saveStory = async () => {'));
  assert.match(save, /let slug = editingId;\s*if \(!editingId\) \{[\s\S]*?await newStorySlug\(\{ title: form\.title, chosen: form\.slug, isTaken \}\);[\s\S]*?slug = verdict\.slug;\s*\}/);
  const guardOpen = admin.indexOf('if (!editingId) {', admin.indexOf('let slug = editingId;'));
  assert.ok(guardOpen > -1 && guardOpen < newCalls[0], 'newStorySlug is inside the new-story branch');
  assert.doesNotMatch(admin, /firstFreeSlug/, 'the numbered-address search is reached only through newStorySlug');
});
