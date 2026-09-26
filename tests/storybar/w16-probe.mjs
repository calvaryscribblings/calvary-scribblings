// W16 — THE BAR, MEASURED ON THE GLASS. Extends W9's bar-probe with the three things it could not
// see when Ikenna's iPhone showed the bar ~40% down the screen on 26 Sep:
//
//   1. WHERE ON SCREEN. W9 asserted getBoundingClientRect().top === 0, which is a LAYOUT-viewport
//      coordinate. A fixed bar is always at layout top 0; what the reader sees is
//      (rect.top − visualViewport.offsetTop) × scale. This probe asserts THAT.
//   2. EVERY ANCESTOR, EVERY FRAME. The computed style of every ancestor of the bar is checked on
//      every sampled frame with app/lib/storyBar.js's own containingBlockAncestor(), injected
//      verbatim — the same function the founder readout runs. One hit on one frame fails the run.
//   3. VIEWPORTS APART, AND ROTATION. Desktop WebKit cannot pinch, zoom onto a field or raise a
//      keyboard, so the visual viewport is REPLAYED (a stand-in visualViewport reporting a zoomed /
//      panned state, with its events), the way W9 replayed the rubber-band. The bar must be hidden
//      for as long as the viewports disagree. Rotation swaps the viewport mid-read.
//
// And a CANARY, run last on every page: a transform is put on <body> and the probe must SEE it.
// If the check ever stops catching an ancestor transform, the canary fails the run.
//
//   node tests/storybar/w16-probe.mjs [--site URL] [--pages /stories/a,/series/…] [--json out.json]
import { writeFileSync, readFileSync } from 'node:fs';
import { launchWebKit } from './webkit.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const PAGES = arg('--pages', '/stories/the-number-thirteen').split(',');
const SIZES = [{ w: 390, h: 844, name: 'iPhone' }, { w: 820, h: 1180, name: 'iPad portrait' }];

