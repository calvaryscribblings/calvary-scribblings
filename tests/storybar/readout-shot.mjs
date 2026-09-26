// W16 — THE FOUNDER READOUT, SEEN FROM OUTSIDE. W17: live harnesses never sign in as a founder
// any more (tests/live/test-reader.mjs), so this signs in as the TEST READER, behind
// tests/live/firewall.mjs, and proves the readout's gate from the side a reader stands on:
//   · the test reader (not a founder) + ?debug=bar → no readout;
//   · signed out + ?debug=bar                      → no readout;
//   · the build stamp is on the page;
//   · a signed-in session, scrolled end to end → no ancestor of the bar is a containing block on
//     any sampled frame.
// The founder's own view (the readout appearing) was proven live in W16 as Ikenna, before this
// rule, and is pinned by tests/ci/w16-bar.test.mjs; it is not re-run against the live site.
//
//   node tests/storybar/readout-shot.mjs <outDir> [--site URL] [--story slug]   (needs serviceAccountKey.json)
//
// Screenshots go to <outDir>, never the repo.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchWebKit } from './webkit.mjs';
import { ensureTestReader, testReaderSession, signInPage, testReaderWatch } from '../live/test-reader.mjs';
import { installFirewall, newStats, statsLine } from '../live/firewall.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tests/storybar/readout-shot.mjs <outDir> [--site URL] [--story slug]'); process.exit(2); }
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const STORY = arg('--story', 'the-number-thirteen');
mkdirSync(OUT, { recursive: true });

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const READER = await ensureTestReader();
const WATCH = testReaderWatch(READER);
const fw = newStats();
const snapshot = async () => Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));
const LIB = readFileSync(new URL('../../app/lib/storyBar.js', import.meta.url), 'utf8').replace(/^export /gm, '');

const before = await snapshot();
const account = await testReaderSession(READER);
const browser = await launchWebKit();

async function open({ signedIn, debug }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await installFirewall(ctx, { site: SITE, stats: fw });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ } });
  await page.addInitScript(`(() => { ${LIB}\n window.__sb = { containingBlockAncestor }; })();`);
  if (signedIn) await signInPage(page, SITE, account);
  await page.goto(`${SITE}/stories/${STORY}${debug ? '?debug=bar' : ''}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-story-bar]');
  await page.waitForTimeout(6000); // auth restores; a readout would have loaded by now
  return { ctx, page };
}

const report = {};
let failed = 0;
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failed++; };

{ // the test reader + ?debug=bar
  const { ctx, page } = await open({ signedIn: true, debug: true });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(1500);
  expect(await page.locator('[data-bar-readout]').count() === 0, 'a signed-in reader who is not a founder, with ?debug=bar: no readout');
  const stamp = await page.locator('[data-build-stamp]').textContent().catch(() => null);
  report.stamp = stamp;
  expect(!!stamp && /^Build [0-9a-f]{12}$/.test(stamp.trim()), `the build stamp is on the page: ${stamp}`);
  await page.screenshot({ path: join(OUT, 'reader-debug-bar-390.png') });
  const anc = await page.evaluate(async () => {
    const bar = document.querySelector('[data-story-bar]');
    const max = document.scrollingElement.scrollHeight - window.innerHeight;
    let frames = 0; const hits = new Set();
    for (let y = 0; y <= max; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      frames++;
      const h = window.__sb.containingBlockAncestor(bar, (el) => getComputedStyle(el));
      if (h) hits.add(`${h.tag} → ${h.reason}`);
    }
    return { frames, hits: [...hits] };
  });
  report.ancestors = anc;
  expect(anc.hits.length === 0, `signed-in session, ${anc.frames} frames end to end: no containing-block ancestor${anc.hits.length ? ' — ' + anc.hits.join('; ') : ''}`);
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
report.integrity = { firewall: statsLine(fw), changed: changed.map((p) => p.replace(READER, '{test reader}')) };
console.log(`\n${statsLine(fw)}; test-reader records changed: ${changed.length ? changed.length : 'none'}`);
if (changed.length) failed++;
writeFileSync(join(OUT, 'readout-report.json'), JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
