// SHOP-2 §4 — EVERY BOOK PAGE IS ITS OWN CANONICAL.
//
//   npx next build && node --test tests/build/bookstore-canonical.test.mjs
//
// app/bookstore/layout.js set canonical=/bookstore for the whole segment, and the title pages
// inherited it, telling search engines that each book was a duplicate of the shop's front page.
// Over a BUILT out/ (a step after the build in reader-tests.yml): the front page's canonical is
// /bookstore, and every title page's is its own address. The titles are whatever the export holds
// — no slug is pinned here (CLAUDE.md: no test pins live data editors change); a build with no
// title page fails rather than passing on nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'out';
const BASE = 'https://calvaryscribblings.co.uk';
const ROOMS = new Set(['desiderata', 'search']); // the shop's rooms, not titles
const canonicals = (html) => [...html.matchAll(/<link[^>]*rel="canonical"[^>]*>/g)]
  .map((m) => (m[0].match(/href="([^"]*)"/) || [])[1]);

test('out/ is built', () => {
  assert.ok(existsSync(join(OUT, 'bookstore.html')), 'no out/bookstore.html: run next build first');
});

test('the Book Store front page: canonical /bookstore', () => {
  assert.deepEqual(canonicals(readFileSync(join(OUT, 'bookstore.html'), 'utf8')), [`${BASE}/bookstore`]);
});

test('every title page: exactly one canonical, and it is the page\'s own address', () => {
  const dir = join(OUT, 'bookstore');
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith('.html') && statSync(join(dir, f)).isFile())
    .map((f) => f.slice(0, -5))
    .filter((s) => !ROOMS.has(s) && !s.startsWith('_'));
  assert.ok(pages.length > 0, 'no title page in the export');
  const wrong = pages.filter((s) => {
    const c = canonicals(readFileSync(join(dir, `${s}.html`), 'utf8'));
    return c.length !== 1 || c[0] !== `${BASE}/bookstore/${s}`;
  });
  assert.equal(wrong.length, 0, `${wrong.length} of ${pages.length} title pages carry another canonical`);
});
