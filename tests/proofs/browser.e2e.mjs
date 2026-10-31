// PROOFS — two real static builds and a real browser, against the emulators (auth 9099, db 9410).
//
//   npm run test:proofs:browser   (two next builds; ~10 minutes)
//
//   1. THE LIVE STORY PAGE DOES NOT CHANGE. The site is built twice from the same emulator
//      catalogue: once with app/stories/[slug]/page-client.js as on origin/main, once as on this
//      branch. Every live story page's HTML is hashed, with only the build's own chunk names and
//      build id normalised (they differ whenever any source changes). Hashes only; no text printed.
//   2. THE SHELL CARRIES NO STORY DATA: out/proofs.html names no slug and no title.
//   3. IN A BROWSER, signed in as an invented WRITER (never a founder): the list holds exactly their
//      own scheduled stories; a proof draws the story page's hero, byline and prose with the London
//      go-live time; nothing is counted (/api/hit, /api/story are never called); a report goes
//      through, shows as Received, and mails the editors once; closing the switch empties the list.
//   4. ALIGNMENT at 390 and 1280 wide: one left edge, no sideways scroll, 44px targets. The
//      screenshots stay on this machine (PROOFS_SHOTS, default a temp folder).
//
// Invented records only. The server below answers /api/proofs* with the real Functions; Google and
// Resend are stood in for, and anything else outbound is refused. The browser's database socket
// (the client hard-codes :9000, which may be another session's emulator) is blocked, never served.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { extname, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9410';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NS = 'calvary-scribblings-default-rtdb';
const EMU = `http://${DB_HOST}`;
const SHOTS = process.env.PROOFS_SHOTS || mkdtempSync(join(tmpdir(), 'proofs-shots-'));
const tmp = mkdtempSync(join(tmpdir(), 'proofs-build-'));
const realFetch = globalThis.fetch;

// ── the catalogue ───────────────────────────────────────────────────────────────────────
const NOW = Date.now();
const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();
const para = (n, tag) => Array.from({ length: n }, (_, i) => `<p>${tag} paragraph ${i + 1}. ${'The tide came in over the stones and went out again. '.repeat(5)}</p>`).join('');
const WRITER = 'proofs-browser-writer';
const OTHER = 'proofs-browser-other';
const story = (title, uid, extra) => ({ title, author: 'Invented Writer', authorUid: uid, category: 'short', categoryName: 'Short Stories', date: 'Nov 1, 2026', cover: '', readTime: '4 min read', ...extra });
const LIVE = {
  'pf-live-fresh':   story('A Fresh Invented Tale', OTHER, { published: true, publishAt: iso(NOW - 3600e3), content: para(12, 'fresh') }),
  'pf-live-archive': story('An Archived Invented Tale', OTHER, { published: true, publishAt: iso(NOW - 60 * DAY), content: para(12, 'archive'), subcategory: 'Literary' }),
  'pf-live-verse':   story('An Invented Poem', OTHER, { published: true, category: 'poetry', categoryName: 'Poetry', content: para(6, 'verse') }),
  'pf-live-plain':   story('A Plain Invented Tale', WRITER, { published: true, content: para(8, 'plain') }),
};
const SCHED = {
  'pf-proof-soon':  story('The Soon Proof', WRITER, { published: false, publishAt: iso(NOW + 2 * DAY) }),
  'pf-proof-later': story('The Later Proof', WRITER, { published: false, publishAt: iso(NOW + 9 * DAY) }),
  'pf-proof-other': story('Somebody Else’s Proof', OTHER, { published: false, publishAt: iso(NOW + 3 * DAY) }),
};
const BODY = (slug) => ({ content: para(10, `body-of-${slug}`) });

async function put(path, value) {
  const r = await realFetch(`${EMU}/${path}.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`seed ${path}: ${r.status}`);
}
async function read(path) { return (await realFetch(`${EMU}/${path}.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } })).json(); }
async function seed() {
  await put('', null);
  await put('cms_stories', { ...LIVE, ...SCHED });
  await put('story_bodies', Object.fromEntries([...Object.keys(LIVE), ...Object.keys(SCHED)].map((s) => [s, LIVE[s] ? { content: LIVE[s].content } : BODY(s)])));
  await put('users', { [WRITER]: { displayName: 'Invented Writer', username: 'inventedwriter' }, [OTHER]: { displayName: 'Invented Writer', username: 'invented' } });
  await put('proofs_access', { open: true, changedAt: NOW, changedBy: 'stand-in' });
}

