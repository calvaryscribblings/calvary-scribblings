// EDGE-2 — THE PROOF, over two REAL builds, on the REAL asset server, against the emulator.
//
//   npm run test:edge:proof     (firebase emulators:exec --only database … this file)
//
// 1. Build A: four stories live. Its guard step runs as the first EDGE-2 deploy would (no ledger).
//    Every address a reader fetches for two of them is served — so the preservation store holds them.
// 2. One is hidden (its record stays), one is deleted outright. Build B, whose guard step reads A's
//    ledger. Then on the same colo, B active:
//      • control: B without the guard answers both from the store, 200 (EDGE-1, reproduced)
//      • with the guard: every one of those addresses answers 404
//      • every live page in B, the one sharing the hidden story's slug as a prefix included, is
//        served by the asset server with NO Function invoked
// 3. Without rebuilding, a scheduled story and the hidden story both go live. Both draw through the
//    404 fallback (NotFoundOrLiveStory → the real /api/story): the unguarded one via the asset
//    server's 404.html, the guarded one via the guard Function's 404.
// 4. The ledger carries: a build after B still guards both (the hidden one recovered from its
//    hash, the deleted one from its address), and a build 8 days later guards neither.
//
// Invented records only. The harness refuses every outside call (tests/unreleased/server.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import '../unreleased/server.mjs';                      // the outside-call refusal + emulator token mint
import { onRequest as storyFn } from '../../functions/api/story.js';
import { onRequest as storiesGuard } from '../../functions/stories/[[path]].js';
import { onRequest as readerGuard } from '../../functions/reader/[[path]].js';
import { _resetGuardForTests, GUARD_MS, ledgerFor, ledgerKey } from '../../app/lib/edgeGuard.mjs';
import { onRequest as bookstoreGuard } from '../../functions/bookstore/[[path]].js';
import { onRequest as seriesGuard } from '../../functions/series/[[path]].js';
import { onRequest as voicesGuard } from '../../functions/voices/[[path]].js';
import { isRoutingRuleMatch } from './vendor/pages-dev-util.mjs';
import { colo, deployment, listen } from './pages-runtime.mjs';
import { generateKeyPairSync } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NS = 'calvary-scribblings-default-rtdb';
const EMU = 'http://127.0.0.1:9000';
const tmp = mkdtempSync(join(tmpdir(), 'edge-proof-'));
/** The fixture's ledger secret. Production's is EDGE_LEDGER_KEY in the Pages project, which no test reads. */
const LEDGER_SECRET = 'edge-proof-fixture-secret-0123456789abcdef';

const STANDING = 'emu-standing-tale';
const GONE = 'emu-gone-tale';                 // hidden after build A — its record stays
const SEQUEL = 'emu-gone-tale-sequel';        // live throughout; shares GONE's slug as a prefix
const DELETED = 'emu-deleted-tale';           // deleted outright after build A
const FRESH = 'emu-fresh-tale';               // scheduled through both builds, then goes live

