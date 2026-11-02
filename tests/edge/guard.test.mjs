// EDGE-2 — the guard's logic, and the guard on the REAL asset server over small deployments.
//
//   npm run test:edge          (no build, no emulator, no network)
//
// The end-to-end proof over two real Next builds is tests/edge/preservation.proof.mjs
// (npm run test:edge:proof). This file is the part CI runs on every push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUARD_MS, PRESERVATION_MS, MAX_ROUTE_RULES, foldLedger, ledgerFor, routesFor, rulesFor, hashKey, pageKeyOf,
  _resetGuardForTests,
} from '../../app/lib/edgeGuard.mjs';
import { functionIncludesOf, assertDeployable } from '../../scripts/generate-edge-guard.mjs';
import { onRequest as storiesGuard } from '../../functions/stories/[[path]].js';
import { onRequest as readerGuard } from '../../functions/reader/[[path]].js';
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

test('page keys: the page, its .html, its .txt and its segment data all belong to it; nothing else does', () => {
  for (const p of ['/stories/a-b', '/stories/a-b/', '/stories/a-b.html', '/stories/a-b.txt', '/stories/a-b/__next._full.txt', '/reader/a-b']) {
    assert.ok(pageKeyOf(p), p);
  }
  assert.equal(pageKeyOf('/stories/a-b.txt'), 'stories/a-b');
  assert.equal(pageKeyOf('/reader/a-b/__next.reader.$d$slug.__PAGE__.txt'), 'reader/a-b');
  for (const p of ['/stories', '/stories/', '/voices/a', '/api/story', '/stories/a.b.c']) assert.equal(pageKeyOf(p), null, p);
});

test('the ledger: a page the live deployment had and this build lacks is guarded from now, for 8 days', async () => {
  const pages = new Set(['stories/kept', 'reader/kept']);
  const prev = { v: 1, pages: ['stories/kept', 'reader/kept', 'stories/gone', 'reader/gone'], guarded: [] };
  const candidates = new Set([...pages, 'stories/gone', 'reader/gone']);
  const { guarded } = await foldLedger({ prev, pages, candidates, now: NOW });
  assert.deepEqual(guarded.map((g) => g.key).sort(), ['reader/gone', 'stories/gone']);
  assert.ok(guarded.every((g) => g.since === NOW));

  // carried forward by the next build, hashed, and recovered from the catalogue
  const ledger = await ledgerFor({ pages, guarded, unresolved: [], candidates, builtAt: NOW });
  assert.ok(ledger.guarded.every((g) => g.h && !g.key), 'a slug the catalogue still names is published only as a hash');
  assert.doesNotMatch(JSON.stringify(ledger), /gone/);
  const later = await foldLedger({ prev: ledger, pages, candidates, now: NOW + 3 * 864e5 });
  assert.deepEqual(later.guarded.map((g) => [g.key, g.since]).sort(), [['reader/gone', NOW], ['stories/gone', NOW]]);
  const lapsed = await foldLedger({ prev: ledger, pages, candidates, now: NOW + GUARD_MS });
  assert.deepEqual(lapsed.guarded, [], 'after 8 days every preserved copy has expired');

  // its page comes back: no longer guarded
  const back = await foldLedger({ prev: ledger, pages: new Set([...pages, 'stories/gone']), candidates, now: NOW + 864e5 });
  assert.deepEqual(back.guarded.map((g) => g.key), ['reader/gone']);
});

test('the ledger: a record deleted outright is carried as its address, since no hash of it can be recovered', async () => {
  const pages = new Set(['stories/kept']);
  const prev = { v: 1, pages: ['stories/kept', 'stories/deleted'], guarded: [] };
  const candidates = new Set(pages);                 // the catalogue no longer names it
  const { guarded } = await foldLedger({ prev, pages, candidates, now: NOW });
  const ledger = await ledgerFor({ pages, guarded, unresolved: [], candidates, builtAt: NOW });
  assert.deepEqual(ledger.guarded, [{ key: 'stories/deleted', since: NOW }]);
  const next = await foldLedger({ prev: ledger, pages, candidates, now: NOW + 864e5 });
  assert.deepEqual(next.guarded.map((g) => g.key), ['stories/deleted']);

  // a hash nobody can resolve is carried, not routed, and lapses on time
  const orphan = { v: 1, pages: [], guarded: [{ h: await hashKey('stories/x'), since: NOW }] };
  const o = await foldLedger({ prev: orphan, pages, candidates, now: NOW + 864e5 });
  assert.equal(o.guarded.length, 0);
  assert.equal(o.unresolved.length, 1);
  assert.equal((await foldLedger({ prev: orphan, pages, candidates, now: NOW + GUARD_MS })).unresolved.length, 0);
});

