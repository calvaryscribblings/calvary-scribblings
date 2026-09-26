// W11 — THE LOCKS' WORDS AS DRAWN (not as stored): innerText honours text-transform, so the
// eyebrow reads the way a reader sees it. Signed out, clock set after the 30 Sept switch.
//
//   node tests/typography/lock-words.mjs [--site URL] [--shots DIR]
//
// Serve out/ first (APP_PORT=4337 node tests/reader/app-server.mjs). Screenshots stay local.
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'http://127.0.0.1:4337');
const SHOTS = arg('--shots', null);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const AFTER_SWITCH = new Date('2026-10-01T09:00:00Z');
const LIVE = 'https://calvaryscribblings.co.uk';
// The static server has no Pages Functions, so each endpoint answers as the live one does in that
// state. /api/story: the live body, marked as the preview it becomes after the switch (the lock's
// words come from app/lib/archiveLock.js, not from the response). /api/series/stream: the 401
// functions/api/series/stream.js gives a reader with no token.
const previewStory = (degraded) => async (route) => {
  const res = await fetch(`${LIVE}/api/story`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData() });
  const { content, ...data } = await res.json();
  const preview = String(content || '').split('</p>').slice(0, 3).join('</p>') + '</p>';
  const body = { ...data, access: 'preview', preview, degraded, ...(degraded ? { code: 'entitlement_unavailable', error: 'x' } : {}) };
  await route.fulfill({ status: degraded ? 503 : 200, contentType: 'application/json', body: JSON.stringify(body) });
};
const PAGES = [
  ['story lock', '/stories/trouble-shooting', { '**/api/story': previewStory(false) }],
  ['story lock · degraded', '/stories/trouble-shooting', { '**/api/story': previewStory(true) }],
  ['Series lock · instalment page', '/series/instalment/beta-princess-i2', {}],
  ['Series lock · reader', '/series/read/beta-princess-i2', { '**/api/series/stream**': (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sign in to read this instalment.', code: 'signed_out' }) }) }],
];

const browser = await chromium.launch();
let failed = 0;
for (const [name, path, routes] of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route('**/api/hit**', (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  for (const [pat, fn] of Object.entries(routes)) await ctx.route(pat, fn);
  const page = await ctx.newPage();
  await page.clock.install({ time: AFTER_SWITCH });
  await page.goto(SITE + path, { waitUntil: 'load' });
  const lock = page.locator('[data-archive-lock]');
  try { await lock.waitFor({ state: 'visible', timeout: 25000 }); } catch { console.log(`${name}: NO LOCK DRAWN`); failed++; await ctx.close(); continue; }
  await lock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const lines = (await lock.innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
  console.log(`${name} (${path}):\n  ${lines.join('\n  ')}`);
  if (SHOTS) await lock.screenshot({ path: join(SHOTS, `${name.replace(/[^a-z]+/gi, '-')}.png`) });
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
