// W9 — THE LOCK, PHOTOGRAPHED ON THE LIVE SITE, and the founder pill watched for overlap.
//
//   node tests/storybar/lock-shots.mjs <outDir> [--site URL]      (needs serviceAccountKey.json)
//
// Cream = a story page (trouble-shooting). Dark = the Series (beta-princess-i2). At 390, 820 and
// 1180, signed in and signed out.
//
// W17: SIGNED IN is the TEST READER (tests/live/test-reader.mjs), never a founder, behind
// tests/live/firewall.mjs — socket writes dropped, long-polling and every non-GET refused — and
// the test reader's records are re-read before and after (CLAUDE.md, "Probes that write to live
// data"). Until W17 this signed in as Ikenna and used his founder preview to see the lock early.
// A non-founder sees the lock only once the gate is on for everyone, so this harness now RUNS
// ONLY AFTER THE 30 SEPT SWITCH, and refuses before it. The founder pill is founder-only, so the
// pill watch reports "no pill" (W9 measured it: 0 of 559 frames overlapped).
//
// SIGNED OUT: the page clock is set to 1 Oct 2026 as before; /api/story is answered with the
// locked body the signed-in run received.
import { launchWebKit } from './webkit.mjs'; // W16: this codespace's WebKit crashes without it — see webkit.mjs
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { ensureTestReader, testReaderSession, signInPage, testReaderWatch } from '../live/test-reader.mjs';
import { installFirewall, newStats, statsLine } from '../live/firewall.mjs';
import { gatingOn } from '../../app/lib/storyAccess.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast } from '../../app/lib/archiveLock.js';

const OUT = process.argv[2];
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const STORY = 'trouble-shooting';
const INSTALMENT = 'beta-princess-i2';
const AFTER_SWITCH = new Date('2026-10-01T09:00:00Z');
const SIZES = [[390, 844], [820, 1180], [1180, 820]];
if (!gatingOn(Date.now())) {
  console.error('lock-shots: until the archive gate is on for everyone only a founder sees the lock, and live harnesses no longer sign in as one (W17). Run it once gatingOn() is true.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const READER = await ensureTestReader();
const WATCH = testReaderWatch(READER);
const fw = newStats();
const snapshot = async () => Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));

async function openPage(browser, [w, h], { signedIn, account, previewBody }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: w < 1000, serviceWorkers: 'block' });
  await installFirewall(ctx, { site: SITE, stats: fw });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  if (!signedIn) {
    await page.clock.install({ time: AFTER_SWITCH });
    if (previewBody) await page.route('**/api/story', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: previewBody }));
  } else {
    await signInPage(page, SITE, account);
  }
  return { ctx, page };
}

async function measure(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const body = q('[data-lock-body]');
    const ground = getComputedStyle(q('.story-body-wrap') || document.body).backgroundColor;
    const hex = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); return '#' + m.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''); };
    const fade = q('[data-archive-fade]');
    const art = fade ? fade.closest('article') : null;
    const fr = fade?.getBoundingClientRect(), ar = art?.getBoundingClientRect(), mr = q('[data-lock-mark]')?.getBoundingClientRect();
    const prose = q('#story-content')?.getBoundingClientRect();
    return {
      bodyColour: body ? hex(getComputedStyle(body).color) : null, ground: hex(ground),
      fade: fr ? { left: fr.left, width: fr.width, articleLeft: ar.left, articleWidth: ar.width, proseLeft: prose?.left, proseWidth: prose?.width, gapToMark: mr.top - fr.bottom, bg: getComputedStyle(fade).backgroundImage } : null,
    };
  });
}

async function pillWatch(page) {
  // Scroll the lock block through the whole viewport, sampling every frame.
  return page.evaluate(async () => {
    const lock = document.querySelector('[data-archive-lock]');
    const pill = document.querySelector('[data-founder-pill]');
    if (!lock || !pill) return { skipped: !pill ? 'no pill' : 'no lock' };
    const target = lock.getBoundingClientRect().top + window.scrollY;
    const from = target - window.innerHeight, to = target + lock.offsetHeight;
    let frames = 0, clashes = 0;
    for (let y = from; y <= to; y += 14) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 30));
      frames++;
      const a = pill.getBoundingClientRect(), b = lock.getBoundingClientRect();
      const visible = Number(getComputedStyle(pill).opacity) > 0.02 && a.top < window.innerHeight;
      if (visible && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) clashes++;
    }
    return { frames, clashes };
  });
}

const before = await snapshot();
const report = { site: SITE, shots: [], measures: [], pill: [] };
const browser = await launchWebKit();
const account = await testReaderSession(READER);
let previewBody = null;

for (const signedIn of [true, false]) {
  for (const [kind, path, theme] of [['story', `/stories/${STORY}`, 'cream'], ['series', `/series/instalment/${INSTALMENT}`, 'dark']]) {
    for (const size of SIZES) {
      const { ctx, page } = await openPage(browser, size, { signedIn, account, previewBody });
      if (signedIn && kind === 'story') page.on('response', async (r) => { if (r.url().endsWith('/api/story') && !previewBody) { try { const j = await r.json(); if (j.access === 'preview') previewBody = JSON.stringify(j); } catch {} } });
      await page.goto(SITE + path, { waitUntil: 'networkidle' });
      const lock = page.locator('[data-archive-lock]');
      await lock.waitFor({ state: 'attached', timeout: 20000 });
      // Put the fade (or the block) a fifth of the way down, then let the 500ms reveal finish.
      await page.evaluate(() => {
        const el = document.querySelector('[data-archive-fade]') || document.querySelector('[data-archive-lock]');
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.2);
      });
      await page.waitForTimeout(1100);
      const name = `${kind}-${theme}-${size[0]}-${signedIn ? 'signed-in' : 'signed-out'}.png`;
      await page.screenshot({ path: join(OUT, name) });
      const m = await measure(page);
      m.contrast = m.bodyColour ? +contrast(m.bodyColour, theme === 'dark' ? '#080610' : m.ground).toFixed(2) : null;
      report.shots.push(name); report.measures.push({ name, ...m });
      if (signedIn) report.pill.push({ name, ...(await pillWatch(page)) });
      console.log(name, JSON.stringify({ contrast: m.contrast, fade: m.fade && { vsTextLeft: +(m.fade.left - m.fade.proseLeft).toFixed(2), vsTextWidth: +(m.fade.width - m.fade.proseWidth).toFixed(2), gapToMark: +m.fade.gapToMark.toFixed(2) } }));
      await ctx.close();
    }
  }
}
await browser.close();

const after = await snapshot();
const changed = WATCH.filter((p) => before[p] !== after[p]);
report.integrity = { firewall: statsLine(fw), changed: changed.map((p) => p.replace(READER, '{test reader}')) };
console.log(`\n${statsLine(fw)}; test-reader records changed: ${changed.length || 'none'}`);
for (const p of report.pill) console.log('pill', p.name, JSON.stringify({ frames: p.frames, clashes: p.clashes, skipped: p.skipped }));
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
process.exit(changed.length ? 2 : 0);
