// W32 — does the Book Store, arrived at through the gateway door, SETTLE into exactly the page a
// direct visit draws? Two fresh contexts, same viewport, same data; screenshots after the page is
// at rest; pixel diff. Signed out, GET only.
//   node tests/gateway/settled-match.mjs [--site URL] [--out DIR] [--engine chromium|webkit]
import { chromium } from '@playwright/test';
import { launchWebKit } from '../storybar/webkit.mjs';
import sharp from 'sharp';
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const OUT = arg('--out', '/tmp');
const b = arg('--engine', 'chromium') === 'webkit' ? await launchWebKit() : await chromium.launch();
async function shot(viaDoor) {
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  await ctx.route('**/*', (r) => (r.request().method() !== 'GET' || /\/api\/hit/.test(r.request().url()) ? r.abort() : r.continue()));
  const p = await ctx.newPage();
  if (viaDoor) {
    await p.goto(SITE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
    await p.locator('a.cs-gw-door[href="/bookstore"]').tap();
    await p.waitForURL('**/bookstore', { timeout: 20000 });
  } else await p.goto(SITE + '/bookstore', { waitUntil: 'networkidle' });
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(5000);
  const state = await p.evaluate(() => ({ veil: !!document.querySelector('.cs-arrive-veil'), arrival: !!document.querySelector('[data-arrival]'), rise: !!document.querySelector('.cs-arrive-rise') }));
  const buf = await p.screenshot({ animations: 'disabled' });
  await ctx.close();
  return { buf, state };
}
const direct = await shot(false), direct2 = await shot(false), door = await shot(true);
await b.close();
const raw = async (x) => sharp(x).removeAlpha().raw().toBuffer();
const cmp = (x, y) => { let n = 0, m = 0; for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); if (d > 2) n++; m = Math.max(m, d); } return [n, m]; };
const [a, a2, c] = [await raw(direct.buf), await raw(direct2.buf), await raw(door.buf)];
const [noise, noiseMax] = cmp(a, a2);
console.log(`CONTROL direct vs direct: ${noise} channels differ by >2 (max ${noiseMax}) — the page's own run-to-run noise`);
const [diff, maxd] = cmp(a, c);
await sharp(direct.buf).toFile(`${OUT}/settled-direct.png`); await sharp(door.buf).toFile(`${OUT}/settled-door.png`);
console.log('direct', JSON.stringify(direct.state), '| door', JSON.stringify(door.state));
console.log(`channels differing by >2: ${diff} of ${a.length} (${((diff / a.length) * 100).toFixed(3)}%), max delta ${maxd}`);
// Passes when the door's settled page is no further from a direct visit than two direct visits are.
process.exit(diff <= noise && maxd <= noiseMax ? 0 : 1);
