// EDGE-2 — the guard's logic, and the guard on the REAL asset server over small deployments.
//
//   npm run test:edge          (no build, no emulator, no network)
//
// The end-to-end proof over two real Next builds is tests/edge/preservation.proof.mjs
// (npm run test:edge:proof). This file is the part CI runs on every push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUARD_MS, PRESERVATION_MS, MAX_ROUTE_RULES, foldLedger, ledgerFor, ledgerKey, readLedgerEntries, routesFor, rulesFor, pageKeyOf,
  _resetGuardForTests,
} from '../../app/lib/edgeGuard.mjs';
import { functionIncludesOf, assertDeployable, refusalOnPages } from '../../scripts/generate-edge-guard.mjs';
import { onRequest as storiesGuard } from '../../functions/stories/[[path]].js';
import { onRequest as readerGuard } from '../../functions/reader/[[path]].js';
import { onRequest as bookstoreGuard } from '../../functions/bookstore/[[path]].js';
import { onRequest as seriesGuard } from '../../functions/series/[[path]].js';
import { onRequest as voicesGuard } from '../../functions/voices/[[path]].js';
import { colo, deployment, clock } from './pages-runtime.mjs';
import { CACHE_CONTROL_PRESERVATION, ASSET_PRESERVATION_CACHE, WRANGLER_VERSION } from './vendor/pages-asset-server.mjs';
import { isRoutingRuleMatch } from './vendor/pages-dev-util.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const H = 'https://www.example.test';
const NOW = Date.UTC(2026, 10, 2, 12);

test('the vendored asset server is wrangler 4.81.0 and its preservation constants are the ones EDGE-1 measured', () => {
  assert.equal(WRANGLER_VERSION, '4.81.0');
  assert.equal(ASSET_PRESERVATION_CACHE, 'assetPreservationCacheV2');
  assert.equal(CACHE_CONTROL_PRESERVATION, 'public, s-maxage=604800');
  assert.equal(PRESERVATION_MS, 604800e3);
  assert.equal(GUARD_MS, 8 * 864e5);
});

test('page keys: a page\'s own addresses map to it, at any depth, in all five families; nothing else does', () => {
  const cases = {
    '/stories/a-b': 'stories/a-b', '/stories/a-b/': 'stories/a-b', '/stories/a-b.html': 'stories/a-b', '/stories/a-b.txt': 'stories/a-b',
    '/stories/a-b/__next._full.txt': 'stories/a-b', '/reader/a-b/__next.reader.$d$slug.__PAGE__.txt': 'reader/a-b',
    '/bookstore/a-book': 'bookstore/a-book', '/bookstore/search.txt': 'bookstore/search',
    '/series/s-one': 'series/s-one', '/series/s-one/notes': 'series/s-one/notes', '/series/instalment/x1.txt': 'series/instalment/x1',
    '/voices/an-author': 'voices/an-author',
  };
  for (const [p, k] of Object.entries(cases)) assert.equal(pageKeyOf(p), k, p);
  for (const p of ['/stories', '/stories/', '/api/story', '/og/image', '/bookstore/__next._full.txt', '/stories/../x']) assert.equal(pageKeyOf(p), null, p);
});

const SECRET = 'fixture-ledger-secret-0123456789abcdef';

test('the ledger: a page the live deployment had and this build lacks is guarded from now, for 8 days', async () => {
  const k = await ledgerKey(SECRET);
  const pages = new Set(['stories/kept', 'reader/kept']);
  const guarded = foldLedger({ prevPages: ['stories/kept', 'reader/kept', 'stories/gone', 'reader/gone'], pages, now: NOW });
  assert.deepEqual(guarded.map((g) => g.key).sort(), ['reader/gone', 'stories/gone']);
  assert.ok(guarded.every((g) => g.since === NOW));

  const ledger = await ledgerFor({ pages, guarded, k, builtAt: NOW });
  const { entries, status } = await readLedgerEntries(ledger, k);
  assert.equal(status, 'ok');
  const carry = (now, p = pages) => foldLedger({ prevPages: ledger.pages, carried: entries, pages: p, now });
  assert.deepEqual(carry(NOW + 3 * 864e5).map((g) => [g.key, g.since]).sort(), [['reader/gone', NOW], ['stories/gone', NOW]]);
  assert.deepEqual(carry(NOW + GUARD_MS), [], 'after 8 days every preserved copy has expired');
  assert.deepEqual(carry(NOW + 864e5, new Set([...pages, 'stories/gone'])).map((g) => g.key), ['reader/gone'], 'its page came back');
});

