// W18 — RULING 42, IN A BROWSER: on a slow but live connection My Library shows its saved copy
// after 3 seconds, and when the network answers the copy is refreshed and the page is told.
//
//   node tests/offline/slow-shelf.mjs [--site URL]      (default: a local `next build`, served on 4360)
//
// Chromium, the real service worker (public/sw.js), signed out (nothing to write). Steps:
//   1. Visit /my-library until the worker controls the page and holds the shelf document.
//   2. Hold every network request for /my-library for HOLD_MS (the worker's own fetch included —
//      a context route sees it in Chromium) — a slow connection, not a dead one.
//   3. Open /my-library: the saved copy must paint at ~3s, well before the network answers.
//   4. When the network answers: CS_SHELL_REFRESHED must reach the page.
//   5. With /build.json naming a NEWER build and the reader at the top, that message must reload
//      the page (W16's build check). With the same build it must not.
import { chromium } from '@playwright/test';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'http://127.0.0.1:4360');
const HOLD_MS = 9000;

let failed = 0;
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const browser = await chromium.launch();
async function trial({ liveBuild }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // service workers ALLOWED
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__msgs = [];
    try { navigator.serviceWorker?.addEventListener('message', (e) => window.__msgs.push({ type: e.data?.type, t: performance.now() })); } catch { /* none */ }
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ }
  });
  // 1. The worker, controlling, with the shelf sealed.
  await page.goto(`${SITE}/my-library`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'load' });
  const sealed = await page.waitForFunction(async () => {
    const keys = await caches.keys();
    for (const k of keys) { const c = await caches.open(k); if (await c.match('/my-library', { ignoreSearch: true })) return true; }
    return false;
  }, null, { timeout: 30000, polling: 500 }).then(() => true).catch(() => false);
  expect(sealed, 'the worker controls the page and holds the saved My Library');

  // 2. A slow connection for the shelf document; /build.json answers at once with `liveBuild`.
  let held = 0;
  await ctx.route((u) => new URL(u).pathname === '/my-library', async (route) => { held++; await new Promise((r) => setTimeout(r, HOLD_MS)); await route.continue(); });
  if (liveBuild) await ctx.route('**/build.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commit: liveBuild }) }));

  // 3. Open it.
  const t0 = Date.now();
  await page.goto(`${SITE}/my-library`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const painted = Date.now() - t0;
  await page.evaluate(() => { window.__marker = 1; });
  // 4. Wait for the network to answer.
  await page.waitForTimeout(HOLD_MS + 3000);
  const msgs = await page.evaluate(() => window.__msgs || []).catch(() => []);
  const reloaded = await page.evaluate(() => window.__marker !== 1).catch(() => true);
  await ctx.close();
  return { painted, held, msgs: msgs.map((m) => m.type), reloaded };
}

const same = await trial({ liveBuild: null });
expect(same.held > 0, `the shelf document was held (${same.held} request(s) for ${HOLD_MS / 1000}s)`);
expect(same.painted >= 2500 && same.painted < 6000, `the saved copy painted at ${(same.painted / 1000).toFixed(1)}s — the 3s rule, not the ${HOLD_MS / 1000}s network`);
// CS_OFFLINE is broadcast at the moment the worker falls back, before the page it serves exists as a
// client, so that page never hears it — exactly as before W16. A slow load raises no offline banner.
expect(same.msgs.includes('CS_SHELL_REFRESHED'), 'when the network answered, the page was told (CS_SHELL_REFRESHED)');
expect(!same.reloaded, 'same build live: no reload');

const newer = await trial({ liveBuild: 'ffffffffffff' });
expect(newer.msgs.includes('CS_SHELL_REFRESHED') || newer.reloaded, 'newer build live: the page heard the network answer');
expect(newer.reloaded, 'newer build live, reader at the top: the page reloaded onto it (W16\'s build check)');
await browser.close();
console.log(failed ? `\nFAIL: ${failed}` : '\nPASS');
process.exit(failed ? 1 : 0);
