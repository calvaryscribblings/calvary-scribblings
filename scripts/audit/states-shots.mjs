// W2 — FORCED-FAILURE SCREENSHOTS OF THE LIVE SITE, for the designed-states proof.
//
//   node scripts/audit/states-shots.mjs <outDir> [--only a,b]   (needs serviceAccountKey.json)
//
// For each surface, at 390 and 1180: the page with the Realtime Database UNREACHABLE (every HTTP
// request to it aborted and every WebSocket dead on arrival — what a dead or blocked database
// looks like to the SDK: reads that never answer), captured 16s in, past the 12s read deadline.
// Plus: the 404, offline navigation, and "rendered content stays" (load, then cut the database).
//
// Signed-in surfaces use a THROWAWAY account this script creates and deletes itself: a scratch uid
// (never a reader, never a founder), a name and handle so the completion dialog stays away, signed
// in through a custom token. Everything it wrote is removed at the end and re-read to prove it.
import { chromium } from '@playwright/test';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SITE = process.env.SITE || 'https://calvaryscribblings.co.uk';
const API_KEY = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
const OUT = process.argv[2];
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });

const svc = JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'));
initializeApp({ credential: cert(svc), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const aauth = getAuth();

const DEAD_SOCKET = () => {
  class DeadSocket { constructor(u) { this.url = String(u); this.readyState = 0; } send() {} close() {} addEventListener() {} removeEventListener() {} }
  DeadSocket.CONNECTING = 0; DeadSocket.OPEN = 1; DeadSocket.CLOSING = 2; DeadSocket.CLOSED = 3;
  window.WebSocket = DeadSocket;
};
const SEED = () => {
  try {
    localStorage.setItem('cs_cookie_consent', 'accepted');
    localStorage.setItem('cs_bookstore_gate_v1', '1');
  } catch {}
};
const SQUARE_OPEN = new Date('2026-09-24T19:30:00Z'); // 20:30 London

async function throwaway() {
  const uid = `w2shots${Date.now()}`;
  for (const p of [`users/${uid}`, `usernames/${uid}`]) if ((await adb.ref(p).once('value')).exists()) throw new Error(`${p} exists`);
  await adb.ref().update({ [`users/${uid}`]: { displayName: 'W2 Probe', username: uid, handle: uid, handleLowercased: uid, ageConfirmed: true, createdAt: Date.now() }, [`usernames/${uid}`]: uid });
  const tok = await aauth.createCustomToken(uid);
  const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok, returnSecureToken: true }) })).json();
  return { uid, idToken: r.idToken, refreshToken: r.refreshToken };
}
async function cleanup(uid) {
  await adb.ref().update({ [`users/${uid}`]: null, [`usernames/${uid}`]: null, [`user_search/${uid}`]: null, [`users_private/${uid}`]: null, [`presence/${uid}`]: null, [`userStreaks/${uid}`]: null, [`leaderboard/${uid}`]: null });
  try { await aauth.deleteUser(uid); } catch {}
  const left = [];
  for (const p of [`users/${uid}`, `usernames/${uid}`, `user_search/${uid}`, `users_private/${uid}`]) if ((await adb.ref(p).once('value')).exists()) left.push(p);
  let authGone = false; try { await aauth.getUser(uid); } catch { authGone = true; }
  return { left, authGone };
}
// Firebase's own persistence record, so the page boots signed in (the SDK refreshes the token itself).
const SIGNED_IN = ({ key, user }) => new Promise((resolve) => {
  const open = indexedDB.open('firebaseLocalStorageDb', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
  open.onsuccess = () => {
    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
    tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: user });
    tx.oncomplete = () => resolve();
  };
});

async function shoot(browser, s, width, account) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(SEED);
  if (s.clock) await page.clock.setFixedTime(s.clock);
  if (account) {
    await page.goto(SITE + '/terms', { waitUntil: 'domcontentloaded' });
    await page.evaluate(SIGNED_IN, { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, user: {
      uid: account.uid, email: null, emailVerified: false, isAnonymous: false, providerData: [], displayName: 'W2 Probe',
      stsTokenManager: { refreshToken: account.refreshToken, accessToken: account.idToken, expirationTime: Date.now() + 3500e3 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]' } });
  }
  if (s.mode === 'unreachable') {
    await page.addInitScript(DEAD_SOCKET);
    await page.route(/firebasedatabase\.app|firebaseio\.com/, (r) => r.abort());
  }
  if (s.mode === 'stays') {
    await page.goto(SITE + s.path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(OUT, `${s.id}-${width}-loaded.png`) });
    await ctx.setOffline(true);
    await page.waitForTimeout(150000); // well past the app's ~2 minute replacement
    await page.screenshot({ path: join(OUT, `${s.id}-${width}.png`) });
    await ctx.close();
    return;
  }
  if (s.mode === 'offline-nav') {
    await page.goto(SITE + '/public-library', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000); // let a service worker register, if the site has one
    await ctx.setOffline(true);
    await page.goto(SITE + s.path, { timeout: 20000 }).catch((e) => console.log(`  ${s.id} ${width}: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${s.id}-${width}.png`) }).catch(() => {});
    await ctx.close();
    return;
  }
  await page.goto(SITE + s.path, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  if (s.then) await s.then(page).catch(() => {});
  await page.waitForTimeout(s.wait ?? 16000);
  await page.screenshot({ path: join(OUT, `${s.id}-${width}.png`) });
  const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
  console.log(`  ${s.id} ${width}: ${text}`);
  await ctx.close();
}

const SURFACES = [
  { id: 'home', path: '/public-library', mode: 'unreachable' },
  { id: 'search', path: '/search', mode: 'unreachable' },
  { id: 'short', path: '/short', mode: 'unreachable' },
  { id: 'poetry', path: '/poetry', mode: 'unreachable' },
  { id: 'series', path: '/series', mode: 'unreachable' },
  { id: 'series-detail', path: '/series/beta-princess', mode: 'unreachable' },
  { id: 'bookstore', path: '/bookstore', mode: 'unreachable' },
  { id: 'bookstore-detail', path: '/bookstore/after-the-fact', mode: 'unreachable' },
  { id: 'square', path: '/square', mode: 'unreachable', clock: SQUARE_OPEN },
  { id: 'my-library-books', path: '/my-library', mode: 'unreachable', signedIn: true, then: async (p) => { await p.waitForTimeout(3000); await p.locator('.ml-sw', { hasText: /books/i }).first().click(); } },
  { id: 'settings', path: '/settings', mode: 'unreachable', signedIn: true },
  { id: 'profile', path: '/profile', mode: 'unreachable', signedIn: true },
  { id: '404', path: '/this-page-does-not-exist', mode: 'plain', wait: 3000 },
  { id: 'offline-bookstore', path: '/bookstore', mode: 'offline-nav' },
  { id: 'offline-square', path: '/square', mode: 'offline-nav' },
  { id: 'stays-home', path: '/public-library', mode: 'stays' },
];

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const list = SURFACES.filter((s) => !ONLY.length || ONLY.includes(s.id));
const account = list.some((s) => s.signedIn) ? await throwaway() : null;
try {
  for (const s of list) for (const w of [390, 1180]) {
    try { await shoot(browser, s, w, s.signedIn ? account : null); } catch (e) { console.log(`  ✗ ${s.id} ${w}: ${e.message.split('\n')[0]}`); }
  }
} finally {
  await browser.close();
  if (account) console.log('cleanup', JSON.stringify(await cleanup(account.uid)));
}
process.exit(0);
