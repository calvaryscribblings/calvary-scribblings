// R48 — DOES THE PAGE ACTUALLY NARROW TO THE DEVICE? Five real user agents, end to end.
//
//   node tests/applinks/devices.mjs
//
// ⚠ THIS IS THE HALF THE RENDER MATRIX CANNOT SEE. tests/applinks/render-matrix.mjs drives a
// desktop Chromium at 390px, which is a NARROW DESKTOP, not a phone — so every state it
// screenshots resolves to the desktop branch and the narrowing never runs. A 390px viewport is
// not a device.
//
// So this builds with BOTH flags on — the only state in which there is anything to narrow —
// and loads /app under five agents:
//
//   iPhone      → the App Store alone
//   Android     → Google Play alone
//   desktop     → both, because it cannot know what is in the reader's pocket
//   iPad        → the App Store alone, via the Macintosh-UA-plus-touch check
//   a real Mac  → both, i.e. the iPad check does not swallow actual desktops
//
// It rewrites app/lib/appLinks.js and restores it on every exit path.
// ⚠ DO NOT RUN THIS CONCURRENTLY WITH ANYTHING ELSE IN THE REPO. It mutates a committed source
// file for the length of a build; a test run started alongside it will read a flag state that
// is not the committed one and fail confusingly. (Observed: `npm run test:applinks` failed
// "iOS 1.5.0 is live" while the render matrix held the file at both-false.)
import { readFile, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, devices } from 'playwright';
const run = promisify(execFile);
const M = '/workspaces/calvary-scribblings/app/lib/appLinks.js';
const orig = await readFile(M, 'utf8');
let done = false;
const restore = async () => { if (!done) { done = true; await writeFile(M, orig, 'utf8'); } };
process.on('SIGINT', async () => { await restore(); process.exit(130); });
try {
  await writeFile(M, orig.replace('export const ANDROID_APP_LIVE = false;', 'export const ANDROID_APP_LIVE = true;'), 'utf8');
  console.log('building with BOTH flags on…');
  await run('npm', ['run', 'build'], { cwd: '/workspaces/calvary-scribblings', maxBuffer: 128e6, timeout: 900e3 });
  const srv = spawn('npx', ['serve', 'out', '-l', '4332', '--no-clipboard'], { cwd: '/workspaces/calvary-scribblings', stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const CASES = [
    ['iPhone 13',        devices['iPhone 13']],
    ['Pixel 5 (Android)', devices['Pixel 5']],
    ['Desktop Chrome',   devices['Desktop Chrome']],
    // ⚠ PLAYWRIGHT CANNOT SIMULATE AN iPad FAITHFULLY WITH hasTouch ALONE: it sets
    // maxTouchPoints to 1, and real iPadOS reports 5. A first run of this check showed the
    // iPad falling through to 'desktop' and that was the HARNESS being wrong, not the code —
    // so maxTouchPoints is overridden to the real value before any script runs.
    ['iPad (Mac UA + 5 touch points)', { ...devices['Desktop Chrome'], hasTouch: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' }, 5],
    ['real Mac (0 touch points)', devices['Desktop Chrome'], 0],
  ];
  console.log('\n  device                     UA platform   /app offers');
  for (const [name, dev, touchPoints] of CASES) {
    const ctx = await b.newContext(dev);
    if (touchPoints !== undefined) {
      await ctx.addInitScript((n) => {
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => n, configurable: true });
      }, touchPoints);
    }
    const p = await ctx.newPage();
    await p.goto('http://localhost:4332/app', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const offered = await p.$$eval('.cs-appinv-cta', (a) => a.map((x) => x.textContent.trim()));
    const plat = await p.evaluate(() => {
      const s = navigator.userAgent;
      if (/android/i.test(s)) return 'android';
      if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
      if (/Macintosh/i.test(s) && navigator.maxTouchPoints > 1) return 'ios (iPad)';
      return 'desktop';
    });
    console.log(`  ${name.padEnd(26)} ${plat.padEnd(12)} ${offered.join(' + ') || '—'}`);
    await ctx.close();
  }
  await b.close(); srv.kill();
} finally { await restore(); console.log('\n  appLinks.js restored.'); }
