// W2 — the source half of the designed-states round. The browser half is tests/states/ (every
// public surface with the database unreachable). These guard what that harness cannot reach
// without a signed-in reader — My Library, Profile, /user, Settings — and the wiring every
// surface depends on: the loaders' throwOnError, the service worker, the root 404.
//
//   node --test tests/ci/designed-states.test.mjs      (npm run test:ci)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no page draws the blank board — the dark empty div that stood while loading, and for good offline', () => {
  const offenders = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) { walk(f); continue; }
      if (!/\.jsx?$/.test(n)) continue;
      if (/return <div style=\{\{ minHeight: '100vh', background: '#0d0d0d' \}\} \/>;/.test(readFileSync(f, 'utf8'))) offenders.push(relative(ROOT, f));
    }
  })(join(ROOT, 'app'));
  assert.deepEqual(offenders, []);
});

test('My Library never tells an owner they own nothing because a read failed (LIB-01)', () => {
  const s = code('app/my-library/page.js');
  assert.doesNotMatch(s, /setBooks\(\[\]\)/, 'a caught failure must not become an empty shelf');
  assert.match(s, /const booksLoad = useReliableLoad\(/);
  assert.match(s, /booksLoad\.phase === 'failed' && \(\s*<Unavailable kind=\{booksLoad\.failure\}/);
  assert.match(s, /subject="your books" note="They’re still yours\."/);
});

test('Profile: the first users/{uid} value has a deadline and a drawn failure (ACC-06)', () => {
  const s = code('app/profile/page.js');
  assert.match(s, /profileTimer = setTimeout\(\(\) => \{ if \(!arrived\) setProfileFailure\(/);
  assert.match(s, /if \(loading && profileFailure\) return <AccountUnavailable/);
  assert.match(s, /if \(loading\) return <AccountFrame><AccountSkeleton \/><\/AccountFrame>;/);
});

test('/user: a failed read is a failure, not "User not found." (ACC-06, ACC-07)', () => {
  const s = code('app/user/page.js');
  assert.match(s, /await readWithDeadline\(\(\) => Promise\.all\(fetches\)\)/);
  assert.match(s, /setLoadFailure\(e\.kind \|\| 'ours'\)/);
  assert.match(s, /if \(loadFailure\) return <AccountUnavailable/);
  assert.doesNotMatch(s, />User not found\.</);
});

test('Settings: its reads have a deadline and its loading state has a way home', () => {
  const s = code('app/settings/page.js');
  assert.match(s, /await readWithDeadline\(\(\) => Promise\.all\(\[/);
  assert.match(s, /if \(loading\) return <AccountFrame><AccountSkeleton \/><\/AccountFrame>;/);
});

test('the loaders can THROW for a reader page, and their default for everyone else is unchanged', () => {
  const series = code('app/lib/series/loader.js');
  for (const fn of ['getPublishedSeries', 'getSeriesBySlug', 'getInstalments', 'getInstalmentRow']) {
    const body = series.slice(series.indexOf(`export async function ${fn}(`)).split('\nexport ')[0];
    assert.match(body, /rethrowIf\(opts, err\);\s*return (\[\]|null);/, `${fn} must rethrow only when asked`);
  }
  const shop = code('app/lib/bookstore/loader.js');
  for (const fn of ['getAllPublishedTitles', 'getTitleBySlug']) {
    const body = shop.slice(shop.indexOf(`export async function ${fn}(`)).split('\nexport ')[0];
    assert.match(body, /if \(opts && opts\.throwOnError\) throw err;/, `${fn} must rethrow only when asked`);
  }
});

test('the Book Store: a failed read never reaches notFound(), and the storefront draws at once (BS-01, BS-02)', () => {
  const s = code('app/bookstore/page.js');
  assert.doesNotMatch(s, /setGateState\('empty'\)/, 'a caught failure used to become "no shop" and then the 404');
  assert.match(s, /if \(unlocked && shop\.data\?\.empty === true\) notFound\(\);/);
  assert.match(s, /const storeReady = unlocked && shop\.data\?\.empty !== true;/);
});

test('every category shelf reads through categoryShelf and never prints a count it does not have (STORY-04)', () => {
  for (const cat of ['short', 'poetry', 'flash', 'news', 'inspiring']) {
    const s = code(`app/${cat}/page.js`);
    assert.match(s, /useReliableLoad\(\(\) => loadCategoryShelf\(cat\), \[\]\)/, cat);
    assert.doesNotMatch(s, /\.length\} stories/, `${cat} must not print a raw count`);
    assert.match(s, /<ShelfState shelf=\{shelf\}/, cat);
  }
});

test('the service worker registers site-wide and a fenced navigation fails into the house page (SPD-09, SPD-10)', () => {
  const providers = code('app/components/Providers.js');
  assert.match(providers, /import\('\.\.\/lib\/shelfWorker'\)\.then\(\(m\) => m\.registerShelfWorker\(\)\)/);
  const sw = src('public/sw.js').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(sw, /if \(isPassThrough\(event\.request, url\)\) \{\s*[\s\S]{0,300}event\.respondWith\(fetch\(event\.request\)\.catch\(\(\) => \{ broadcast\(\{ type: 'CS_OFFLINE' \}\); return offlineResponse\(url\); \}\)\);/);
  assert.match(sw, /!url\.pathname\.startsWith\('\/api\/'\)/, 'an API call is never answered with a page');
  // and still NOTHING fenced is cached: no cache.put / cacheFirst / networkFirst on that branch
  const branch = sw.slice(sw.indexOf('if (isPassThrough(event.request, url)) {'), sw.indexOf('if (isStaticChunk(url))'));
  assert.doesNotMatch(branch, /cache|networkFirst|cacheFirst/i);
});

test('there is a root 404, and it is the house page', () => {
  assert.ok(existsSync(join(ROOT, 'app/not-found.js')));
  assert.match(src('app/not-found.js'), /<NotFoundPage \/>/);
  assert.match(src('app/components/NotFoundPage.js'), /<TabBar \/>/);
});

test('the curtain does not inert the tab bar (SPD-08)', () => {
  assert.match(code('app/bookstore/components/LaunchGate.js'), /if \(el\.matches\?\.\('nav\.cs-tabbar'\)\) continue;/);
});
