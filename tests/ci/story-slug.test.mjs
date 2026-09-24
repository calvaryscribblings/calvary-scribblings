// W1 / ADM-08 — a "New Story" whose slug already exists never overwrites.
//
//   node --test tests/ci/story-slug.test.mjs      (npm run test:ci)
//
// The decision is app/lib/storySlug.js (pure, loaded here); the wiring is asserted in the
// admin's source, because app/admin/page.js is a browser client that cannot run under node:
// the verdict must be asked of the LIVE node, before the write, for every new story, and the
// only site that creates a cms_stories record must be the one asking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { slugify, firstFreeSlug, newStorySlug, MAX_SUFFIX } from '../../app/lib/storySlug.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const takenBy = (...slugs) => { const set = new Set(slugs); return (s) => set.has(s); };

test('slugify is the CMS rule it replaced, so no live address moves', () => {
  assert.equal(slugify('Till Debt Do Us Part'), 'till-debt-do-us-part');
  assert.equal(slugify("Widow's Fire"), 'widow-s-fire');
  assert.equal(slugify('  —  '), '');
  assert.equal(slugify('Ọmọ'), 'm');
});

test('a free title keeps its natural address', async () => {
  assert.deepEqual(await newStorySlug({ title: 'Phantom', isTaken: takenBy('alive') }), { ok: true, slug: 'phantom' });
});

test('a taken title is refused, and the first free address is offered', async () => {
  const v = await newStorySlug({ title: 'Alive', isTaken: takenBy('alive', 'alive-2') });
  assert.deepEqual(v, { ok: false, reason: 'taken', slug: 'alive', offer: 'alive-3' });
});

test('an accepted offer is checked again, so one taken in the meantime is refused too', async () => {
  const v = await newStorySlug({ title: 'Alive', chosen: 'alive-3', isTaken: takenBy('alive', 'alive-2', 'alive-3') });
  assert.equal(v.ok, false);
  assert.equal(v.offer, 'alive-4');
  assert.deepEqual(await newStorySlug({ title: 'Alive', chosen: 'alive-3', isTaken: takenBy('alive') }), { ok: true, slug: 'alive-3' });
});

test('a title that makes no address is refused — it would write children of cms_stories itself', async () => {
  assert.deepEqual(await newStorySlug({ title: '!!!', isTaken: () => false }), { ok: false, reason: 'empty' });
});

test('async isTaken works, and the search gives up after MAX_SUFFIX', async () => {
  assert.equal(await firstFreeSlug('x', async (s) => s !== 'x-2'), 'x-2');
  assert.equal(await firstFreeSlug('x', () => true), null);
  assert.equal(MAX_SUFFIX, 50);
});

const ADMIN = readFileSync(join(ROOT, 'app/admin/page.js'), 'utf8');

test('saveStory asks the LIVE node for every new story, before the write, and refuses on a miss', () => {
  const save = ADMIN.slice(ADMIN.indexOf('const saveStory = async () => {'));
  const guard = save.indexOf('await newStorySlug({ title: form.title, chosen: form.slug, isTaken })');
  const write = save.indexOf('await update(ref(db), {');
  assert.ok(guard > -1, 'saveStory must ask newStorySlug');
  assert.ok(write > guard, 'the guard must run before the multi-path write');
  assert.match(save, /const isTaken = async \(candidate\) => \(await get\(ref\(db, `cms_stories\/\$\{candidate\}`\)\)\)\.exists\(\);/);
  assert.match(save, /if \(!verdict\.ok\) \{\s*setSaving\(false\);/);
  assert.match(save, /let slug = editingId;\s*if \(!editingId\) \{/, 'an edit keeps its own slug; only a new story is guarded');
  assert.doesNotMatch(ADMIN, /const slug = editingId \|\| slugify\(form\.title\);/, 'the unguarded derivation must be gone');
});

test('the offer is a button that sets the address, and editing the title withdraws it', () => {
  assert.match(ADMIN, /onClick=\{\(\) => setForm\(f => \(\{ \.\.\.f, slug: f\.slugOffer, slugOffer: null \}\)\)\}/);
  assert.match(ADMIN, /title: e\.target\.value, slug: '', slugOffer: null/);
});

test('a new story never cuts cover derivatives under an address it has not been granted', () => {
  assert.match(ADMIN, /const slug = editingId \|\| form\.slug \|\| `pending-\$\{Date\.now\(\)\}`;/);
});

test('app/admin/page.js is the only client that creates a cms_stories record', () => {
  // A record is CREATED by a write of the owned fields keyed on a computed slug. The other
  // cms_stories writers in app/ touch one field of a story that already exists (extract-text,
  // quizzes) or hide/unhide/delete one; a new creation site must come through the guard.
  const files = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f); else if (/\.(jsx?|mjs)$/.test(n)) files.push(f);
    }
  })(join(ROOT, 'app'));
  const creators = files.filter((f) => /ownedPaths\[`cms_stories\/\$\{slug\}\/\$\{k\}`\]/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(creators, ['app/admin/page.js']);
});