test('the ledger names no page that is not live, cannot confirm a guess, and reads back only under its own key', async () => {
  const k = await ledgerKey(SECRET);
  const pages = new Set(['stories/kept']);
  const guarded = [{ key: 'stories/unreleased-secret-tale', since: NOW }, { key: 'stories/deleted-tale', since: NOW - 1000 }];
  const ledger = await ledgerFor({ pages, guarded, k, builtAt: NOW });
  const text = JSON.stringify(ledger);
  assert.doesNotMatch(text, /unreleased-secret-tale|deleted-tale/);
  assert.deepEqual(Object.keys(ledger).sort(), ['builtAt', 'guarded', 'kid', 'pages', 'v']);
  assert.ok(ledger.guarded.every((g) => Object.keys(g).join() === 'c'), 'each entry is one sealed blob, nothing beside it');
  assert.equal(ledger.guarded.length, 8, 'padded to a multiple of 8: the count is not exact');
  // sealing is randomised, so the same page sealed twice gives two different blobs: a guess cannot
  // be checked by sealing it and comparing, and two ledgers cannot be compared entry by entry.
  const again = await ledgerFor({ pages, guarded, k, builtAt: NOW });
  assert.equal(ledger.guarded.filter((g) => again.guarded.some((h) => h.c === g.c)).length, 0);
  // a SHA-256 of the slug (with or without a prefix) appears nowhere
  for (const guess of ['stories/unreleased-secret-tale', 'unreleased-secret-tale', 'edge-ledger:stories/unreleased-secret-tale']) {
    const h = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(guess))).toString('hex');
    assert.ok(!text.includes(h.slice(0, 16)));
  }
  const back = await readLedgerEntries(ledger, k);
  assert.deepEqual(back.entries.map((e) => e.key).sort(), ['stories/deleted-tale', 'stories/unreleased-secret-tale'], 'decoys are dropped');
  const other = await readLedgerEntries(ledger, await ledgerKey('another-secret-entirely-0123456789abcdef'));
  assert.deepEqual(other, { entries: [], status: 'other-key' });
  const tampered = { ...ledger, guarded: [{ c: ledger.guarded[0].c.slice(0, -4) + 'AAAA' }] };
  await assert.rejects(readLedgerEntries(tampered, k), 'an altered entry is an error, not a silent drop');
  await assert.rejects(ledgerKey('Zq9-too-brief'), (e) => /EDGE_LEDGER_KEY/.test(e.message) && !/Zq9/.test(e.message));
  await assert.rejects(ledgerKey(undefined), /EDGE_LEDGER_KEY/);
});

test('bootstrap (no ledger on the live site): the seed, and nothing past its 8 days', () => {
  const seed = [{ key: 'stories/s', since: NOW - 2 * 864e5 }, { key: 'stories/old', since: NOW - 9 * 864e5 }];
  assert.deepEqual(foldLedger({ prevPages: null, pages: new Set(), seed, now: NOW }).map((g) => g.key), ['stories/s']);
});

test('rules: one prefix rule per page, unless a live page shares the prefix — then its four exact forms', () => {
  assert.deepEqual(rulesFor('stories/tale', ['/stories/other.html']), ['/stories/tale*']);
  const built = ['/stories/tale-two.html', '/stories/tale-two', '/stories/tale-two.txt'];
  const exact = rulesFor('stories/tale', built);
  assert.deepEqual(exact, ['/stories/tale', '/stories/tale.html', '/stories/tale.txt', '/stories/tale/__next*']);
  for (const b of built) assert.ok(!exact.some((r) => isRoutingRuleMatch(b, r)), `${b} never reaches the Function`);
  for (const own of ['/stories/tale', '/stories/tale/', '/stories/tale.txt', '/stories/tale/__next._full.txt']) {
    assert.ok(exact.some((r) => isRoutingRuleMatch(own, r)), `${own} is guarded`);
  }
  // a removed series whose notes page is still live: the notes page is another page, not one of its addresses
  const nested = rulesFor('series/s-one', ['/series/s-one/notes.html', '/series/s-one/notes', '/series/s-one/notes/__next._full.txt']);
  assert.equal(nested.length, 4);
  for (const b of ['/series/s-one/notes', '/series/s-one/notes.txt', '/series/s-one/notes/__next._full.txt']) assert.ok(!nested.some((r) => isRoutingRuleMatch(b, r)), b);
  assert.ok(nested.some((r) => isRoutingRuleMatch('/series/s-one/__next._tree.txt', r)));
  // a slug long enough to break the 100-character rule limit is cut to fit; still one rule
  const long = `reader/${'a'.repeat(120)}`;
  const [r] = rulesFor(long, []);
  assert.equal(r.length, 100);
  assert.ok(isRoutingRuleMatch(`/${long}`, r));
});

