// W11 — DOES THE WEBSITE KEEP A SAVED STORY READABLE OFFLINE? Proved on the live site.
//
//   node tests/offline/offline-shelf-probe.mjs [--site URL] [--slug SLUG]   (needs serviceAccountKey.json)
//
// Ruling 11 (Ikenna, 26 Sep 2026): unavailableCopy.js keeps "Anything you saved for offline reading
// is still in My Library." only if the website really does this. This walks the reader's path:
// sign in, tap "Save for offline" on a story, visit My Library (which seals the shelf shell into
// the service worker's cache), cut the network, then open the story's own address and the shelf.
//
// The save is IndexedDB in this throwaway browser and nothing else. W17: signed in as the TEST
// READER (never a founder), behind tests/live/firewall.mjs — socket writes dropped, long-polling
// and every non-GET refused — and the test reader's records are re-read afterwards and compared
// (CLAUDE.md, "Probes that write to live data").
//
// The one harness that keeps the SERVICE WORKER (it is what is being tested). A context route
// cannot see a request the worker answers itself. The worker answers only GETs of its own origin
// (public/sw.js: every non-GET and every database host is passed through untouched), so every
// write path still reaches the firewall — and the run fails unless the firewall saw requests.
import { chromium } from '@playwright/test';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { ensureTestReader, testReaderSession, signInPage, testReaderWatch } from '../live/test-reader.mjs';
import { installFirewall, newStats, statsLine } from '../live/firewall.mjs';
import { readFileSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const READER = await ensureTestReader();
const WATCH = testReaderWatch(READER);
const snapshot = async () => Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));

// A story from this week is open to everyone, founder preview or not, so the save holds the whole text.
async function pickSlug() {
  const given = arg('--slug', null);
  if (given) return given;
  const idx = (await adb.ref('cms_stories_index').get()).val() || {};
  const rows = Object.entries(idx).filter(([, r]) => r && r.published !== false && r.category !== 'news')
    .sort((a, b) => (b[1].publishedAtMs || b[1].createdAt || 0) - (a[1].publishedAtMs || a[1].createdAt || 0));
  return rows[0][0];
}

const slug = await pickSlug();
const before = await snapshot();
const account = await testReaderSession(READER);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const fw = await installFirewall(ctx, { site: SITE, stats: newStats() });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
await signInPage(page, SITE, account);

const result = { site: SITE, slug };
await page.goto(`${SITE}/stories/${slug}`, { waitUntil: 'networkidle' });
const save = page.getByRole('button', { name: /save for offline/i });
await save.waitFor({ timeout: 20000 });
await save.click();
await page.getByText('Saved to My Library').waitFor({ timeout: 15000 });
const liveOpening = (await page.locator('.prose p').first().innerText()).trim().slice(0, 80);
result.saved = true;

// My Library seals the shelf shell (both shelf documents + their chunks) into the worker's cache.
const sealed = page.waitForEvent('console', { timeout: 1 }).catch(() => null);
await page.goto(`${SITE}/my-library`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });
await page.waitForFunction(async () => {
  const keys = await caches.keys();
  for (const k of keys) { const c = await caches.open(k); if (await c.match('/my-library/read', { ignoreSearch: true })) return true; }
  return false;
}, null, { timeout: 30000, polling: 500 });
void sealed;
result.shellCached = true;

await ctx.setOffline(true);
// 1. The story's own address, offline: the worker should hand it to the shelf reader.
await page.goto(`${SITE}/stories/${slug}`).catch((e) => { result.storyNavError = e.message; });
await page.waitForTimeout(4000);
result.offlineStoryURL = page.url();
result.offlineStoryText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
result.offlineStoryHasOpening = result.offlineStoryText.includes(liveOpening.replace(/\s+/g, ' ').slice(0, 40));
// 2. The shelf itself, offline.
await page.goto(`${SITE}/my-library`).catch((e) => { result.shelfNavError = e.message; });
await page.waitForTimeout(3000);
result.offlineShelfText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
// 3. An UNSAVED page, offline, for contrast: the house offline page.
await page.goto(`${SITE}/search`).catch(() => {});
await page.waitForTimeout(2000);
result.offlineOtherText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
await ctx.setOffline(false);
await browser.close();

const after = await snapshot();
result.integrity = { firewall: statsLine(fw), firewallSawThePage: fw.requestsSeen > 0, changed: WATCH.filter((p) => before[p] !== after[p]).map((p) => p.replace(READER, '{test reader}')) };
result.liveOpening = liveOpening;
console.log(JSON.stringify(result, null, 2));
process.exit(result.integrity.changed.length || !result.integrity.firewallSawThePage ? 2 : 0);