const para = (n, w) => Array.from({ length: n }, (_, i) => `<p>${w} — paragraph ${i + 1}. ${'The tide came in over the stones and went out again. '.repeat(6)}</p>`).join('');
const story = (title, extra) => ({
  title, author: 'Ada Fixture', authorUid: 'emu-author', category: 'short', categoryName: 'Short Stories',
  date: 'Oct 30, 2026', cover: '', trailerQuote: 'A line from the fixture.', readTime: '4 min read', content: para(14, title), ...extra,
});
function catalogue(stage, now = Date.now()) {
  const future = new Date(now + 7 * 864e5).toISOString();
  const recent = new Date(now - 60e3).toISOString();
  const s = {
    [STANDING]: story('The Standing Tale', { published: true }),
    [SEQUEL]: story('The Gone Tale, Again', { published: true }),
    [GONE]: stage === 'A' || stage === 'relive'
      ? story('The Gone Tale', { published: true, publishAt: recent })
      : story('The Gone Tale', { published: false, hiddenAt: now }),
    [FRESH]: story('The Fresh Tale', stage === 'relive' ? { published: true, publishAt: recent } : { published: false, publishAt: future }),
  };
  if (stage === 'A') s[DELETED] = story('The Deleted Tale', { published: true });
  return {
    cms_stories: s,
    story_bodies: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { content: v.content }])),
    users: { 'emu-author': { displayName: 'Ada Fixture', username: 'adafixture' } },
  };
}
async function seed(data) {
  for (const [node, value] of Object.entries(data)) {
    const r = await fetch(`${EMU}/${node}.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(value) });
    if (!r.ok) throw new Error(`seed ${node}: ${r.status}`);
  }
}

function build(label) {
  execFileSync('npx', ['next', 'build'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], timeout: 900000,
    env: { ...process.env, FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000', NEXT_PUBLIC_FB_EMULATOR: '1' },
  });
  const dir = join(tmp, label);
  cpSync(join(ROOT, 'out'), dir, { recursive: true });
  return dir;
}
/** The build's guard step, exactly as `npm run build` runs it, against the emulator. Returns its log line. */
function guard(dir, { ledgerFrom = null, now = null } = {}) {
  return execFileSync('node', ['scripts/generate-edge-guard.mjs'], {
    cwd: ROOT, encoding: 'utf8',
    env: {
      ...process.env, EDGE_OUT_DIR: dir, EDGE_DB_URL: EMU, EDGE_DB_NS: NS, EDGE_LEDGER_KEY: LEDGER_SECRET,
      ...(ledgerFrom ? { EDGE_LEDGER_URL: pathToFileURL(join(ledgerFrom, '_edge', 'ledger.json')).href } : { EDGE_LEDGER: 'none' }),
      ...(now ? { EDGE_NOW: String(now) } : {}),
    },
  });
}
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const STORY_ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator', FIREBASE_CLIENT_EMAIL: 'harness@emulator.invalid', FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), FIREBASE_DATABASE_URL: EMU };
const FUNCTIONS = [
  { match: (p) => p.startsWith('/stories/'), onRequest: storiesGuard },
  { match: (p) => p.startsWith('/reader/'), onRequest: readerGuard },
  { match: (p) => p.startsWith('/bookstore/'), onRequest: bookstoreGuard },
  { match: (p) => p.startsWith('/series/'), onRequest: seriesGuard },
  { match: (p) => p.startsWith('/voices/'), onRequest: voicesGuard },
  { match: (p) => p === '/api/story', onRequest: storyFn, env: STORY_ENV },
  { match: (p) => p === '/api/hit', onRequest: async () => new Response('{"count":1}', { headers: { 'content-type': 'application/json' } }) },
];

/** Every address a reader's browser fetched while the page was live: the page, its RSC data, its segments. */
function addressesOf(dir, slug) {
  const seg = existsSync(join(dir, 'stories', slug)) ? execFileSync('ls', [join(dir, 'stories', slug)], { encoding: 'utf8' }).split('\n').filter(Boolean) : [];
  return [
    `/stories/${slug}`, `/stories/${slug}?ref=share`, `/stories/${slug}.txt?_rsc=1a2b3`,
    ...seg.map((f) => `/stories/${slug}/${f}`), `/reader/${slug}`,
  ];
}

const OUT = join(ROOT, 'out');
const KEPT = join(tmp, 'out-as-found');
let browser;
before(async () => {
  if (existsSync(OUT)) renameSync(OUT, KEPT);
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  await browser?.close();
  rmSync(OUT, { recursive: true, force: true });
  if (existsSync(KEPT)) renameSync(KEPT, OUT);
  rmSync(tmp, { recursive: true, force: true });
});

async function draw(site, slug) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const res = await page.goto(`${site.url}/stories/${slug}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.story-hero .story-title') || !document.documentElement.hasAttribute('data-story-path'), null, { timeout: 30000 });
  const title = await page.evaluate(() => document.querySelector('.story-hero .story-title')?.innerText.trim() ?? null);
  const paras = title ? await page.waitForFunction(() => document.querySelectorAll('#story-content p').length, null, { timeout: 30000 }).then((h) => h.jsonValue()) : 0;
  await ctx.close();
  return { status: res.status(), title, paras };
}

test('a removed story stops answering at once; live stories never run a Function; a just-live story still reads', { timeout: 2400000 }, async (t) => {
  const H = 'https://calvary.example';
  const now0 = Date.now();

  // ── 1. build A, served live ─────────────────────────────────────────────────────────────
  await seed(catalogue('A', now0));
  const A = build('A');

  await t.test('bootstrap (no ledger anywhere): every story that had a page before UNRELEASED-1 and is not live is seeded', () => {
    const boot = join(tmp, 'A-boot');
    cpSync(A, boot, { recursive: true });
    guard(boot);
    const rules = json(join(boot, '_routes.json')).include;
    assert.ok(rules.includes(`/stories/${FRESH}*`) && rules.includes(`/reader/${FRESH}*`), 'the scheduled story: built before 31 Oct, so seeded until 8 Nov');
    const lapsed = join(tmp, 'A-boot-late');
    cpSync(A, lapsed, { recursive: true });
    guard(lapsed, { now: Date.UTC(2026, 10, 8, 3, 14) });
    assert.deepEqual(json(join(lapsed, '_routes.json')).include, ['/api/*', '/og/*'], 'and the seed lapses on its own at 03:13 UTC on 8 Nov');
    rmSync(boot, { recursive: true, force: true });
    rmSync(lapsed, { recursive: true, force: true });
  });

  // Steady state from here: A's guard step reads a live ledger that guards nothing.
  const prior = join(tmp, 'prior');
  mkdirSync(join(prior, '_edge'), { recursive: true });
  writeFileSync(join(prior, '_edge', 'ledger.json'), JSON.stringify(await ledgerFor({ pages: new Set(), guarded: [], k: await ledgerKey(LEDGER_SECRET), builtAt: now0 })));
  guard(A, { ledgerFrom: prior });
  const c = colo();
  c.activate(deployment(A, { functions: FUNCTIONS }));
  const served = [...addressesOf(A, GONE), ...addressesOf(A, DELETED)];
  assert.ok(served.length >= 10, `segment files exist for the pages (${served.length} addresses)`);
  for (const a of served) assert.equal((await c.fetch(H + a)).status, 200, `served while live: ${a}`);

  // ── 2. build B ──────────────────────────────────────────────────────────────────────────
  await seed(catalogue('B', Date.now()));
  const B = build('B');
  for (const s of [GONE, DELETED]) assert.equal(existsSync(join(B, 'stories', `${s}.html`)), false, `${s} has no page in B`);
  const logB = guard(B, { ledgerFrom: A });
  assert.doesNotMatch(logB, /emu-/, 'the build log names no slug');
  const routes = json(join(B, '_routes.json'));
  const ledger = json(join(B, '_edge', 'ledger.json'));

  await t.test('B\'s _routes.json: the Functions, plus the removed pages — inside Pages\' limits', () => {
    assert.ok(routes.include.length <= 100 && routes.include.every((r) => r.length <= 100 && r.startsWith('/')));
    assert.deepEqual(routes.include.slice(0, 2), ['/api/*', '/og/*']);
    const guardedRules = routes.include.slice(2);
    assert.ok(guardedRules.includes(`/stories/${GONE}`) && guardedRules.includes(`/stories/${GONE}/__next*`), 'GONE shares a prefix with a live page, so its exact forms are listed');
    assert.ok(guardedRules.includes(`/stories/${DELETED}*`) && guardedRules.includes(`/reader/${DELETED}*`));
  });

  await t.test('B\'s ledger names neither removed story — the hidden one nor the deleted one — and every entry is sealed', () => {
    const text = JSON.stringify(ledger);
    assert.doesNotMatch(text.replaceAll(SEQUEL, ''), new RegExp(GONE), 'only inside the live sequel\'s own slug');
    assert.doesNotMatch(text, new RegExp(DELETED));
    assert.doesNotMatch(text, new RegExp(FRESH), 'nor the scheduled one');
    assert.ok(ledger.guarded.every((g) => Object.keys(g).join() === 'c'));
    assert.ok(ledger.pages.includes(`stories/${SEQUEL}`), 'live pages are listed in the clear');
  });

  await t.test('no address of any page B serves matches a guard rule, so no live view can reach a Function', () => {
    const files = execFileSync('find', ['.', '-type', 'f'], { cwd: B, encoding: 'utf8' }).split('\n').filter(Boolean)
      .map((f) => f.slice(1)).filter((f) => /^\/(stories|reader|bookstore|series|voices)\//.test(f));
    const urls = files.flatMap((f) => (f.endsWith('.html') ? [f, f.slice(0, -5)] : [f]));
    const guardRules = routes.include.slice(2);
    const hit = urls.filter((u) => guardRules.some((r) => isRoutingRuleMatch(u, r)));
    assert.deepEqual(hit, []);
    assert.ok(urls.length > 20, `${urls.length} built addresses checked`);
  });

  await t.test('control — B without the guard: the asset server answers every one from the preservation store (EDGE-1)', async () => {
    const bare = deployment(B, { functions: FUNCTIONS, useRoutes: false });
    c.activate(bare);
    for (const a of served) {
      const r = await c.fetch(H + a);
      assert.equal(r.status, 200, a);
      assert.equal(r.headers.get('cache-control'), 'public, s-maxage=604800', a);
    }
  });

  c.activate(deployment(B, { functions: FUNCTIONS }));
  _resetGuardForTests();

  await t.test('with the guard: every address that was served answers 404, and none of the old page', async () => {
    for (const a of [...served, `/stories/${GONE}/`, `/stories/${GONE}.html`]) {
      const r = await c.fetch(H + a);
      const body = await r.text();
      assert.equal(r.status, 404, a);
      assert.doesNotMatch(body, /The Gone Tale —|The Deleted Tale —|paragraph 3\./, `${a}: no story text`);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
  });

  await t.test('live stories are served statically, with no Function — the one sharing the prefix included', async () => {
    c.stats.functionCalls.length = 0;
    for (const s of [STANDING, SEQUEL]) {
      for (const a of addressesOf(B, s)) {
        const r = await c.fetch(H + a);
        assert.equal(r.status, 200, a);
        assert.notEqual(r.headers.get('cache-control'), 'public, s-maxage=604800', `${a}: from the deployment, not the store`);
      }
    }
    assert.deepEqual(c.stats.functionCalls, []);
  });

  // ── 3. two stories go live with no rebuild ──────────────────────────────────────────────
  await seed(catalogue('relive', Date.now()));
  const site = await listen(c);
  try {
    await t.test('a scheduled story that just went live (unguarded) draws through the asset server\'s 404', async () => {
      c.stats.functionCalls.length = 0;
      const r = await draw(site, FRESH);
      assert.equal(r.status, 404);
      assert.equal(r.title, 'The Fresh Tale');
      assert.ok(r.paras >= 10, `${r.paras} paragraphs`);
      assert.ok(!c.stats.functionCalls.includes(`/stories/${FRESH}`), 'its address did not invoke the guard');
      assert.ok(c.stats.functionCalls.includes('/api/story'), 'the fallback asked /api/story');
    });
    await t.test('a guarded story that just went live draws through the guard\'s 404', async () => {
      c.stats.functionCalls.length = 0;
      const r = await draw(site, GONE);
      assert.equal(r.status, 404);
      assert.equal(r.title, 'The Gone Tale');
      assert.ok(r.paras >= 10, `${r.paras} paragraphs`);
      assert.ok(c.stats.functionCalls.includes(`/stories/${GONE}`), 'the guard answered the address');
    });
  } finally { await site.close(); }

  // ── 4. the ledger carries ───────────────────────────────────────────────────────────────
  await seed(catalogue('B', Date.now()));
  const C = join(tmp, 'C');
  cpSync(B, C, { recursive: true });
  await t.test('the build after B still guards both; a build 8 days on guards neither', () => {
    const since = Date.now();
    guard(C, { ledgerFrom: B, now: since + 3 * 864e5 });
    const rules = json(join(C, '_routes.json')).include;
    assert.ok(rules.includes(`/stories/${GONE}`), 'the hidden one, read back from its sealed entry');
    assert.ok(rules.includes(`/stories/${DELETED}*`), 'the deleted one, read back from its sealed entry — no database needed');
    const D = join(tmp, 'D');
    cpSync(C, D, { recursive: true });
    guard(D, { ledgerFrom: C, now: since + GUARD_MS + 864e5 });
    assert.deepEqual(json(join(D, '_routes.json')).include, ['/api/*', '/og/*']);
    rmSync(D, { recursive: true, force: true });
  });
});