// app/lib/storyBar.js, verbatim, as a page script: `export` dropped, everything hung on window.__sb.
const LIB = readFileSync(new URL('../../app/lib/storyBar.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const INJECT = `(() => { ${LIB}\n window.__sb = { containingBlockAncestor, viewportsAgree, nextBar }; })();`;

const SAMPLER = () => {
  window.__samples = []; window.__sampling = false;
  const sample = (t) => {
    const b = document.querySelector('[data-story-bar]');
    if (!window.__sampling || !b || !window.__sb) return;
    const r = b.getBoundingClientRect();
    const vv = window.visualViewport || { offsetTop: 0, scale: 1 };
    const anc = window.__sb.containingBlockAncestor(b, (el) => getComputedStyle(el));
    window.__samples.push({ t, top: r.top, bottom: r.bottom, screenTop: (r.top - vv.offsetTop) * vv.scale,
      screenBottom: (r.bottom - vv.offsetTop) * vv.scale, state: b.getAttribute('data-state'),
      apart: !window.__sb.viewportsAgree({ offsetTop: vv.offsetTop, scale: vv.scale }), anc: anc ? `${anc.tag} → ${anc.reason}` : null });
  };
  const tick = (t) => { sample(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // Software GL starves rAF while the viewport is resized, so resize and scroll sample too.
  for (const ev of ['resize', 'scroll']) window.addEventListener(ev, () => sample(performance.now()), { passive: true });
};

async function momentum(page, dir, v0) {
  await page.evaluate(async ({ dir, v0 }) => {
    let v = v0;
    await new Promise((res) => { const f = () => { window.scrollBy(0, dir * v); v *= 0.94; if (v < 0.5) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  }, { dir, v0 });
  await page.waitForTimeout(450);
}

async function bounce(page, where) {
  await page.evaluate(async (where) => {
    const max = document.scrollingElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, where === 'bottom' ? max : 0);
    await new Promise((r) => setTimeout(r, 450));
    const base = where === 'bottom' ? max : 0, sign = where === 'bottom' ? 1 : -1;
    let fake = base;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => fake });
    for (const o of [0, 12, 30, 52, 68, 78, 80, 74, 60, 42, 24, 10, 3, 0]) {
      fake = base + sign * o; window.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    delete window.scrollY; window.dispatchEvent(new Event('scroll'));
  }, where);
  await page.waitForTimeout(450);
}

async function toolbar(page, h) {
  const w = page.viewportSize().width;
  await page.evaluate(() => window.scrollTo(0, 1600)); await page.waitForTimeout(400);
  for (const d of [74, 0]) { await page.setViewportSize({ width: w, height: h + d }); await page.evaluate(() => window.scrollBy(0, -40)); await page.waitForTimeout(80); }
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight - window.innerHeight)); await page.waitForTimeout(400);
  await page.setViewportSize({ width: w, height: h + 74 }); await page.waitForTimeout(80);
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(450);
}

async function rotate(page, size) {
  await page.evaluate(() => window.scrollTo(0, 2400)); await page.waitForTimeout(300);
  await page.setViewportSize({ width: size.h, height: size.w }); await page.waitForTimeout(500);
  await momentum(page, -1, 60);
  await page.setViewportSize({ width: size.w, height: size.h }); await page.waitForTimeout(500);
  await momentum(page, 1, 80);
}

// The visual viewport, replayed: zoomed (scale 1.8, panned 300px down the layout viewport), then
// panned by a keyboard at scale 1 (offsetTop 280), then agreeing again. On a real iPhone this is
// what a pinch, a double-tap or Safari's zoom onto a focused field looks like to the page.
async function viewportsApart(page) {
  await page.evaluate(async () => {
    window.scrollTo(0, 1200);
    await new Promise((r) => setTimeout(r, 300));
    const real = window.visualViewport;
    const fake = new EventTarget();
    let st = { offsetTop: 0, offsetLeft: 0, scale: 1 };
    for (const k of ['offsetTop', 'offsetLeft', 'scale']) Object.defineProperty(fake, k, { get: () => st[k] });
    Object.defineProperty(fake, 'height', { get: () => window.innerHeight / st.scale });
    Object.defineProperty(fake, 'width', { get: () => window.innerWidth / st.scale });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    // The bar listens on the instance it found at mount — so re-route that instance's events too.
    const fire = () => { for (const t of [fake, real]) { t.dispatchEvent(new Event('resize')); t.dispatchEvent(new Event('scroll')); } };
    const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    window.__vvState = (s) => { st = { ...st, ...s }; fire(); };
    // Patch the real instance's getters so a listener bound to it reads the replayed values.
    for (const k of ['offsetTop', 'scale']) { try { Object.defineProperty(real, k, { configurable: true, get: () => st[k] }); } catch { /* read-only: the fake carries it */ } }
    for (const s of [{ scale: 1.8, offsetTop: 300 }, { scale: 1.8, offsetTop: 520 }, { scale: 1, offsetTop: 280 }, { scale: 1, offsetTop: 0 }]) {
      window.__vvState(s); await frames(30);
    }
    for (const k of ['offsetTop', 'scale']) { try { delete real[k]; } catch { /* nothing to undo */ } }
    delete window.visualViewport;
  });
  await page.waitForTimeout(450);
}

const SCENARIOS = [
  ['momentum down, then up', async (p) => { await momentum(p, 1, 140); await momentum(p, -1, 140); await momentum(p, 1, 60); await momentum(p, -1, 30); }],
  ['rubber-band at the top', async (p) => bounce(p, 'top')],
  ['rubber-band at the bottom', async (p) => bounce(p, 'bottom')],
  ['toolbar collapse / expand', async (p, s) => toolbar(p, s.h)],
  ['rotation, mid-read', async (p, s) => rotate(p, s)],
  ['viewports apart (zoom, keyboard)', async (p) => viewportsApart(p)],
];

function judge(samples) {
  let lastChange = -Infinity, prev = null;
  const r = { frames: samples.length, restShown: 0, offScreenTop: 0, worstScreenTopPx: 0, partialRests: 0, ancestorHits: 0, firstAncestor: null, apartFrames: 0, apartShown: 0 };
  for (const s of samples) {
    if (s.anc) { r.ancestorHits++; r.firstAncestor ??= s.anc; }
    if (s.state !== prev) { lastChange = s.t; prev = s.state; }
    if (s.apart) { r.apartFrames++; if (s.t - lastChange >= 350 && s.state !== 'hidden') r.apartShown++; continue; }
    if (s.t - lastChange < 350) continue;           // mid-transition: the 280ms slide
    if (s.state === 'shown') {
      r.restShown++;
      const off = Math.abs(s.screenTop);
      r.worstScreenTopPx = Math.max(r.worstScreenTopPx, +off.toFixed(2));
      if (off > 0.5) r.offScreenTop++;
    } else if (!(s.screenBottom <= 0.5)) r.partialRests++;
  }
  return r;
}

const out = [];
let canaryMissed = 0;
const browser = await launchWebKit();
for (const path of PAGES) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private mode */ } });
    await page.addInitScript(INJECT);
    await page.addInitScript(SAMPLER);
    await page.goto(SITE + path, { waitUntil: 'load' });
    await page.waitForSelector('[data-story-bar]');
    await page.waitForTimeout(3000);
    for (const [name, run] of SCENARIOS) {
      await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(500);
      await page.evaluate(() => { window.__samples = []; window.__sampling = true; });
      await run(page, size);
      const j = judge(await page.evaluate(() => { window.__sampling = false; return window.__samples; }));
      out.push({ path, size: size.name, scenario: name, ...j });
      console.log(`${path}  ${size.name.padEnd(13)} ${name.padEnd(33)} frames ${String(j.frames).padStart(4)}  rest-shown ${String(j.restShown).padStart(4)}  off-glass ${j.offScreenTop}  worst ${j.worstScreenTopPx}px  partial ${j.partialRests}  apart ${j.apartFrames}/${j.apartShown} shown  ancestor ${j.ancestorHits ? j.firstAncestor : 'none'}`);
    }
    // THE CANARY: the check must catch a containing block when there is one.
    const caught = await page.evaluate(async () => {
      document.body.style.transform = 'translateZ(0)';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const hit = window.__sb.containingBlockAncestor(document.querySelector('[data-story-bar]'), (el) => getComputedStyle(el));
      document.body.style.transform = '';
      return hit ? `${hit.tag} → ${hit.reason}` : null;
    });
    if (!caught) canaryMissed++;
    console.log(`${path}  ${size.name.padEnd(13)} canary (body transform)            ${caught ? `caught: ${caught}` : 'MISSED'}`);
    await ctx.close();
  }
}
await browser.close();
const json = arg('--json', null);
if (json) writeFileSync(json, JSON.stringify(out, null, 2));
const bad = out.filter((r) => r.offScreenTop || r.partialRests || r.ancestorHits || r.apartShown);
if (canaryMissed) console.log(`\nFAIL: the ancestor check missed the canary ${canaryMissed} time(s)`);
console.log(bad.length ? `FAIL: ${bad.length} of ${out.length} runs break the rule` : `PASS: all ${out.length} runs, canary caught every time`);
process.exit(bad.length || canaryMissed ? 1 : 0);
