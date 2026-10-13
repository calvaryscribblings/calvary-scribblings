// W39 — the stray "@" handles, and the Book Store door's count line (ruling 132).
//
//   node --test tests/ci/w39-followups.test.mjs      (part of npm run test:ci)
//
// The handle guard: the write path strips a leading "@" for series and instalments, the
// validators refuse one, and the story CMS's save strips it too. The door line: the same class
// as the Library door's, counted by the sitemap's rule, hidden when the count is 0.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bareHandle, validateSeries, validateInstalmentDetail } from '../../app/lib/series/schema.js';
import { strayHandles } from '../../scripts/series/strip-handle-at.mjs';
import { sitemapTitleSlugs } from '../../app/lib/bookstore/sitemapTitles.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const DETAIL = { schemaVersion: 1, title: 'Three', author: 'W', authorUid: 'u', authorHandle: 'w', coverUrl: null, epubPath: null, updatedAt: 1 };
const SERIES = { schemaVersion: 1, slug: 's', title: 'S', synopsis: '', coverUrl: null, status: 'draft', addedAt: 1, updatedAt: 1, author: 'W', authorUid: 'u', authorHandle: 'w' };

describe('W39 · a writer handle is stored without its @', () => {
  test('bareHandle strips any number of leading @, and spaces, and nothing else', () => {
    assert.equal(bareHandle('@tricia_ajax'), 'tricia_ajax');
    assert.equal(bareHandle(' @@name '), 'name');
    assert.equal(bareHandle('name@x'), 'name@x');
    assert.equal(bareHandle(undefined), '');
  });

  test('both validators refuse a handle that still starts with @', () => {
    assert.match(validateInstalmentDetail({ ...DETAIL, authorHandle: '@w' }).errors.join(), /without the @/);
    assert.match(validateInstalmentDetail({ ...DETAIL, authorHandle: '@w' }, { publishing: true }).errors.join(), /without the @/);
    assert.equal(validateInstalmentDetail(DETAIL).valid, true);
    assert.match(validateSeries({ ...SERIES, authorHandle: '@w' }).errors.join(), /without the @/);
  });

  test('every series write path strips it before validating', () => {
    const w = src('app/lib/series/admin-writes.js');
    const body = (name) => { const i = w.indexOf(`export async function ${name}(`); return w.slice(i, w.indexOf('\nexport ', i + 10)); };
    assert.match(w, /function writerOf[\s\S]*?authorHandle: bareHandle\(/, 'the series writer trio (create + update)');
    assert.match(body('createInstalment'), /authorHandle: bareHandle\(input\.authorHandle\)/);
    assert.match(body('updateInstalment'), /detail\.authorHandle = bareHandle\(detail\.authorHandle\)[\s\S]*validateInstalmentDetail\(detail/);
    assert.match(body('publishInstalment'), /nextDetail\.authorHandle = bareHandle\(nextDetail\.authorHandle\)[\s\S]*validateInstalmentDetail\(nextDetail/);
  });

  test('the story CMS saves the handle bare, whatever the field held', () => {
    const a = src('app/admin/page.js');
    assert.match(a, /const authorHandle = \(\(form\.authorHandle \|\| ''\)\.trim\(\) \|\| defaultHandle \|\| ''\)\.replace\(\/\^@\+\/, ''\);/);
  });

  test('the sweep finds a stray @ on any series node and plans the bare handle only', () => {
    const plan = strayHandles({
      series: { a: { authorHandle: 'ok' }, b: { authorHandle: '@bee' } },
      series_instalments: { 'a-i1': { status: 'published' } },
      series_instalments_detail: { 'a-i1': { authorHandle: 'ok' }, 'b-i2': { authorHandle: ' @@bee' } },
    });
    assert.deepEqual(plan, [['series/b/authorHandle', 'bee'], ['series_instalments_detail/b-i2/authorHandle', 'bee']]);
  });
});

describe('W39 · ruling 132, the Book Store door\'s count line', () => {
  const g = src('app/components/Gateway.js');

  test('it is the Library door\'s line: the same class, nothing added, hidden at 0', () => {
    assert.match(g, /<span className="cs-gw-door-meta">\s*\{storyCount > 0/, 'the Library door line');
    assert.match(g, /\{titleCount > 0 && <span className="cs-gw-door-meta">\{`\$\{titleCount\} \$\{titleCount === 1 \? 'title' : 'titles'\}`\}<\/span>\}/);
    assert.ok(!/cs-gw-door-meta\.cs-gw-titles|cs-gw-titles/.test(g), 'no class of its own, so nothing can drift');
  });

  test('it is read at build time, by the sitemap\'s rule, and the gateway stays zero-Firebase', () => {
    const b = src('app/lib/gateway-build.js');
    assert.match(b, /sitemapTitleSlugs\(data\.titles, data\.publishers\)\.length/);
    assert.match(b, /buildReadOptional\(\s*'bookstore_titles \+ bookstore_publishers'/);
    assert.match(src('app/page.js'), /titleCount=\{titleCount\}/);
    assert.ok(!/from ['"]firebase\//.test(g) && !/lib\/firebase/.test(g), 'Gateway.js imports no Firebase');
  });

  test('the count is published catalogue titles only', () => {
    const titles = {
      a: { slug: 'a', status: 'published', publisherId: 'p' },
      b: { slug: 'b', status: 'draft', publisherId: 'p' },
      c: { slug: 'c', status: 'withdrawn', publisherId: 'p' },
      d: { slug: 'd', status: 'published', publisherId: 'gone' },
      e: { slug: 'e', status: 'unpublished', publisherId: 'p' },
    };
    const pubs = { p: { status: 'active' }, gone: { status: 'suspended' } };
    assert.equal(sitemapTitleSlugs(titles, pubs).length, 1);
  });
});
