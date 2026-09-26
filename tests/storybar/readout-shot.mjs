// W16 — THE FOUNDER READOUT, SEEN. Signs in as Ikenna (write firewall on, records re-read), opens a
// story page with ?debug=bar, and proves:
//   · founder + ?debug=bar     → the readout is on screen, and says what it should;
//   · founder, no ?debug=bar   → no readout;
//   · signed out + ?debug=bar  → no readout;
//   · founder session, scrolled end to end with the founder pill up → no ancestor of the bar is a
//     containing block on any sampled frame (the founder-only surfaces were a W16 suspect).
//
//   node tests/storybar/readout-shot.mjs <outDir> [--site URL] [--story slug]   (needs serviceAccountKey.json)
//
// The screenshot goes to <outDir>, never the repo: the repo is public and this is a founder view.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchWebKit } from './webkit.mjs';
import { API_KEY, IKENNA, WATCH, session, SIGNED_IN, firewall, firewallStats } from './founder-session.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tests/storybar/readout-shot.mjs <outDir> [--site URL] [--story slug]'); process.exit(2); }
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const STORY = arg('--story', 'the-number-thirteen');
mkdirSync(OUT, { recursive: true });

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const snapshot = async () => Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));
const LIB = readFileSync(new URL('../../app/lib/storyBar.js', import.meta.url), 'utf8').replace(/^export /gm, '');

const before = await snapshot();
const account = await session();
const browser = await launchWebKit();

async function open({ signedIn, debug }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ } });
  await page.addInitScript(`(() => { ${LIB}\n window.__sb = { containingBlockAncestor }; })();`);
  await firewall(page);
  if (signedIn) {
    await page.goto(SITE + '/terms', { waitUntil: 'domcontentloaded' });
    await page.evaluate(SIGNED_IN, { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, user: {
      uid: IKENNA, email: null, emailVerified: true, isAnonymous: false, providerData: [], displayName: 'Ikenna Okpara',
      stsTokenManager: { refreshToken: account.refreshToken, accessToken: account.idToken, expirationTime: Date.now() + 3500e3 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
    } });
  }
  await page.goto(`${SITE}/stories/${STORY}${debug ? '?debug=bar' : ''}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-story-bar]');
  await page.waitForTimeout(6000); // auth restores, the readout's chunk loads
  return { ctx, page };
}

const report = {};
let failed = 0;
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failed++; };

{ // founder + ?debug=bar
  const { ctx, page } = await open({ signedIn: true, debug: true });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(1500);
  const text = await page.locator('[data-bar-readout]').textContent().catch(() => null);
  report.readout = text;
  expect(!!text, 'founder + ?debug=bar: the readout is on screen');
  for (const k of ['build ', 'live ', 'scrollY ', 'vv ', 'bar ', 'views ', 'ancestor ']) expect(!!text && text.includes(k), `  it shows "${k.trim()}"`);
  expect(!!text && /ancestor none/.test(text), '  and it reads "ancestor none"');
  const stamp = await page.locator('[data-build-stamp]').textContent().catch(() => null);
  report.stamp = stamp;
  expect(!!stamp && /^Build [0-9a-f]{12}$/.test(stamp.trim()), `the build stamp is on the page: ${stamp}`);
  await page.screenshot({ path: join(OUT, 'readout-founder-390.png') });
  // The founder surfaces, end to end: every sampled frame, every ancestor.
  const anc = await page.evaluate(async () => {
    const bar = document.querySelector('[data-story-bar]');
    const pill = !!document.querySelector('[data-founder-pill]');
    const max = document.scrollingElement.scrollHeight - window.innerHeight;
    let frames = 0; const hits = new Set();
    for (let y = 0; y <= max; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      frames++;
      const h = window.__sb.containingBlockAncestor(bar, (el) => getComputedStyle(el));
      if (h) hits.add(`${h.tag} → ${h.reason}`);
    }
    return { pill, frames, hits: [...hits] };
  });
  report.founderAncestors = anc;
  expect(anc.hits.length === 0, `founder session, ${anc.frames} frames end to end (pill ${anc.pill ? 'up' : 'absent'}): no containing-block ancestor${anc.hits.length ? ' — ' + anc.hits.join('; ') : ''}`);
  await ctx.close();
}
{ // founder, no flag
  const { ctx, page } = await open({ signedIn: true, debug: false });
  expect(await page.locator('[data-bar-readout]').count() === 0, 'founder without ?debug=bar: no readout');
  await ctx.close();
}
{ // signed out + flag
  const { ctx, page } = await open({ signedIn: false, debug: true });
  expect(await page.locator('[data-bar-readout]').count() === 0, 'signed out with ?debug=bar: no readout');
  await ctx.close();
}
await browser.close();

const after = await snapshot();
const changed = WATCH.filter((p) => before[p] !== after[p]);
report.integrity = { dropped: firewallStats.dropped, changed };
console.log(`\nwrites dropped at the socket: ${firewallStats.dropped}; account records changed: ${changed.length ? changed.join(', ') : 'none'}`);
if (changed.length) failed++;
writeFileSync(join(OUT, 'readout-report.json'), JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
