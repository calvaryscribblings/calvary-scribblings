// W1 / ADM-01 — the titles table's Publish is refused while the title has no EPUB.
//
//   node --test tests/bookstore/publish-readiness.test.mjs      (npm run test:purchases)
//
// admin-writes.js imports the Firebase client and cannot load under node, so the decision
// lives in publishReadiness.js (pure) and the wiring is asserted in the source: the refusal
// must be computed from the STORED record and returned BEFORE the status write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { missingForPublish, publishRefusal } from '../../app/lib/bookstore/publishReadiness.js';

const COVER = 'https://firebasestorage.googleapis.com/v0/b/x/o/bookstore_covers%2Fthe-rescue.jpg';
const EPUB = 'bookstore_epubs/the-rescue/master.epub';

test('a draft with no EPUB is refused, and the message says what is missing and what to do', () => {
  assert.deepEqual(missingForPublish({ title: 'The Rescue', coverUrl: COVER, epubPath: null }), ['EPUB']);
  assert.equal(
    publishRefusal({ title: 'The Rescue', coverUrl: COVER, epubPath: null }),
    "“The Rescue” can't be published yet: it has no EPUB. Open Edit, add the EPUB, then publish.",
  );
});

test('no cover, or neither, is refused by name', () => {
  assert.match(publishRefusal({ title: 'T', epubPath: EPUB }), /has no cover image\. Open Edit, add the cover image,/);
  assert.match(publishRefusal({ title: 'T' }), /has no cover image or EPUB\. Open Edit, add the cover image and the EPUB,/);
  assert.match(publishRefusal({ title: 'T', coverUrl: '  ', epubPath: '' }), /no cover image or EPUB/, 'blank strings are not assets');
});

test('a title with both is ready — the sample is optional and not asked for', () => {
  assert.equal(publishRefusal({ title: 'T', coverUrl: COVER, epubPath: EPUB, samplePath: null }), null);
});

test('setTitleStatus refuses a not-ready publish from the stored record, before it writes', () => {
  const src = readFileSync(fileURLToPath(new URL('../../app/lib/bookstore/admin-writes.js', import.meta.url)), 'utf8');
  const fn = src.slice(src.indexOf('export async function setTitleStatus('), src.indexOf('\n// R21 — WITHDRAWAL AND DELETION\n'));
  assert.ok(fn.length > 100, 'setTitleStatus not found');
  const refuse = fn.indexOf('publishRefusal(snap.val())');
  const write = fn.indexOf('await update(');
  assert.ok(refuse > -1, 'setTitleStatus must ask publishRefusal about the stored record');
  assert.ok(refuse < write, 'the refusal must come before the status write');
  assert.match(fn, /if \(status === 'published'\) \{\s*const refusal = publishRefusal\(snap\.val\(\)\);\s*if \(refusal\) return \{ ok: false, errors: \[refusal\] \};/);
});