test('bootstrap (no ledger on the live site): the seed, and nothing past its 8 days', async () => {
  const seed = [{ key: 'stories/s', since: NOW - 2 * 864e5 }, { key: 'stories/old', since: NOW - 9 * 864e5 }];
  const { guarded } = await foldLedger({ prev: null, pages: new Set(), candidates: new Set(), seed, now: NOW });
  assert.deepEqual(guarded.map((g) => g.key), ['stories/s']);
});

test('rules: one prefix rule per page, unless a live page shares the prefix — then its four exact forms', () => {
  assert.deepEqual(rulesFor('stories/tale', ['/stories/other.html']), ['/stories/tale*']);
  const built = ['/stories/tale-two.html', '/stories/tale-two', '/stories/tale-two.txt'];
  const exact = rulesFor('stories/tale', built);
  assert.deepEqual(exact, ['/stories/tale', '/stories/tale.html', '/stories/tale.txt', '/stories/tale/*']);
  for (const b of built) assert.ok(!exact.some((r) => isRoutingRuleMatch(b, r)), `${b} never reaches the Function`);
  for (const own of ['/stories/tale', '/stories/tale/', '/stories/tale.txt', '/stories/tale/__next._full.txt']) {
    assert.ok(exact.some((r) => isRoutingRuleMatch(own, r)), `${own} is guarded`);
  }
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
];
// Every address a reader's browser fetches for a live page. (/stories/gone/ and /stories/gone.html
// are 308s to the page while it is live, and a redirect is never preserved; the guard covers them anyway.)
const ADDRESSES = ['/stories/gone', '/stories/gone.txt?_rsc=abc', '/stories/gone/__next._full.txt', '/reader/gone', '/stories/gone?ref=share'];

test('on the asset server: a removed page that was served answers 404 from the next deployment; live pages never touch a Function', async (t) => {
  clock.now = NOW;
  _resetGuardForTests();
  const pagesA = ['stories/gone', 'reader/gone', 'stories/gone-sequel', 'stories/live'];
  const filesA = { '404.html': NOT_FOUND, '_edge/ledger.json': { v: 1, pages: pagesA, guarded: [] } };
  for (const k of pagesA) Object.assign(filesA, { [`${k}.html`]: `<html>${k} WORDS</html>`, [`${k}.txt`]: `rsc ${k}`, [`${k}/__next._full.txt`]: `seg ${k}` });
  const A = site(filesA);

  const pagesB = ['stories/gone-sequel', 'stories/live'];
  const filesB = { '404.html': NOT_FOUND };
  for (const k of pagesB) Object.assign(filesB, { [`${k}.html`]: `<html>${k} WORDS</html>`, [`${k}.txt`]: `rsc ${k}`, [`${k}/__next._full.txt`]: `seg ${k}` });
  const builtB = Object.keys(filesB).map((p) => `/${p}`).flatMap((p) => (p.endsWith('.html') ? [p, p.slice(0, -5)] : [p]));
  const { guarded } = await foldLedger({ prev: { v: 1, pages: pagesA, guarded: [] }, pages: new Set(pagesB), candidates: new Set(pagesA), now: NOW });
  const { routes } = routesFor({ functionIncludes: ['/api/*', '/og/*'], guarded, builtPaths: builtB });
  const ledgerB = await ledgerFor({ pages: new Set(pagesB), guarded, unresolved: [], candidates: new Set(pagesA), builtAt: NOW });
  const B = site({ ...filesB, '_edge/ledger.json': ledgerB, '_routes.json': routes });
  const B_unguarded = site({ ...filesB, '_edge/ledger.json': ledgerB, '_routes.json': { version: 1, include: ['/api/*', '/og/*'], exclude: [] } });

  try {
    const c = colo();
    c.activate(deployment(A, { functions: guardFns }));
    for (const a of ADDRESSES) assert.equal((await c.fetch(H + a)).status, 200, `served live: ${a}`);

    await t.test('control: without the guard, the asset server answers from the preservation store (EDGE-1)', async () => {
      c.activate(deployment(B_unguarded, { functions: guardFns }));
      for (const a of ADDRESSES) {
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
      for (const a of [...ADDRESSES, '/stories/gone/', '/stories/gone.html']) {
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
