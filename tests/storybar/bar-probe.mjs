// W9 — THE BAR, FRAME-SAMPLED. Drives a story/Series page in WebKit at iPad and iPhone sizes
// through the scroll scenarios that detached the bar on Ikenna's devices, and records the bar's
// position on every animation frame.
//
//   node tests/storybar/bar-probe.mjs [--site URL] [--json out.json]
//
// Desktop WebKit cannot rubber-band or collapse a Safari toolbar, so those two are REPLAYED:
//   · rubber-band: window.scrollY is overridden to the values iOS reports during a bounce
//     (negative at the top, past the maximum at the bottom) and scroll events are dispatched —
//     the exact input the page's scroll logic sees on a phone;
//   · toolbar: the viewport height changes mid-scroll (innerHeight grows/shrinks by 74px).
// Momentum is real scrolling, driven per frame with a decaying velocity.
//
// The assertion (W9 rule B.2): on every sampled frame where the bar is AT REST SHOWN, its top is
// 0 ± 0.5px; the progress line's top equals the bar's bottom; and the bar only ever rests fully
// shown or fully hidden.
import { webkit } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const PAGES = (arg('--pages', '/stories/trouble-shooting')).split(',');
const SIZES = [{ w: 1180, h: 820, name: 'iPad landscape' }, { w: 820, h: 1180, name: 'iPad portrait' }, { w: 390, h: 844, name: 'iPhone' }];

// In-page: sample every frame. The bar is whichever of these the page carries.
const INSTALL = () => {
  const bar = () => document.querySelector('[data-story-bar]') || document.querySelector('.story-nav') || document.querySelector('nav');
  const line = () => document.querySelector('[data-story-bar-progress]') || document.querySelector('.reading-progress');
  window.__samples = [];
  window.__sampling = false;
  const tick = (t) => {
    if (window.__sampling) {
      const b = bar(); const l = line();
      if (b) {
        const r = b.getBoundingClientRect();
        const lr = l ? l.getBoundingClientRect() : null;
        const state = b.getAttribute('data-state') || (b.classList.contains('hidden') ? 'hidden' : 'shown');
        window.__samples.push({ t, top: r.top, bottom: r.bottom, h: r.height, state, lineTop: lr ? lr.top : null, lineOpacity: l ? getComputedStyle(l).opacity : null, y: window.scrollY, ih: window.innerHeight });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function momentum(page, dir, v0) {
  await page.evaluate(async ({ dir, v0 }) => {
    let v = v0;
    await new Promise((res) => {
      const f = () => { window.scrollBy(0, dir * v); v *= 0.94; if (v < 0.5) res(); else requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
  }, { dir, v0 });
  await page.waitForTimeout(450);
}

async function bounce(page, where) {
  await page.evaluate(async (where) => {
    const max = document.scrollingElement.scrollHeight - window.innerHeight;
    if (where === 'bottom') window.scrollTo(0, max); else window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 450));
    const base = where === 'bottom' ? max : 0;
    const sign = where === 'bottom' ? 1 : -1;
    // iOS: the overshoot eases out to ~80px and springs back.
    const path = [0, 12, 30, 52, 68, 78, 80, 74, 60, 42, 24, 10, 3, 0];
    const proto = Object.getOwnPropertyDescriptor(Window.prototype, 'scrollY') || Object.getOwnPropertyDescriptor(window, 'scrollY');
    let fake = base;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => fake });
    Object.defineProperty(window, 'pageYOffset', { configurable: true, get: () => fake });
    for (const o of path) {
      fake = base + sign * o;
      window.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    delete window.scrollY; delete window.pageYOffset;
    if (proto) { /* restored to the prototype getter */ }
    window.dispatchEvent(new Event('scroll'));
  }, where);
  await page.waitForTimeout(450);
}

async function toolbar(page, h) {
  // Scroll down a little, collapse the toolbar (taller viewport), scroll up, expand it again.
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(400);
  for (const d of [74, 0]) {
    await page.setViewportSize({ width: page.viewportSize().width, height: h + d });
    await page.evaluate(() => window.scrollBy(0, -40));
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => { const max = document.scrollingElement.scrollHeight - window.innerHeight; window.scrollTo(0, max); });
  await page.waitForTimeout(400);
  // At the very bottom the toolbar expanding CLAMPS scrollY downward — to the old code, a scroll up.
  await page.setViewportSize({ width: page.viewportSize().width, height: h + 74 });
  await page.waitForTimeout(80);
  await page.setViewportSize({ width: page.viewportSize().width, height: h });
  await page.waitForTimeout(450);
}

const SCENARIOS = [
  ['momentum down, then up', async (p) => { await momentum(p, 1, 140); await momentum(p, -1, 140); await momentum(p, 1, 60); await momentum(p, -1, 30); }],
  ['rubber-band at the top', async (p) => bounce(p, 'top')],
  ['rubber-band at the bottom', async (p) => bounce(p, 'bottom')],
  ['toolbar collapse / expand', async (p, h) => toolbar(p, h)],
];

function judge(samples) {
  // At rest = the state has not changed for 350ms (the transition is 300ms).
  let lastChange = -Infinity, prev = null;
  let restShown = 0, restShownBad = 0, worst = 0, gapWorst = 0, partialRests = 0, flips = 0;
  for (const s of samples) {
    if (s.state !== prev) { if (prev !== null) flips++; lastChange = s.t; prev = s.state; }
    if (s.t - lastChange < 350) continue;
    if (s.state === 'shown') {
      restShown++;
      const off = Math.abs(s.top);
      worst = Math.max(worst, off);
      if (off > 0.5) restShownBad++;
      if (s.lineTop !== null) gapWorst = Math.max(gapWorst, Math.abs(s.lineTop - s.bottom));
    } else if (!(Math.abs(s.bottom) <= 0.5)) partialRests++; // hidden must rest with its bottom at 0
  }
  return { frames: samples.length, restShown, restShownBad, worstTopPx: +worst.toFixed(2), lineGapWorstPx: +gapWorst.toFixed(2), partialRests, flips };
}

const out = [];
const browser = await webkit.launch();
for (const path of PAGES) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, hasTouch: true, isMobile: size.w < 1000 });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
    await page.addInitScript(INSTALL);
    await page.goto(SITE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    for (const [name, run] of SCENARIOS) {
      await page.evaluate(() => { window.scrollTo(0, 900); });
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.__samples = []; window.__sampling = true; });
      await run(page, size.h);
      const samples = await page.evaluate(() => { window.__sampling = false; return window.__samples; });
      const j = judge(samples);
      out.push({ path, size: size.name, w: size.w, h: size.h, scenario: name, ...j });
      console.log(`${path}  ${size.name.padEnd(15)} ${name.padEnd(28)} frames ${String(j.frames).padStart(4)}  rest-shown ${String(j.restShown).padStart(4)}  off>0.5 ${String(j.restShownBad).padStart(4)}  worst ${j.worstTopPx}px  line-gap ${j.lineGapWorstPx}px  partial-rests ${j.partialRests}  flips ${j.flips}`);
    }
    await ctx.close();
  }
}
await browser.close();
const json = arg('--json', null);
if (json) writeFileSync(json, JSON.stringify(out, null, 2));
const bad = out.filter((r) => r.restShownBad || r.partialRests || r.lineGapWorstPx > 0.5);
console.log(bad.length ? `\nFAIL: ${bad.length} of ${out.length} runs break the rule` : `\nPASS: all ${out.length} runs`);
process.exit(bad.length ? 1 : 0);
