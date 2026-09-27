// W19 — RULINGS 47 AND 48, SEEN LIVE.
//
//   node tests/live/w19-deletions.mjs <outDir> [--site URL] [--serve out]   (needs serviceAccountKey.json)
//
// Ruling 48 — a CENSUS, read-only, Admin SDK. Every top-level node is searched for every past
// deletion's uid. What may still name one is only what is kept BY DECISION (the deletion record,
// accounting, safety reports — docs/ACCOUNT-SCRUB-PLAN.md). Anything else is a public surface still
// showing a past deletion differently from a fresh one, and fails the run. Counts only: no uid,
// no path below the node is printed (W12).
//
// Ruling 47 — a BROWSER, as the W17 TEST READER behind tests/live/firewall.mjs (never a founder):
//   · a piece-shaped address with no piece behind it shows exactly "This piece was deleted.", and
//     the 404's ordinary words are never visible;
//   · a live piece still draws itself, and not the line;
//   · a non-piece address still gets the ordinary 404;
//   · the Square draws no deletion line over a live announcement.
// The test reader's own records are read before and after, and must match.
//
// --serve out   serves the local static export instead of the live site (404.html for a miss, as
//               Cloudflare Pages does). The database it reads is still production, read-only.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';
import { ensureTestReader, testReaderSession, signInPage, testReaderWatch } from './test-reader.mjs';
import { installFirewall, newStats, statsLine } from './firewall.mjs';
import { KEPT_NODES } from '../../functions/api/account/_deletion.js';
import { DELETED_PIECE } from '../../app/lib/deletedContent.js';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tests/live/w19-deletions.mjs <outDir> [--site URL] [--serve out]'); process.exit(2); }
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
mkdirSync(OUT, { recursive: true });

let SITE = arg('--site', 'https://calvaryscribblings.co.uk');
let server = null;
const SERVE = arg('--serve', null);
if (SERVE) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon' };
  server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '') || '/index';
    const tries = [join(SERVE, p), join(SERVE, `${p}.html`), join(SERVE, p, 'index.html')];
    const hit = tries.find((f) => existsSync(f) && statSync(f).isFile());
    res.writeHead(hit ? 200 : 404, { 'content-type': TYPES[extname(hit || 'x.html')] || 'application/octet-stream' });
    res.end(readFileSync(hit || join(SERVE, '404.html')));
  });
  await new Promise((r) => server.listen(0, r));
  SITE = `http://localhost:${server.address().port}`;
}

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
let failed = 0;
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failed++; };

// ── Ruling 48: the census ─────────────────────────────────────────────────────────────────
{
  const deleted = Object.keys((await adb.ref('deletions').get()).val() || {});
  const top = Object.keys((await adb.ref('/').get({ shallow: true })).val() || {});
  // Kept by decision: KEPT_NODES (accounting, the record itself); safety reports and rate-limit
  // windows (docs/ACCOUNT-SCRUB-PLAN.md, "What it keeps"); and the Paystack code → uid index, which
  // is billing's own lookup for memberships. The last two are .read:false — no reader sees them.
  const KEPT = new Set([...Object.keys(KEPT_NODES), 'content_reports', 'reports', 'rate_limits', 'paystack_membership_index']);
  const found = {};
  for (const node of top) {
    const json = JSON.stringify((await adb.ref(node).get()).val());
    const n = deleted.reduce((a, u) => a + (json.split(u).length - 1), 0);
    if (n) found[node] = n;
  }
  const outside = Object.entries(found).filter(([n]) => !KEPT.has(n));
  console.log(`[48] ${deleted.length} past deletions · ${top.length} top-level nodes searched · mentions in kept-by-decision nodes: ${JSON.stringify(Object.fromEntries(Object.entries(found).filter(([n]) => KEPT.has(n))))}`);
  expect(outside.length === 0, `[48] no node outside the kept-by-decision set names a past deletion (${outside.length ? outside.map(([n, c]) => `${n}:${c}`).join(', ') : 'none'})`);
}

// ── Ruling 47: the browser, as the test reader ───────────────────────────────────────────
const pieces = (await adb.ref('open_pages').get()).val() || {};
const liveId = Object.keys(pieces).find((k) => pieces[k]?.status === 'live');
let missing;
do { missing = `-Ow19${Math.random().toString(36).slice(2).padEnd(15, 'x').slice(0, 15)}`; } while (pieces[missing]);

const READER = await ensureTestReader();
const WATCH = testReaderWatch(READER);
const snapshot = async () => Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));
const before = await snapshot();
const account = await testReaderSession(READER);
const stats = newStats();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await installFirewall(ctx, { site: SITE, stats });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ } });
await signInPage(page, SITE, account);

const visibleText = () => page.evaluate(() => document.body.innerText);
{
  await page.goto(`${SITE}/open-pages/${missing}`, { waitUntil: 'load' });
  const firstPaintHidden = await page.evaluate(() => document.documentElement.hasAttribute('data-piece-path') || !!document.querySelector('[data-piece-deleted]'));
  await page.waitForSelector('[data-piece-deleted]', { timeout: 20000 }).catch(() => {});
  const line = await page.locator('[data-piece-deleted]').first().innerText().catch(() => null);
  const body = await visibleText();
  await page.screenshot({ path: join(OUT, 'w19-deleted-piece.png'), fullPage: true });
  expect(line === DELETED_PIECE, `[47] a deleted piece's address shows exactly "${DELETED_PIECE}" (got ${JSON.stringify(line)})`);
  expect(!/nothing at this address/i.test(body), '[47] the 404\'s ordinary words are not on screen');
  expect(firstPaintHidden, '[47] the ordinary words were held back from the first paint');
  expect(await page.locator('[data-piece-deleted] a').count() === 0, '[47] the line carries no link');
}
if (liveId) {
  await page.goto(`${SITE}/open-pages/${liveId}`, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const body = await visibleText();
  expect(!body.includes(DELETED_PIECE) && body.includes(String(pieces[liveId].title || '').trim().slice(0, 12)), '[47] a live piece still draws itself');
}
{
  await page.goto(`${SITE}/open-pages/not-a-piece`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const body = await visibleText();
  expect(/nothing at this address/i.test(body) && !body.includes(DELETED_PIECE), '[47] a non-piece address keeps the ordinary 404');
}
{
  await page.goto(`${SITE}/square`, { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  expect(!(await visibleText()).includes(DELETED_PIECE), '[47] the Square shows no deletion line (no announced piece is deleted today)');
}

await browser.close();
if (server) server.close();
const after = await snapshot();
const changed = WATCH.filter((p) => before[p] !== after[p]).length;
console.log(`[firewall] ${statsLine(stats)}`);
expect(changed === 0, `test reader's ${WATCH.length} records unchanged (${changed} changed)`);
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