// ── builds ──────────────────────────────────────────────────────────────────────────────
const CLIENT = 'app/stories/[slug]/page-client.js';
function build(label) {
  execFileSync('npx', ['next', 'build'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], timeout: 1_200_000,
    env: { ...process.env, FIREBASE_DATABASE_EMULATOR_HOST: DB_HOST, NEXT_PUBLIC_FB_EMULATOR: '1' },
  });
  const dir = join(tmp, label);
  cpSync(join(ROOT, 'out'), dir, { recursive: true });
  return { dir, buildId: readFileSync(join(ROOT, '.next', 'BUILD_ID'), 'utf8').trim() };
}
const normalise = (html, buildId) => html
  .split(buildId).join('BUILD_ID')
  .replace(/\/_next\/static\/[A-Za-z0-9_./~-]+/g, '/_next/static/X')
  .replace(/static\/chunks\/[A-Za-z0-9_./~-]+/g, 'static/chunks/X');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

// ── the server: the build, plus the real /api/proofs Functions ─────────────────────────
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator-key', FIREBASE_CLIENT_EMAIL: 'svc@emulator.invalid', FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: EMU, RESEND_API_KEY: 'x', FROM_EMAIL: 'alerts@example.test', LAUNCH_ALERT_EMAIL: 'editors@example.test',
};
const mails = [];
const apiCalls = [];
function installFetch() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { status: 200 });
    if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup')) {
      return realFetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=emulator-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: init.body });
    }
    if (url === 'https://api.resend.com/emails') { mails.push(JSON.parse(init.body)); return new Response('{"id":"e"}', { status: 200 }); }
    if (url.startsWith(EMU)) {
      const u = new URL(url); u.searchParams.set('ns', NS);
      const { signal, ...rest } = init;
      return realFetch(u.toString(), { ...rest, headers: { ...(init.headers || {}), Authorization: 'Bearer owner' } });
    }
    throw new Error(`proofs browser harness: refused ${new URL(url).host}`);
  };
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serve(out) {
  return new Promise(async (resolve) => {
    const { handleProofs } = await import('../../functions/api/proofs/index.js');
    const { handleReport } = await import('../../functions/api/proofs/report.js');
    const srv = createServer(async (req, res) => {
      const path = (req.url || '/').split('?')[0];
      if (path.startsWith('/api/')) {
        apiCalls.push(path);
        const chunks = []; for await (const c of req) chunks.push(c);
        const handler = path === '/api/proofs' ? handleProofs : path === '/api/proofs/report' ? handleReport : null;
        if (!handler) { res.writeHead(404, { 'content-type': 'application/json' }).end('{}'); return; }
        const pending = [];
        const r = await handler({ request: new Request(`http://harness${path}`, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: Buffer.concat(chunks) }), env: ENV, waitUntil: (p) => pending.push(p) });
        await Promise.allSettled(pending);
        res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      const clean = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
      const base = join(out, clean);
      const cands = extname(base) ? [base] : [join(base, 'index.html'), `${base.replace(/\/$/, '')}.html`];
      const file = cands.find((c) => c.startsWith(out) && existsSync(c) && !readdirSafe(c));
      if (!file) { res.writeHead(404, { 'content-type': 'text/html' }).end(readFileSync(join(out, '404.html'))); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }));
  });
}
function readdirSafe(p) { try { readdirSync(p); return true; } catch { return false; } }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const customToken = (uid) => { const now = Math.floor(Date.now() / 1000); return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, uid, iat: now, exp: now + 3600, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iss: 'emulator', firebase: { sign_in_provider: 'custom' } })}.`; };

// ── the run ─────────────────────────────────────────────────────────────────────────────
const OUT = join(ROOT, 'out');
const KEPT = join(tmp, 'out-as-found');
let after_, before_, site, browser;
before(async () => {
  if (existsSync(OUT)) renameSync(OUT, KEPT);
  mkdirSync(SHOTS, { recursive: true });
  await seed();
  after_ = build('after');
  // BEFORE: the same tree with only the story page's client as on origin/main. Copied aside and
  // back (never git stash: CLAUDE.md), and restored whatever happens.
  const mine = readFileSync(join(ROOT, CLIENT));
  try {
    writeFileSync(join(ROOT, CLIENT), execFileSync('git', ['show', `origin/main:${CLIENT}`], { cwd: ROOT }));
    before_ = build('before');
  } finally { writeFileSync(join(ROOT, CLIENT), mine); }
  installFetch();
  site = await serve(after_.dir);
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  await browser?.close();
  await site?.close();
  globalThis.fetch = realFetch;
  rmSync(OUT, { recursive: true, force: true });
  if (existsSync(KEPT)) renameSync(KEPT, OUT);
  rmSync(tmp, { recursive: true, force: true });
});

test('the live story page is unchanged: same HTML, by hash, for every live story', () => {
  const rows = Object.keys(LIVE).map((slug) => {
    const a = normalise(readFileSync(join(after_.dir, 'stories', `${slug}.html`), 'utf8'), after_.buildId);
    const b = normalise(readFileSync(join(before_.dir, 'stories', `${slug}.html`), 'utf8'), before_.buildId);
    return { slug, before: sha(b), after: sha(a), bytes: a.length };
  });
  console.log('[parity]', JSON.stringify(rows));
  for (const r of rows) assert.equal(r.after, r.before, `${r.slug}: the built page changed`);
  for (const s of Object.keys(SCHED)) assert.ok(!existsSync(join(after_.dir, 'stories', `${s}.html`)), `${s}: a scheduled story has no page`);
});

test('the /proofs shell carries no story data', () => {
  const html = readFileSync(join(after_.dir, 'proofs.html'), 'utf8');
  for (const [slug, rec] of Object.entries({ ...SCHED, ...LIVE })) {
    assert.ok(!html.includes(slug), `shell names ${slug}`);
    assert.ok(!html.includes(rec.title), 'shell carries a title');
  }
  assert.ok(!html.includes('body-of-'), 'shell carries text');
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
});

async function open(viewport, { signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* */ } });
  // The client's database and storage are hard-wired to :9000/:9199 in emulator builds, which may be
  // ANOTHER session's emulators. Nothing here may reach them: the page refuses to open a socket to
  // either port, and the HTTP fallback (long-polling) is aborted. (A CDP blocked-URL list was tried
  // first and did NOT stop the socket; this does.)
  await ctx.addInitScript(() => {
    const Native = window.WebSocket;
    const refused = /\/\/(127\.0\.0\.1|localhost):(9000|9199)\b/;
    window.WebSocket = function WebSocket(url, protocols) {
      if (refused.test(String(url))) throw new DOMException('refused by the proofs harness', 'SecurityError');
      return protocols === undefined ? new Native(url) : new Native(url, protocols);
    };
    window.WebSocket.prototype = Native.prototype;
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  });
  await ctx.route(/\/\/(127\.0\.0\.1|localhost):(9000|9199)\//, (r) => r.abort());
  const page = await ctx.newPage();
  const strays = [];
  page.on('websocket', (ws) => { if (/:(9000|9199)\b/.test(ws.url())) strays.push(ws.url()); });
  page.on('requestfinished', (r) => { if (/:(9000|9199)\//.test(r.url())) strays.push(r.url()); });
  page.strays = strays;
  const calls = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push(u.pathname); });
  await page.goto(`${site.url}/proofs`);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 60000 });
  if (signedIn) await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), customToken(WRITER));
  return { ctx, page, calls };
}

/** One left edge, no sideways scroll, 44px targets. */
async function alignment(page, selectors) {
  return page.evaluate((sels) => {
    const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, lefts: {}, small: [] };
    for (const s of sels) { const el = document.querySelector(s); if (el) out.lefts[s] = Math.round(el.getBoundingClientRect().left); }
    for (const b of document.querySelectorAll('.pf-page button, .pf-band button, .pf-sheet button')) {
      const r = b.getBoundingClientRect(); if (r.width && r.height < 43.5) out.small.push(b.textContent.trim().slice(0, 30));
    }
    return out;
  }, selectors);
}

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  test(`${name}: a writer sees their own proofs, opens one, reports, and nothing is counted`, async () => {
    await seed();
    const { ctx, page, calls } = await open(viewport);
    await page.waitForSelector('.pf-card', { timeout: 30000 });
    const titles = await page.$$eval('.pf-card .pf-title', (els) => els.map((e) => e.textContent));
    assert.deepEqual(titles, [SCHED['pf-proof-soon'].title, SCHED['pf-proof-later'].title]);
    const list = await alignment(page, ['.pf-mast', '.pf-h1', '.pf-intro', '.pf-list']);
    assert.ok(list.overflow <= 0, `${name}: list scrolls sideways by ${list.overflow}px`);
    assert.equal(new Set(Object.values(list.lefts)).size, 1, `${name}: list left edges ${JSON.stringify(list.lefts)}`);
    assert.deepEqual(list.small, []);
    await page.screenshot({ path: join(SHOTS, `${name}-list.png`), fullPage: true });

    await page.click('.pf-card');
    await page.waitForSelector('.story-hero .story-title', { timeout: 30000 });
    await page.waitForFunction(() => (document.querySelector('#story-content')?.innerText || '').includes('paragraph 10'), null, { timeout: 30000 });
    assert.equal(await page.textContent('.story-hero .story-title'), SCHED['pf-proof-soon'].title);
    assert.match(await page.textContent('.pf-band-when'), /^Goes live .+ at \d\d:\d\d, London time$/);
    assert.ok(page.url().endsWith('/proofs?story=pf-proof-soon'));
    for (const absent of ['.nli-section', '.hit-counter-row', '#quiz-card']) assert.equal(await page.$(absent), null, `${absent} drawn in a proof`);
    await page.waitForTimeout(13000);   // past the read counter's 12s dwell gate
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(800);
    assert.deepEqual(calls.filter((c) => c !== '/api/proofs' && c !== '/api/proofs/report'), [], 'a proof called a counting or reading endpoint');
    const band = await alignment(page, ['.story-hero .story-title', '.pf-band-label', '.pf-band-when']);
    assert.equal(new Set(Object.values(band.lefts)).size, 1, `${name}: the band does not start where the title does ${JSON.stringify(band.lefts)}`);
    assert.ok(band.overflow <= 0, `${name}: proof scrolls sideways by ${band.overflow}px`);
    assert.deepEqual(band.small, []);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `${name}-proof.png`) });

    await page.click('.pf-band .pf-btn');
    await page.fill('#pf-report-text', 'The second paragraph is missing its italics.');
    await page.screenshot({ path: join(SHOTS, `${name}-report.png`) });
    await page.click('.pf-sheet .pf-btn');
    await page.waitForSelector('.pf-ok', { timeout: 15000 });
    await page.waitForSelector('.pf-report-status', { timeout: 15000 });
    assert.equal(await page.textContent('.pf-report-status'), 'Received');
    const sheet = await alignment(page, ['.pf-sheet h2', '.pf-sheet p', '.pf-text']);
    assert.equal(new Set(Object.values(sheet.lefts)).size, 1, `${name}: sheet left edges ${JSON.stringify(sheet.lefts)}`);
    assert.deepEqual(sheet.small, []);
    await page.screenshot({ path: join(SHOTS, `${name}-reported.png`) });
    const reports = Object.values(await read('story_proof_reports') || {});
    assert.equal(reports.length, 1);
    assert.equal(reports[0].reporterUid, WRITER);
    assert.deepEqual(page.strays, [], 'the browser reached another emulator on :9000/:9199');
    await ctx.close();
  });
}

test('the editors were mailed once per report, without the writer’s words', () => {
  assert.equal(mails.length, 2, 'one per report, two viewports');
  for (const m of mails) assert.ok(!m.text.includes('italics'));
});

test('closed to writers: the writer sees the empty state, and another writer’s proof never appears', async () => {
  await seed();
  await put('proofs_access', { open: false, changedAt: NOW, changedBy: 'stand-in' });
  const { ctx, page } = await open({ width: 390, height: 844 });
  await page.waitForSelector('.pf-note', { timeout: 30000 });
  assert.equal(await page.$('.pf-card'), null);
  await page.screenshot({ path: join(SHOTS, 'phone-empty.png'), fullPage: true });
  await page.goto(`${site.url}/proofs?story=pf-proof-other`);
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__?.(t), customToken(WRITER));
  await page.waitForSelector('.pf-note', { timeout: 30000 });
  assert.equal(await page.$('.story-hero'), null);
  await ctx.close();
});

test('signed out: the sign-in prompt and nothing else', async () => {
  const { ctx, page } = await open({ width: 390, height: 844 }, { signedIn: false });
  await page.waitForSelector('.pf-page .pf-btn', { timeout: 30000 });
  assert.equal(await page.$('.pf-card'), null);
  await page.screenshot({ path: join(SHOTS, 'phone-signed-out.png') });
  await ctx.close();
  console.log(`[shots] ${SHOTS}`);
});