test('_routes.json: the Functions first, then the newest removals while they fit; past 100 the oldest are left out and said so', async () => {
  const functionIncludes = await functionIncludesOf(join(ROOT, 'functions'));
  assert.deepEqual(functionIncludes, ['/api/*', '/og/*'], 'every Function directory is routed (and the guard dirs are not, wholesale)');
  const guarded = Array.from({ length: 120 }, (_, i) => ({ key: `stories/s${String(i).padStart(3, '0')}`, since: NOW - i * 1000 }));
  const { routes, routed, dropped } = routesFor({ functionIncludes, guarded, builtPaths: [] });
  assert.equal(routes.include.length, MAX_ROUTE_RULES);
  assert.equal(routed.length, 98);
  assert.equal(dropped.length, 22);
  assert.ok(Math.min(...routed.map((g) => g.since)) > Math.max(...dropped.map((g) => g.since)), 'what is left out is the oldest');
  assertDeployable(routes);
  assert.throws(() => assertDeployable({ ...routes, include: [...routes.include, '/x'] }), /> 100/);
});

test('functions/_middleware.js would route every request through a Function, so the build refuses it', async () => {
  const d = mkdtempSync(join(tmpdir(), 'edge-fn-'));
  try {
    writeFileSync(join(d, '_middleware.js'), '');
    await assert.rejects(functionIncludesOf(d), /EVERY request/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── A production build never skips the guard; CI builds use a throwaway key ──────────────────

// The child's environment: this one, minus everything the guard or the CI script reads, plus `extra`.
// Assertion messages never carry a key.
function childEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('EDGE_') || k === 'CF_PAGES' || k === 'GITHUB_ENV') delete env[k];
  return { ...env, ...extra };
}
const THROWAWAY_TEST_KEY = 'x'.repeat(16) + 'edge-guard-refusal-test-only';   // not a key anywhere

test('EDGE_LEDGER=none is refused on Cloudflare\'s build (CF_PAGES), and only there', () => {
  assert.match(refusalOnPages({ CF_PAGES: '1', EDGE_LEDGER: 'none' }), /CF_PAGES/);
  assert.equal(refusalOnPages({ CF_PAGES: '1' }), null, 'a Pages build reading the live ledger goes ahead');
  assert.equal(refusalOnPages({ EDGE_LEDGER: 'none' }), null, 'a build that is never deployed may bootstrap');
  assert.equal(refusalOnPages({}), null);
});

test('the build step itself: with CF_PAGES and EDGE_LEDGER=none it exits 1 and writes nothing', () => {
  const out = site({ '404.html': NOT_FOUND, 'stories/kept.html': '<p>kept</p>' });
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/generate-edge-guard.mjs')], {
      env: childEnv({ CF_PAGES: '1', EDGE_LEDGER: 'none', EDGE_LEDGER_KEY: THROWAWAY_TEST_KEY, EDGE_OUT_DIR: out }),
      encoding: 'utf8', timeout: 60000,
    });
    assert.equal(r.status, 1, 'the build fails');
    assert.match(r.stderr, /EDGE_LEDGER=none on a Cloudflare Pages build/);
    assert.ok(!existsSync(join(out, '_routes.json')), 'no _routes.json');
    assert.ok(!existsSync(join(out, '_edge')), 'no ledger');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('the CI step: a fresh 32-byte key and EDGE_LEDGER=none go to GITHUB_ENV, masked, and never to the log', () => {
  const d = mkdtempSync(join(tmpdir(), 'edge-ci-'));
  try {
    const envFile = join(d, 'github_env');
    writeFileSync(envFile, '');
    const run = () => spawnSync(process.execPath, [join(ROOT, 'scripts/ci/edge-ledger-throwaway.mjs')], {
      env: childEnv({ GITHUB_ENV: envFile }), encoding: 'utf8', timeout: 30000,
    });
    const a = run();
    assert.equal(a.status, 0);
    const lines = readFileSync(envFile, 'utf8').trim().split('\n');
    const key = lines.find((l) => l.startsWith('EDGE_LEDGER_KEY='))?.slice('EDGE_LEDGER_KEY='.length) ?? '';
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(key), 'a 32-byte base64url key');
    assert.ok(lines.includes('EDGE_LEDGER=none'), 'EDGE_LEDGER=none beside it');
    const printed = a.stdout + a.stderr;
    const maskAt = printed.indexOf('::add-mask::');
    assert.ok(maskAt === 0, 'the mask command comes first');
    assert.ok(printed.split(key).length === 2, 'the key appears only inside the mask command');
    run();
    const keys = readFileSync(envFile, 'utf8').split('\n').filter((l) => l.startsWith('EDGE_LEDGER_KEY='));
    assert.ok(keys.length === 2 && keys[0] !== keys[1], 'every run makes its own key');
    const cf = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/edge-ledger-throwaway.mjs')], {
      env: childEnv({ GITHUB_ENV: envFile, CF_PAGES: '1' }), encoding: 'utf8', timeout: 30000,
    });
    assert.equal(cf.status, 1, 'refuses on a Cloudflare build');
    const none = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/edge-ledger-throwaway.mjs')], { env: childEnv({}), encoding: 'utf8', timeout: 30000 });
    assert.equal(none.status, 1, 'refuses outside Actions');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── On the real asset server ─────────────────────────────────────────────────────────────────

function site(files) {
  const d = mkdtempSync(join(tmpdir(), 'edge-site-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return d;
}
const NOT_FOUND = '<!DOCTYPE html><html><body>This page does not exist.</body></html>';
const guardFns = [
  { match: (p) => p.startsWith('/stories/'), onRequest: storiesGuard },
  { match: (p) => p.startsWith('/reader/'), onRequest: readerGuard },
  { match: (p) => p.startsWith('/bookstore/'), onRequest: bookstoreGuard },
  { match: (p) => p.startsWith('/series/'), onRequest: seriesGuard },
  { match: (p) => p.startsWith('/voices/'), onRequest: voicesGuard },
];
// A withdrawn book, a removed series (its page, its notes, an instalment), a removed author.
const OTHER_GONE = ['/bookstore/withdrawn-book', '/bookstore/withdrawn-book.txt?_rsc=9', '/series/gone-series', '/series/gone-series/notes',
  '/series/instalment/i9', '/series/read/i9.txt?_rsc=2', '/voices/gone-author'];
// Every address a reader's browser fetches for a live page. (/stories/gone/ and /stories/gone.html
// are 308s to the page while it is live, and a redirect is never preserved; the guard covers them anyway.)
const ADDRESSES = ['/stories/gone', '/stories/gone.txt?_rsc=abc', '/stories/gone/__next._full.txt', '/reader/gone', '/stories/gone?ref=share'];

test('on the asset server: a removed page that was served answers 404 from the next deployment; live pages never touch a Function', async (t) => {
  clock.now = NOW;
  _resetGuardForTests();
  const pagesA = ['stories/gone', 'reader/gone', 'stories/gone-sequel', 'stories/live',
    'bookstore/withdrawn-book', 'bookstore/kept-book', 'bookstore/search', 'series/gone-series', 'series/gone-series/notes',
    'series/kept-series', 'series/kept-series/notes', 'series/instalment/i9', 'series/read/i9', 'series/instalment/i1', 'voices/gone-author', 'voices/kept-author'];
  const filesA = { '404.html': NOT_FOUND, '_edge/ledger.json': { v: 1, pages: pagesA, guarded: [] } };
  for (const k of pagesA) Object.assign(filesA, { [`${k}.html`]: `<html>${k} WORDS</html>`, [`${k}.txt`]: `rsc ${k}`, [`${k}/__next._full.txt`]: `seg ${k}` });
  const A = site(filesA);

  const pagesB = ['stories/gone-sequel', 'stories/live', 'bookstore/kept-book', 'bookstore/search', 'series/kept-series',
    'series/kept-series/notes', 'series/instalment/i1', 'voices/kept-author'];
  const filesB = { '404.html': NOT_FOUND };
  for (const k of pagesB) Object.assign(filesB, { [`${k}.html`]: `<html>${k} WORDS</html>`, [`${k}.txt`]: `rsc ${k}`, [`${k}/__next._full.txt`]: `seg ${k}` });
  const builtB = Object.keys(filesB).map((p) => `/${p}`).flatMap((p) => (p.endsWith('.html') ? [p, p.slice(0, -5)] : [p]));
  const guarded = foldLedger({ prevPages: pagesA, pages: new Set(pagesB), now: NOW });
  const { routes } = routesFor({ functionIncludes: ['/api/*', '/og/*'], guarded, builtPaths: builtB });
  const ledgerB = await ledgerFor({ pages: new Set(pagesB), guarded, k: await ledgerKey(SECRET), builtAt: NOW });
  const B = site({ ...filesB, '_edge/ledger.json': ledgerB, '_routes.json': routes });
  const B_unguarded = site({ ...filesB, '_edge/ledger.json': ledgerB, '_routes.json': { version: 1, include: ['/api/*', '/og/*'], exclude: [] } });

  try {
    const c = colo();
    c.activate(deployment(A, { functions: guardFns }));
    for (const a of [...ADDRESSES, ...OTHER_GONE]) assert.equal((await c.fetch(H + a)).status, 200, `served live: ${a}`);

    await t.test('control: without the guard, the asset server answers from the preservation store (EDGE-1)', async () => {
      c.activate(deployment(B_unguarded, { functions: guardFns }));
      for (const a of [...ADDRESSES, ...OTHER_GONE]) {
        const r = await c.fetch(H + a);
        assert.equal(r.status, 200, `preserved: ${a}`);
        assert.equal(r.headers.get('cache-control'), 'public, s-maxage=604800');
        assert.equal(r.headers.get('x-robots-tag'), 'noindex');
      }
      assert.equal((await c.fetch(`${H}/stories/gone?never-requested=1`)).status, 404, 'only URLs fetched while live are preserved');
    });

    await t.test('with the guard: every address 404s — the page with the site 404 page, page data bare', async () => {
      c.activate(deployment(B, { functions: guardFns }));
      _resetGuardForTests();
      for (const a of [...ADDRESSES, ...OTHER_GONE, '/stories/gone/', '/stories/gone.html']) {
        const r = await c.fetch(H + a);
        const body = await r.text();
        assert.equal(r.status, 404, a);
        assert.doesNotMatch(body, /WORDS|rsc|seg/, `${a}: none of the old page`);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const page = !/\.txt|__next/.test(a);
        if (page) assert.equal(body, NOT_FOUND, `${a}: the site's 404 page`);
      }
      const head = await c.fetch(new Request(`${H}/stories/gone`, { method: 'HEAD' }));
      assert.equal(head.status, 404);
    });

    await t.test('live pages, including one sharing the removed slug as a prefix, are served with no Function', async () => {
      c.stats.functionCalls.length = 0;
      for (const k of pagesB) {
        for (const a of [`/${k}`, `/${k}.txt?_rsc=1`, `/${k}/__next._full.txt`]) {
          const r = await c.fetch(H + a);
          assert.equal(r.status, 200, a);
          assert.match(await r.text(), new RegExp(k.replace('/', '\\/')));
        }
      }
      assert.deepEqual(c.stats.functionCalls, [], 'no live address invoked a Function');
    });

    await t.test('if the guard is ever handed a live page (no custom _routes.json), it serves the page', async () => {
      _resetGuardForTests();
      const everything = site({ ...filesB, '_edge/ledger.json': ledgerB, '_routes.json': { version: 1, include: ['/stories/*', '/reader/*'], exclude: [] } });
      try {
        c.activate(deployment(everything, { functions: guardFns }));
        const r = await c.fetch(`${H}/stories/live`);
        assert.equal(r.status, 200);
        assert.match(await r.text(), /stories\/live WORDS/);
        assert.equal((await c.fetch(`${H}/stories/gone`)).status, 404);
      } finally { rmSync(everything, { recursive: true, force: true }); _resetGuardForTests(); }
    });

    await t.test('_redirects acts before the store (a 301), _headers cannot change its status', async () => {
      const redir = site({ ...filesB, _redirects: '/stories/gone /stories/live 301\n', _headers: '/stories/*\n  X-Edge-Test: 1\n' });
      try {
        c.activate(deployment(redir, { functions: guardFns }));
        const r = await c.fetch(`${H}/stories/gone`);
        assert.equal(r.status, 301);
        const h = await c.fetch(`${H}/stories/gone.txt?_rsc=abc`);
        assert.equal(h.status, 200, '_headers ran, and the preserved copy still answered');
        assert.equal(h.headers.get('x-edge-test'), '1');
        assert.equal(h.headers.get('cache-control'), 'public, s-maxage=604800');
      } finally { rmSync(redir, { recursive: true, force: true }); }
    });

    await t.test('the store forgets after 7 days, so 8 days of guard is enough', async () => {
      c.activate(deployment(B_unguarded, { functions: guardFns }));
      clock.now = NOW + PRESERVATION_MS - 1000;
      assert.equal((await c.fetch(`${H}/stories/gone`)).status, 200);
      clock.now = NOW + PRESERVATION_MS + 1000;
      for (const a of ADDRESSES) assert.equal((await c.fetch(H + a)).status, 404, a);
    });
  } finally {
    clock.now = Date.now();
    for (const d of [A, B, B_unguarded]) rmSync(d, { recursive: true, force: true });
  }
});
