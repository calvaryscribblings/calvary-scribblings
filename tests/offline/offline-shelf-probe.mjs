// W11 — DOES THE WEBSITE KEEP A SAVED STORY READABLE OFFLINE? Proved on the live site.
//
//   node tests/offline/offline-shelf-probe.mjs [--site URL] [--slug SLUG]   (needs serviceAccountKey.json)
//
// Ruling 11 (Ikenna, 26 Sep 2026): unavailableCopy.js keeps "Anything you saved for offline reading
// is still in My Library." only if the website really does this. This walks the reader's path:
// sign in, tap "Save for offline" on a story, visit My Library (which seals the shelf shell into
// the service worker's cache), cut the network, then open the story's own address and the shelf.
//
// The save is IndexedDB in this throwaway browser and nothing else. Signed in as Ikenna, a story
// visit writes to his account, so the Realtime Database socket is proxied and EVERY CLIENT WRITE
// is dropped, /api/hit is aborted, and his records are re-read afterwards and compared (CLAUDE.md,
// "Probes that write to live data").
import { chromium } from '@playwright/test';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const API_KEY = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
const IKENNA = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const WATCH = [`users/${IKENNA}`, `points/${IKENNA}`, `userStreaks/${IKENNA}`, `founder_preview/${IKENNA}`, `library_notifications/${IKENNA}`];
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

const WRITE_ACTIONS = new Set(['p', 'm', 'o', 'om', 'oc', 'on']);
let dropped = 0;
async function firewall(ctx) {
  await ctx.route('**/api/hit**', (r) => r.abort());
  await ctx.routeWebSocket(/firebasedatabase\.app|firebaseio\.com/, (ws) => {
    const server = ws.connectToServer();
    let pending = 0, parts = [];
    const decide = (text) => {
      try { const f = JSON.parse(text); if (f?.t === 'd' && WRITE_ACTIONS.has(f?.d?.a)) { dropped++; return false; } } catch {}
      return true;
    };
    ws.onMessage((m) => {
      const text = typeof m === 'string' ? m : m.toString();
      if (pending === 0 && /^\d+$/.test(text) && Number(text) > 1) { pending = Number(text); parts = []; return; }
      if (pending > 0) {
        parts.push(text); pending--;
        if (pending === 0) { const whole = parts.join(''); if (decide(whole)) { server.send(String(parts.length)); parts.forEach((p) => server.send(p)); } }
        return;
      }
      if (decide(text)) server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
}

const SIGNED_IN = ({ key, user }) => new Promise((resolve) => {
  const open = indexedDB.open('firebaseLocalStorageDb', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
  open.onsuccess = () => {
    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
    tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: user });
    tx.oncomplete = () => resolve();
  };
});

const slug = await pickSlug();
const before = await snapshot();
const tok = await getAuth().createCustomToken(IKENNA);
const account = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok, returnSecureToken: true }) })).json();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await firewall(ctx);
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
await page.goto(SITE + '/terms', { waitUntil: 'domcontentloaded' });
await page.evaluate(SIGNED_IN, { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, user: {
  uid: IKENNA, email: null, emailVerified: true, isAnonymous: false, providerData: [], displayName: 'Ikenna Okpara',
  stsTokenManager: { refreshToken: account.refreshToken, accessToken: account.idToken, expirationTime: Date.now() + 3500e3 },
  createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
} });

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
result.integrity = { dropped, changed: WATCH.filter((p) => before[p] !== after[p]) };
result.liveOpening = liveOpening;
console.log(JSON.stringify(result, null, 2));
process.exit(result.integrity.changed.length ? 2 : 0);
