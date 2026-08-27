// R20 — THE SHELF'S WEIGHT, BUDGETED.
//
// Ikenna reported the storefront lagging as the catalogue grew from 3 titles to ~20. Measured
// on the shipped export before this round:
//
//   viewport   first paint   of which covers   layers   layer memory   frames >25ms
//   390          11.2 MiB     10.0 MiB (89.2%)    218       54.2 MiB      7.9–11.9%
//   1280         15.7 MiB     14.5 MiB (92.3%)    219      147.4 MiB     41.7–45.5%
//
// The catalogue was 33.74 MiB of raw PNG/JPEG admin uploads, up to 3931×5156, drawn into a
// board 104.7px wide on a handset and 197.6px on a laptop — a 37.5× linear oversample at worst.
// There is no image optimiser to catch this: output:'export' means next/image ran `unoptimized`
// and emitted no srcset at all. So the rungs are real objects, cut at upload time by
// /admin/bookstore and back-filled once by scripts/backfill-bookstore-cover-derivatives.mjs.
//
// ── WHAT THIS FILE IS FOR ───────────────────────────────────────────────────────────────────
// A weight regression is invisible. Nothing goes red, no test fails, no page breaks — a curator
// uploads a 4 MB cover through a browser that could not encode WebP, and the shop is simply
// slower forever. That is precisely the class of defect a budget catches and nothing else does.
//
// ⚠ THESE BUDGETS FAIL ON PRE-R20 HEAD, AND THAT WAS CHECKED RATHER THAN ASSUMED. Run against
// the build immediately before this round, `the shelf's covers fit their budget` reports
// 14.5 MiB against a 2 MiB ceiling and every one of the four largest covers over the per-cover
// ceiling. A budget nobody has ever seen fail is a number, not a test.
//
// ── WHY RELATIONS AND CEILINGS, NEVER EXACT BYTES ───────────────────────────────────────────
// The catalogue is LIVE — the same decision, for the same reason, that gate.spec.mjs,
// currency.spec.mjs and territory.spec.mjs all set out at length. A cover re-encoded by a
// curator, a title added, a WebP encoder that improves by a kilobyte: none of those is a
// regression, and a suite pinning exact bytes would go red for all three and have to be
// re-blessed by hand until nobody believed it. Every number below is a CEILING with headroom
// stated, and the headroom is written down so a future reader can see how much room they have.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { liveDetailSlug } from './live-slug.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
function stringConst(src, name, file) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(src);
  if (!m) throw new Error(`${file} no longer exports a single-quoted string const named ${name}.`);
  return m[1];
}
const GATE_STORAGE_KEY = stringConst(GATE_SRC, 'GATE_STORAGE_KEY', 'app/lib/bookstore/gate.js');
const CURRENCY_KEY = 'cs_bookstore_currency';

// BOTH PAGES CARRIED THE GRAIN, so both are checked for its absence. A suite that only looked
// at the storefront would let the detail page drift back on its own — which is exactly the
// half-fix R22.1 was called in to clean up.
//
// The detail page's slug is RESOLVED FROM THE SHOP, not named — see tests/bookstore/live-slug.mjs
// for the incident that taught this suite the difference.
const GRAIN_PAGES = [
  { name: 'storefront', path: () => '/bookstore', ready: '.shelf-entry .entry-title' },
  { name: 'detail', path: 'resolve', ready: '.bd-cta' },
];

// ── THE BUDGETS ─────────────────────────────────────────────────────────────────────────────
//
// PER COVER. Measured after R20, the heaviest rung any board pulls is 43 KB
// (the-tenant-of-wildfell-hall at 360w) and the heaviest 720w rung is 174 KB. 250 KB is a
// ceiling with roughly 6× headroom over what a shelf board actually takes, chosen so a genuinely
// detailed cover — a dense illustration, a photographic wrap — has somewhere to go without a
// curator having to argue with CI. Before R20 the worst was 4567 KB, eighteen times this.
const PER_COVER_MAX_BYTES = 250 * 1024;

// THE WHOLE FIRST PAINT'S WORTH OF COVERS. After R20 a laptop first paint pulls about 0.3 MiB
// of covers; before, 14.5 MiB. 2 MiB sits between them with roughly 6× headroom, which is also
// enough for the catalogue to double without anyone touching this number.
const SHELF_COVER_MAX_BYTES = 2 * 1024 * 1024;

// OVERSAMPLE. The real defect was never the byte count on its own — it was serving 3931px into
// a 104.7px board. A rung may legitimately be larger than its board (DPR3 is a 3× device, and
// `sizes` deliberately over-states so it never picks a rung too small), so the ceiling is 4×
// the CSS width the board is actually drawn at. Before R20 this ran to 37.5×.
const MAX_OVERSAMPLE = 4;

// LAYERS FOR A FULL SHELF. Measured 219 at 1280 and 218 at 390, for 23 boards — the detail page
// draws one board in 17, so about 9 layers per board is inherent to a 3D object with a
// preserve-3d parent, hidden backfaces and translateZ children.
//
// ⚠ THIS ONE DOES NOT FAIL ON PRE-R20 HEAD, AND SAYING SO IS THE POINT. R20 changed no
// compositing: `will-change:transform` was MEASURED not to be the promoter (removing it left
// the count at 219), the contact shadow's blur was measured to cost nothing, and the front
// face's box-shadow — which does cost about 7 points of dropped frames — is protected by
// ruling and was deliberately not touched. So this is a RATCHET, not a repair: it holds the
// count where it is so the next round cannot add a layer per board unnoticed. It is proven to
// be able to fail by the case below it, which adds layers and watches it trip.
const LAYER_MAX = 260;

const VIEWPORTS = [
  { name: '390 handset', width: 390, height: 844 },
  { name: '1280 laptop', width: 1280, height: 900 },
];

async function enterShop(page) {
  await page.addInitScript(
    ([gateKey, curKey]) => {
      try {
        window.localStorage.setItem('cs_cookie_consent', 'accepted');
        window.localStorage.setItem(gateKey, '1');
        window.localStorage.setItem(curKey, 'gbp');
      } catch { /* private mode */ }
    },
    [GATE_STORAGE_KEY, CURRENCY_KEY],
  );
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
}

/**
 * Loads the shop and returns every image response with its transferred size.
 *
 * content-length is preferred and the body is only read when the header is missing: reading a
 * body forces Playwright to buffer it, and on a page that used to pull 14.5 MiB of covers that
 * is the difference between a test and a timeout.
 */
async function loadShelf(page, { scroll = false } = {}) {
  const responses = [];
  page.on('response', async (res) => {
    try {
      const headers = await res.allHeaders();
      const ct = headers['content-type'] || '';
      if (res.request().resourceType() !== 'image' && !/^image\//.test(ct)) return;
      let bytes = Number(headers['content-length'] || 0);
      if (!bytes) { try { bytes = (await res.body()).length; } catch { bytes = 0; } }
      responses.push({ url: res.url(), ct, bytes });
    } catch { /* a response that vanished with its frame tells us nothing */ }
  });

  await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
  await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
  if (scroll) {
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = await page.evaluate(() => Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < docH; y += step) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(2500);
  return responses;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the cover payload', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: the shelf's covers fit their budget`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await enterShop(page);
      const images = await loadShelf(page);

      // Only the catalogue's own covers. The house logo and any decoration are a different
      // budget's problem and would make this number mean two things.
      const covers = images.filter((r) => /bookstore_covers/.test(decodeURIComponent(r.url)));
      expect(covers.length, 'the shop must have fetched some covers to measure').toBeGreaterThan(0);

      const total = covers.reduce((a, b) => a + b.bytes, 0);
      const worst = covers.slice().sort((a, b) => b.bytes - a.bytes)[0];
      const name = (u) => decodeURIComponent(u).split('/').pop().split('?')[0];

      expect(worst.bytes,
        `the heaviest cover on this shelf is ${kb(worst.bytes)} — ${name(worst.url)}. `
        + `The ceiling is ${kb(PER_COVER_MAX_BYTES)}. A cover this heavy means its sized rungs are `
        + `missing: check coverSizes on the record, and re-upload it through /admin/bookstore, `
        + `which cuts them. scripts/backfill-bookstore-cover-derivatives.mjs is the bulk tool.`)
        .toBeLessThanOrEqual(PER_COVER_MAX_BYTES);

      expect(total,
        `this shelf pulled ${kb(total)} of covers across ${covers.length} requests. `
        + `The ceiling is ${kb(SHELF_COVER_MAX_BYTES)}. Before R20 it was 14.5 MiB.`)
        .toBeLessThanOrEqual(SHELF_COVER_MAX_BYTES);
    });

    test(`${vp.name}: no board is served a cover it cannot use`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await enterShop(page);
      await loadShelf(page, { scroll: true });

      // naturalWidth is the rung the browser ACTUALLY CHOSE, not the one the srcset offered —
      // which is the only number that answers "what did this reader pay for this board".
      const boards = await page.evaluate(() => [...document.querySelectorAll('.bb-front img')]
        .filter((i) => i.complete && i.naturalWidth > 0)
        .map((i) => {
          const r = i.getBoundingClientRect();
          return {
            natural: i.naturalWidth,
            drawn: +r.width.toFixed(1),
            src: (i.currentSrc || i.src).split('/').pop().split('?')[0],
            loading: i.loading,
            decoding: i.decoding,
          };
        })
        .filter((b) => b.drawn > 0));

      expect(boards.length, 'some board must have decoded a cover to measure').toBeGreaterThan(0);

      const over = boards
        .map((b) => ({ ...b, ratio: b.natural / b.drawn }))
        .filter((b) => b.ratio > MAX_OVERSAMPLE)
        .sort((a, b) => b.ratio - a.ratio);

      expect(over,
        over.length
          ? `${over.length} board(s) are served a cover far larger than they draw. Worst: `
            + `${over[0].src} at ${over[0].natural}px into a ${over[0].drawn}px board `
            + `(${over[0].ratio.toFixed(1)}×, ceiling ${MAX_OVERSAMPLE}×). That is the R20 defect `
            + `returning: the board fell back to the full-size original because its rungs are absent.`
          : '')
        .toEqual([]);

      // The shelf must still DEFER what is below the fold. This is not a byte count — it is the
      // other half of the same promise, and it costs nothing to hold.
      for (const b of boards) {
        expect(b.decoding, `${b.src} must decode off the main thread`).toBe('async');
      }
    });
  }

  test('every board that has rungs asks for them, and states which it wants', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterShop(page);
    await loadShelf(page, { scroll: true });

    const boards = await page.evaluate(() => [...document.querySelectorAll('.bb-front img')].map((i) => ({
      hasSrcSet: !!i.getAttribute('srcset'),
      hasSizes: !!i.getAttribute('sizes'),
      src: (i.currentSrc || i.src).split('/').pop().split('?')[0],
    })));
    expect(boards.length).toBeGreaterThan(0);

    // A board with NO rungs is a supported state — a cover uploaded before the door existed, or
    // one whose encode failed. It falls back to the original, which is heavier and correct. What
    // is NOT supported is a srcset with no sizes: the browser then assumes 100vw and pulls the
    // largest rung onto the smallest board, which would undo the round while looking fixed.
    for (const b of boards) {
      if (b.hasSrcSet) {
        expect(b.hasSizes, `${b.src} offers rungs but does not say how wide it is drawn — the browser will assume 100vw and take the largest`).toBeTruthy();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('compositing', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: a full shelf stays under the layer ratchet`, async ({ page, context }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await enterShop(page);
      await loadShelf(page);

      const count = await layerCount(context, page);
      expect(count,
        `a full shelf composited ${count} layers, over the ${LAYER_MAX} ratchet. Each board costs `
        + `about 9 (preserve-3d, hidden backfaces, translateZ children) and the detail page draws `
        + `one in 17. A jump usually means a new promoted element inside BoundBook — check for a `
        + `transform, filter or will-change added to the board.`)
        .toBeLessThanOrEqual(LAYER_MAX);
    });
  }

  // THE RATCHET CAN FAIL, PROVEN HERE RATHER THAN CLAIMED. Unlike the byte budgets, the layer
  // ceiling does not trip on pre-R20 HEAD — R20 changed no compositing on purpose. A ceiling
  // nobody has watched fail is indistinguishable from a ceiling that cannot, so this case adds
  // promoted elements until it does.
  test('the layer ratchet is a real ceiling — it trips when layers are added', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterShop(page);
    await loadShelf(page);

    const before = await layerCount(context, page);
    expect(before).toBeLessThanOrEqual(LAYER_MAX);

    // One more promoted element per board, which is exactly the regression the ratchet exists
    // to catch — a transform quietly added inside BoundBook.
    await page.evaluate((n) => {
      for (const persp of document.querySelectorAll('.bb-persp')) {
        for (let i = 0; i < n; i++) {
          const d = document.createElement('div');
          d.style.cssText = 'position:absolute;inset:0;transform:translateZ(1px);will-change:transform;pointer-events:none';
          persp.appendChild(d);
        }
      }
    }, 4);
    await page.waitForTimeout(1200);

    const after = await layerCount(context, page);
    expect(after, 'adding four promoted elements per board must push the count past the ratchet').toBeGreaterThan(LAYER_MAX);
  });
});

/**
 * Composited layer count, straight from the compositor via CDP — not inferred from CSS.
 *
 * THE LISTENER GOES ON BEFORE LayerTree.enable. `enable` itself pushes the first tree, so a
 * handler attached afterwards can miss it and then wait forever for a change that already
 * happened — which is how the first draft of this helper timed out, returned an empty array,
 * and made the budget pass by measuring nothing.
 *
 * AND A MISSING TREE THROWS rather than counting zero. A ceiling that is satisfied because the
 * measurement failed is precisely the defect this file's header warns about.
 */
async function layerCount(context, page) {
  const cdp = await context.newCDPSession(page);
  let settle;
  const tree = new Promise((resolve) => { settle = resolve; });
  cdp.on('LayerTree.layerTreeDidChange', (e) => settle(e.layers || []));
  await cdp.send('DOM.enable');
  await cdp.send('LayerTree.enable');
  // The tree is only pushed on a change; nudge one, and AWAIT it so nothing is left in flight
  // when the test ends.
  await page.evaluate(() => window.scrollBy(0, 1));
  const layers = await Promise.race([
    tree,
    new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
  ]);
  await cdp.detach().catch(() => {});
  if (layers === null) throw new Error('the compositor never reported a layer tree — this measured nothing, which is not the same as passing');
  return layers.length;
}


// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ THE GRAIN IS GONE — R22.1, Ikenna's ruling of 27 August 2026, on glass
// ═══════════════════════════════════════════════════════════════════════════════
//
//   "It looks really bad... let's just go back to having dark background."
//
// He walked production on an iPhone at 01:38 and again at 05:45. THE WHOLE LAYER IS OUT —
// texture and all, not just the animation R22 removed. These cases replace R20's and R22's,
// which asserted the grain's positioning, coverage and opacity: there is nothing left to
// position or cover.
//
// ── WHY R22 DID NOT FIX IT, WHICH IS WHY THE RATCHET BELOW IS SHAPED THE WAY IT IS ────────
//
// R22.1 opened by checking three suspects against the LIVE SITE, anonymously, before changing
// a line — a service worker serving the old bundle, a deploy that never landed, or an unswept
// second grain site. All three were innocent. The live sw.js was stamped with R22's own commit;
// /bookstore is in PASS_THROUGH_PATHS so its document is never intercepted; and the live chunk
// carried R22's grain rule with no animation in it.
//
// ⭑ R22 REACHED HIS GLASS. IT FIXED THE WRONG HALF. The artefact is the TEXTURE: a 1px/2px
// stripe period resampled at DPR 3 folds into moire bands, and scrolling moves their phase, so
// it crawls whether or not anything is animating. See GRAIN_REMOVED in
// app/bookstore/components/grain.js.
//
// ── AND THE RATCHET SCANS .js, WHICH R22's DID NOT ───────────────────────────────────────
//
// R22's export ratchet walked out/ for `.html` and `.css` only. THE GRAIN RULE WAS NEVER IN
// EITHER — the shop renders its stylesheet from a client component, so the CSS lives in
// /_next/static/chunks/*.js. That ratchet could not have caught a restoration by the one route
// a restoration would actually take. This one reads the chunks.
test.describe('the grain is gone', () => {
  const GRAIN_REC = readFileSync(join(ROOT, 'app/bookstore/components/grain.js'), 'utf8');

  // The removed class names, read out of the record rather than restated here — so a round
  // that reverses the ruling reverses it in ONE file and this suite follows it there.
  const recorded = (name) => {
    const m = new RegExp(`^  ${name}: '([^']*)',$`, 'm').exec(GRAIN_REC);
    if (!m) throw new Error(`app/bookstore/components/grain.js no longer records a ${name}.`);
    return m[1];
  };
  const PAGE_GRAIN_CLASS = recorded('wasClass');                      // bookstore-grain
  const COVER_GRAIN_CLASS = (() => {
    const m = /^export const COVER_GRAIN_REMOVED = \{[\s\S]*?^  wasClass: '([^']*)',$/m.exec(GRAIN_REC);
    if (!m) throw new Error('COVER_GRAIN_REMOVED no longer records a wasClass.');
    return m[1];                                                      // bb-grain
  })();
  const KEYFRAME = recorded('wasKeyframeName');                       // grainShift

  // ⚠ THE ONE DISTINCTION THIS WHOLE FILE TURNS ON.
  //
  // A NOISE OVERLAY is rgba white-over-black at low opacity laid across a whole surface. That
  // is what banded on Ikenna's phone, and it is what must never come back — by any class name,
  // from any stylesheet, on any page.
  //
  // A PAGE BLOCK is `.bb-foreedge`: also a repeating-linear-gradient of 1px stripes, and it
  // STAYS. It is not a texture over the drawing, it IS the drawing — the book's stacked page
  // edges in OPAQUE paper tones (#e6dfc8 / #d3caae), at the object's own scale, ruled in by R16
  // and R17 and transcribed into the app from this repo. A ratchet written as "no repeating
  // gradients" would have taken the book's pages with the noise and reverted two rulings.
  //
  // So the signature below is the rgba white-and-black pair, and nothing else.
  const isNoiseGradient = (css) => {
    const out = [];
    let at = 0;
    for (;;) {
      const i = css.indexOf('repeating-linear-gradient(', at);
      if (i === -1) break;
      // Balance the parens so a nested rgba(...) does not end the slice early.
      let depth = 0; let j = i + 'repeating-linear-gradient'.length;
      for (; j < css.length; j += 1) {
        if (css[j] === '(') depth += 1;
        else if (css[j] === ')') { depth -= 1; if (depth === 0) { j += 1; break; } }
      }
      const g = css.slice(i, j);
      if (/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(g) && /rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(g)) out.push(g);
      at = i + 1;
    }
    return out;
  };

  // The scanner, as a pure function so the case below can prove it able to fail without
  // touching out/.
  const grainOffences = (text) => {
    const hits = [];
    if (text.includes(PAGE_GRAIN_CLASS)) hits.push(`the page grain's class (${PAGE_GRAIN_CLASS})`);
    if (text.includes(COVER_GRAIN_CLASS)) hits.push(`the cover grain's class (${COVER_GRAIN_CLASS})`);
    if (text.includes(KEYFRAME)) hits.push(`the shimmer's keyframe (${KEYFRAME})`);
    if (/feTurbulence|fractalNoise/.test(text)) hits.push('an SVG noise filter');
    const noise = isNoiseGradient(text);
    if (noise.length) hits.push(`a white-over-black stripe gradient: ${noise[0].slice(0, 90)}`);
    return hits;
  };

  for (const pg of GRAIN_PAGES) {
    for (const vp of VIEWPORTS) {
      test(`${pg.name} ${vp.name}: plain dark ground, and no stripe layer from any source`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await enterShop(page);

        let target = '/bookstore';
        if (pg.path === 'resolve') {
          // Go via the shop so the slug is one it is actually showing.
          await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
          await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
          target = `/bookstore/${await liveDetailSlug(page)}`;
        }
        await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
        await expect(page.locator(pg.ready).first()).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(1200);

        const seen = await page.evaluate(() => {
          const stripes = [];
          for (const el of document.querySelectorAll('*')) {
            const cs = getComputedStyle(el);
            for (const src of [cs.backgroundImage, cs.background]) {
              if (src && src.includes('repeating-linear-gradient')) {
                stripes.push({ tag: el.tagName, cls: el.className?.toString?.().slice(0, 40) || '', css: src });
              }
            }
            // ::before / ::after are where a grain layer hides when it has no element of its
            // own — which is exactly the arrangement public/beta.html carried until R22.1.
            for (const pseudo of ['::before', '::after']) {
              const ps = getComputedStyle(el, pseudo);
              const bg = ps.backgroundImage;
              if (bg && bg !== 'none' && (bg.includes('repeating-linear-gradient') || bg.includes('feTurbulence'))) {
                stripes.push({ tag: `${el.tagName}${pseudo}`, cls: el.className?.toString?.().slice(0, 40) || '', css: bg });
              }
            }
          }
          const main = document.querySelector('main');
          return {
            pageGrain: document.querySelectorAll('.bookstore-grain').length,
            coverGrain: document.querySelectorAll('.bb-grain').length,
            mainBg: main ? getComputedStyle(main).backgroundColor : null,
            grainAnimationsRunning: document.getAnimations()
              .map((a) => a.animationName || '').filter((n) => /grain/i.test(n)),
            stripes,
          };
        });

        // THE RULING ITSELF, at the DOM.
        expect(seen.pageGrain,
          'the page grain overlay is gone — Ikenna\'s ruling of 27 Aug 2026, on glass. '
          + 'Read GRAIN_REMOVED in app/bookstore/components/grain.js before restoring it: the '
          + 'artefact was the TEXTURE, not the animation R22 removed.').toBe(0);
        expect(seen.coverGrain, 'the cover grain is gone from every board — see COVER_GRAIN_REMOVED').toBe(0);
        expect(seen.grainAnimationsRunning, 'nothing may run a grain keyframe').toEqual([]);

        // THE GROUND. "Let's just go back to having dark background" — this is that background,
        // and it is the same #070707 the pages already declared under the grain.
        expect(seen.mainBg, '<main> must paint the plain dark ground').toBe('rgb(7, 7, 7)');

        // AND NO STRIPE LAYER FROM ANY SOURCE. The fore-edge is allowed and everything else is
        // not — see the note on isNoiseGradient above for why that is the line.
        const noise = seen.stripes.filter((s) => isNoiseGradient(s.css).length > 0);
        expect(noise.map((s) => `${s.tag}.${s.cls}`),
          'a white-over-black stripe layer is drawing somewhere on this page. That is the '
          + 'texture that banded on an iPhone at DPR 3, whatever it is called now.').toEqual([]);
      });
    }
  }

  test('⛔ THE RATCHET — no grain layer, of any kind, anywhere in the export', async () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // Every HTML file, every stylesheet AND EVERY CHUNK in out/.
    //
    // The .js half is the whole point. R22's ratchet scanned .html and .css, and the grain rule
    // has never been in either of them — the shop renders its stylesheet from a client
    // component, so it lives in /_next/static/chunks/*.js. A restoration by the one route a
    // restoration actually takes would have sailed straight past it.
    //
    // It catches four things: either removed class name, the shimmer's keyframe name, an SVG
    // noise filter (which is what public/beta.html carried, and which the ruling named
    // explicitly), and a white-over-black stripe gradient under ANY name at all — because the
    // easiest way back is not to restore `.bookstore-grain`, it is to write the same two
    // gradients on `.shop-texture`.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const { readdirSync, statSync } = await import('node:fs');
    const OUT = join(ROOT, 'out');
    let exists = true;
    try { statSync(OUT); } catch { exists = false; }
    expect(exists, 'out/ must exist — this suite runs against the real static export').toBeTruthy();

    const files = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        // .map files are sourcemaps of vendored third-party code (pdf.js among them) and are
        // not shipped CSS. Scanning them reports on libraries nobody here drew.
        if (/\.(html|css|js)$/.test(name)) files.push(full);
      }
    })(OUT);
    expect(files.length, 'the export must contain HTML, CSS and chunks to scan').toBeGreaterThan(50);
    expect(files.some((f) => f.includes('/_next/static/chunks/')),
      'the chunks are where the grain rule actually lived — this scan must reach them').toBeTruthy();

    const offenders = [];
    for (const f of files) {
      // public/vendor/** is third-party reader code, shipped verbatim and not this house's
      // drawing. Named rather than silently skipped.
      if (f.includes('/vendor/')) continue;
      const hits = grainOffences(readFileSync(f, 'utf8'));
      if (hits.length) offenders.push(`${f.slice(OUT.length)} — ${hits.join('; ')}`);
    }
    expect(offenders,
      'a grain layer is back in the export. Ikenna ruled it out ENTIRELY on 27 Aug 2026, on '
      + 'glass: "it looks really bad... let\'s just go back to having dark background". Texture '
      + 'and animation both. See GRAIN_REMOVED in app/bookstore/components/grain.js.')
      .toEqual([]);
  });

  test('the ratchet is a real ceiling — it trips on each of the four ways back', async () => {
    // A ratchet nobody has ever seen fail is a number, not a test. Each string below is a
    // genuine route back, and the last one is the one that matters most: the same texture under
    // a name this suite has never heard of.
    const ways = {
      'the page grain restored verbatim': PAGE_GRAIN_REMOVED_CSS(),
      'the cover grain restored verbatim': COVER_GRAIN_REMOVED_CSS(),
      'the shimmer restored': '@keyframes grainShift{0%{transform:translate(0,0)}}',
      'an SVG noise filter': "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9'/></filter>",
      'the same texture under a new name': '.shop-texture{background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.6) 0,rgba(0,0,0,.6) 1px,transparent 1px,transparent 2px)}',
    };
    for (const [why, css] of Object.entries(ways)) {
      expect(grainOffences(css).length, `the ratchet must catch: ${why}`).toBeGreaterThan(0);
    }
    // And it must NOT catch the book's page block, which is the drawing and stays.
    expect(grainOffences('.bb-foreedge{background:repeating-linear-gradient(90deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px)}'),
      'the fore-edge is the book\'s stacked pages, not a texture. R16/R17 ruled it in and the '
      + 'app transcribed it from this repo — a ratchet that takes it out reverts two rulings.')
      .toEqual([]);
  });

  function PAGE_GRAIN_REMOVED_CSS() {
    const m = /^export const PAGE_GRAIN_REMOVED = \{[\s\S]*?^  wasCss: '((?:[^'\\]|\\.)*)',$/m.exec(GRAIN_REC);
    if (!m) throw new Error('PAGE_GRAIN_REMOVED no longer records a wasCss.');
    return m[1];
  }
  function COVER_GRAIN_REMOVED_CSS() {
    const m = /^export const COVER_GRAIN_REMOVED = \{[\s\S]*?^  wasCss: '((?:[^'\\]|\\.)*)',$/m.exec(GRAIN_REC);
    if (!m) throw new Error('COVER_GRAIN_REMOVED no longer records a wasCss.');
    return m[1];
  }

  test('the record is imported by NOTHING, so it cannot be rendered back by accident', async () => {
    // app/bookstore/components/grain.js is now a record, not a component. Two consequences, and
    // both are load-bearing: an unimported module cannot be rendered, and the removed strings it
    // holds verbatim never reach the bundle — which is what lets the ratchet above scan the
    // whole export for exactly those strings without the record tripping it.
    const { readdirSync, statSync } = await import('node:fs');
    const importers = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (!/\.jsx?$/.test(name)) continue;
        if (full.endsWith('components/grain.js')) continue;
        const src = readFileSync(full, 'utf8');
        if (/from\s+['"][^'"]*components\/grain['"]/.test(src)) importers.push(full.slice(ROOT.length));
      }
    })(join(ROOT, 'app'));
    expect(importers,
      'nothing may import the grain record. It exists to be READ — by a person, and by the '
      + 'ratchet above, out of the source. An import puts the removed CSS back in the bundle.')
      .toEqual([]);
  });

  test('the service worker cannot serve a returning reader a stale grain', async () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // THE FIRST SUSPECT IN R22.1, AND IT WAS INNOCENT — pinned here so it stays that way.
    //
    // The fear was reasonable: an installed SW that cached shop documents or chunks would keep
    // serving the pre-fix bundle for ever and no ruling would ever reach a returning reader.
    // It cannot, for two independent reasons, and this case asserts BOTH so that losing either
    // one is a red test rather than a silent regression that only shows up on someone's phone.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const SW = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');

    // 1. THE SHOP IS NEVER INTERCEPTED. isPassThrough returns before any respondWith can be
    //    reached, so /bookstore and /bookstore/{slug} are handled by the browser as if no
    //    worker existed — online or off.
    const list = /const PASS_THROUGH_PATHS = \[([\s\S]*?)\];/.exec(SW);
    expect(list, 'public/sw.js no longer declares PASS_THROUGH_PATHS').not.toBeNull();
    expect(list[1].includes("'/bookstore'"),
      'the shop must stay in PASS_THROUGH_PATHS — it is what guarantees no installed worker '
      + 'can serve a returning reader yesterday\'s shop').toBeTruthy();

    // 2. AND EVEN THE CHUNKS CANNOT GO STALE. /_next/static/* is the one cache-first path in
    //    the file, which is only safe because the filenames are content-hashed: a rebuilt grain
    //    rule arrives at a URL no cache has ever seen. The per-build cache key and the
    //    activate-time sweep are the belt to that brace.
    expect(/const SHELL_CACHE = `cs-shell-v\$\{BUILD\}`/.test(SW),
      'the shell cache must be keyed per build').toBeTruthy();
    expect(/keys\.filter\(\(k\) => k\.startsWith\(CACHE_PREFIX\) && k !== SHELL_CACHE\)\.map\(\(k\) => caches\.delete\(k\)\)/.test(SW),
      'activate must delete every cache that is not this build\'s').toBeTruthy();

    // 3. AND NO DOCUMENT IS EVER CACHE-FIRST. The one rule the whole file is built on. If this
    //    ever changes, a stale shell becomes reachable and everything above stops mattering.
    expect(/if \(event\.request\.mode === 'navigate'\) \{\s*event\.respondWith\(navigateNetworkFirst\(event\)\);/.test(SW),
      'navigations must stay network-first').toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R22B — THE OPENING LINE TURNS LIKE A PAGE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Per the approved mock. What is assertable headlessly is not "does it look right" — that is
// Ikenna's, on glass — but the three properties a later edit would break without anyone
// noticing:
//
//   · it moves with TRANSFORM AND OPACITY and nothing else. A round that reaches for `top` or
//     `margin` because it is easier gets the same look and a repaint on every frame, which is
//     exactly the cost R22A just removed from this page.
//   · the FRAME does not move. The quotation marks, the kicker and the blockquote hold still
//     while the words travel between them; that is the whole reading of the effect.
//   · REDUCED MOTION gets no transition at all — not a shorter one.
test.describe('the opening line turns like a page', () => {
  const RAIL_SRC = readFileSync(join(ROOT, 'app/bookstore/page.js'), 'utf8');
  const railConst = (name) => {
    const m = new RegExp(`^  ${name}: ('([^']*)'|(\\d+)),$`, 'm').exec(RAIL_SRC);
    if (!m) throw new Error(`RAIL_TURN no longer records ${name}.`);
    return m[2] ?? Number(m[3]);
  };
  const DURATION_MS = railConst('durationMs');
  const EASING = railConst('easing');
  const DELAY_MS = railConst('attributionDelayMs');

  async function openRail(page) {
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    const rail = page.locator('.rail-words');
    // The rail needs two titles with opening lines to render at all — see `linesPool`. On a
    // catalogue that has fewer, the whole section is absent and there is nothing to assert.
    // Reported rather than silently passing: a suite that skips without saying so is a suite
    // that stops covering the thing the day the data changes.
    if (await rail.count() === 0) {
      test.skip(true, 'the live catalogue has fewer than two titles carrying an opening line');
    }
    await rail.first().scrollIntoViewIfNeeded();
    return rail.first();
  }

  test('the words move on transform and opacity, and on nothing else', async ({ page }) => {
    const words = await openRail(page);
    const cs = await words.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        props: s.transitionProperty,
        duration: s.transitionDuration,
        timing: s.transitionTimingFunction,
        display: s.display,
      };
    });

    const props = cs.props.split(',').map((p) => p.trim()).filter(Boolean);
    expect(props.sort(), 'only opacity and transform may be transitioned — anything else repaints')
      .toEqual(['opacity', 'transform']);
    for (const d of cs.duration.split(',').map((x) => x.trim())) {
      expect(d).toBe(`${DURATION_MS / 1000}s`);
    }
    // Normalised on BOTH sides: the record writes `cubic-bezier(.4,0,.2,1)` and Chrome reports
    // `cubic-bezier(0.4, 0, 0.2, 1)` — the same curve, spelled two ways. Comparing the numbers
    // rather than the strings is what keeps this from being a test about whitespace.
    const curve = (t) => (t.match(/-?\d*\.?\d+/g) || []).map(Number).join(',');
    for (const t of cs.timing.split(/,(?![^(]*\))/).map((x) => x.trim())) {
      expect(curve(t), 'the words must use the mock\'s curve').toBe(curve(EASING));
    }
    // A transform on an inline box does nothing at all, and the failure is silent: the class
    // lands, the opacity fades, and the words simply do not travel.
    expect(cs.display, 'the words must be an inline-block or the translate is a no-op').toBe('inline-block');
  });

  test('the attribution follows a beat behind', async ({ page }) => {
    const words = await openRail(page);
    await words.page().locator('.rail-ask .rail-btn').click();        // "Whose line is this?"
    const attrib = words.page().locator('.rail-reveal.rail-attrib');
    await expect(attrib).toBeVisible({ timeout: 10000 });
    const delays = await attrib.evaluate((el) => getComputedStyle(el).transitionDelay);
    for (const d of delays.split(',').map((x) => x.trim())) {
      expect(d, 'the attribution lags the words').toBe(`${DELAY_MS / 1000}s`);
    }
  });

  test('THE FRAME DOES NOT MOVE — the marks, the kicker and the blockquote hold still', async ({ page }) => {
    const words = await openRail(page);
    const page_ = words.page();
    for (const sel of ['.rail-eyebrow', '.rail-quote', '.rail-mark']) {
      const el = page_.locator(sel).first();
      await expect(el).toBeVisible();
      const cs = await el.evaluate((n) => {
        const s = getComputedStyle(n);
        return { props: s.transitionProperty, duration: s.transitionDuration, transform: s.transform };
      });
      // `all 0s` / `none` both read as "nothing is transitioned". What must not appear is a
      // real duration on a real property.
      const moving = cs.props.split(',').map((p) => p.trim())
        .some((p, i) => p !== 'none' && (cs.duration.split(',')[i] || '0s').trim() !== '0s');
      expect(moving, `${sel} must not transition — only the words travel through the frame`).toBeFalsy();
      expect(cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)',
        `${sel} must sit at its resting transform`).toBeTruthy();
    }
  });

  test('the line actually changes, and the marks stay where they were', async ({ page }) => {
    const words = await openRail(page);
    const page_ = words.page();
    const before = await words.textContent();
    // ⚠ offsetTop/offsetLeft, NOT boundingBox(). A bounding box is viewport-relative, so it
    // moves whenever the page happens to have scrolled between the two readings — which it
    // does, because clicking a control scrolls it into view. This assertion is about LAYOUT,
    // and the layout number is the one that does not know where the window is.
    const markBefore = await page_.locator('.rail-mark').first()
      .evaluate((el) => ({ x: el.offsetLeft, y: el.offsetTop }));

    // ⚠ R22.1B — THE TWO CLICKS ARE NO LONGER BACK TO BACK, and that is the change under test
    // rather than a workaround for it. The reveal used to be a bare setState and landed in the
    // same frame; it now runs the SAME out/in turn as a line change, so pressing "Another line"
    // during those 420ms is a mid-turn press and is ignored by design. The test waits for the
    // answer to arrive, which is what a reader does.
    await page_.locator('.rail-ask .rail-btn').click();               // "Whose line is this?"
    await expect(page_.locator('.rail-answer')).toBeVisible({ timeout: 10000 });
    await page_.locator('.rail-reveal .rail-btn').click();            // "Another line"
    await page_.waitForTimeout(DURATION_MS + 300);

    expect(await words.textContent(), 'the rail must be showing a different line').not.toBe(before);
    const markAfter = await page_.locator('.rail-mark').first()
      .evaluate((el) => ({ x: el.offsetLeft, y: el.offsetTop }));
    // The frame is a frame. A mark that moved would mean the quotation marks had been carried
    // out with the words, which is the version of this effect the mock rejected — or, since
    // R22.1B, that the quote is being centred inside its locked zone rather than sitting at the
    // top of it, which moves the frame by half the difference between the longest line and this
    // one. See .rail-quote-zone in app/bookstore/page.js.
    expect(Math.abs(markAfter.x - markBefore.x), 'the opening quotation mark moved horizontally').toBeLessThan(1.5);
    expect(Math.abs(markAfter.y - markBefore.y), 'the opening quotation mark moved vertically').toBeLessThan(1.5);
  });

  test('reduced motion produces NO transition — not a faster one', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    try {
      const words = await openRail(page);
      const cs = await words.evaluate((el) => {
        const s = getComputedStyle(el);
        return { duration: s.transitionDuration, transform: s.transform, opacity: s.opacity };
      });
      for (const d of cs.duration.split(',').map((x) => x.trim())) {
        expect(d, 'a reader who asked for less motion gets the swap, not a slower turn').toBe('0s');
      }
      expect(cs.opacity).toBe('1');
    } finally {
      await ctx.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ R22.1B — THE STAGE OWNS THE HEIGHT, AND NOTHING BELOW IT EVER MOVES
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling of 27 August 2026, after the same fault appeared on the app and was then
// confirmed on the web: every line change AND every reveal resized the section, so the FICTION
// heading, the genre tabs and the whole shelf jumped on every turn.
//
// R22B's page-turn was never the problem — the BOX around it was. A four-line opening quote and
// a one-liner are three line-boxes apart, and "WHOSE LINE IS THIS?" is one button where the
// revealed state is a title, an author, a gap and "ANOTHER LINE". Both resized the section, and
// the turn's own 420ms made the jump read as part of the effect.
//
// ── WHAT THESE CASES ARE, AND WHY THEY ARE THE RIGHT INSTRUMENT ──────────────────────────
//
// This is one of the rare motion rulings that IS fully assertable headlessly, because it is a
// statement about numbers rather than about feel: two boxes must have the same height and the
// same offsetTop in every state the rail can be in. So the suite walks EVERY line in the live
// pool, in BOTH states, at BOTH breakpoints, and demands the numbers not move.
//
// ⭑ THE WALK RUNS UNDER reducedMotion:'reduce', AND THAT IS A FEATURE OF THE TEST, NOT A
// SHORTCUT. Under reduced motion the component swaps instantly — no 420ms wait per turn — so
// twenty-odd lines in two states is seconds rather than a minute. It also happens to assert the
// half of the ruling that is easiest to lose: prefers-reduced-motion swaps instantly AND THE
// HEIGHT STILL NEVER CHANGES. Reduced motion is not a licence to reintroduce the shove.
//
// The normal-motion case below it then does two turns and a reveal at full speed, so the
// animated path is covered too.
test.describe('the opening-line stage never moves the page', () => {
  // The element after the rail is the fiction shelf — its heading, its genre tabs and its
  // boards. That is precisely what Ikenna watched jump, so it is what gets measured.
  const readStage = async (page) => page.evaluate(() => {
    const rail = document.querySelector('.rail');
    if (!rail) return null;
    const next = rail.nextElementSibling;
    return {
      railH: Math.round(rail.getBoundingClientRect().height),
      stageH: Math.round(document.querySelector('.rail-stage').getBoundingClientRect().height),
      // offsetTop is measured against the offsetParent and is unaffected by scroll position,
      // which is what makes it the honest number here — a boundingClientRect would move
      // whenever the page happened to be scrolled.
      nextTop: next ? next.offsetTop : null,
      nextTag: next ? `${next.tagName}.${next.className?.toString?.().slice(0, 30) || ''}` : null,
      line: document.querySelector('.rail-words')?.textContent || '',
      revealed: !!document.querySelector('.rail-reveal'),
    };
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.name}: every line, both states, one height`, async ({ browser }) => {
      // reducedMotion so the walk is instant — see the note above. The ruling is asserted
      // FOR this mode as well as through it.
      const ctx = await browser.newContext({
        reducedMotion: 'reduce',
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await ctx.newPage();
      try {
        await enterShop(page);
        await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
        await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
        const rail = page.locator('.rail-words');
        if (await rail.count() === 0) {
          test.skip(true, 'the live catalogue has fewer than two titles carrying an opening line');
        }
        // The stage is sized from a probe measured against the real webfonts; give them the
        // chance to land before the first reading, or the baseline is Georgia's.
        await page.evaluate(() => document.fonts?.ready);
        await page.waitForTimeout(400);

        const poolSize = await page.evaluate(() => {
          // The pool is live. Reading its size from the component is not possible from here, so
          // the walk simply goes round until it sees its first line again — see below.
          return document.querySelectorAll('.rail-words').length;
        });
        expect(poolSize, 'exactly one line shows at a time').toBe(1);

        const baseline = await readStage(page);
        expect(baseline, 'the rail must be on the page').not.toBeNull();
        expect(baseline.nextTop,
          'the rail must have something after it — otherwise this case is asserting nothing')
          .not.toBeNull();

        const seen = [];
        const firstLine = baseline.line;
        // A hard ceiling so a catalogue that grows to hundreds cannot turn this into a
        // twenty-minute case. It is REPORTED rather than silently applied: a truncated walk
        // that reads as full coverage is worse than no walk.
        const CEILING = 40;
        let turns = 0;

        for (;;) {
          // BOTH STATES OF THE CURRENT LINE. The reveal is the half R22B never sized for.
          const asking = await readStage(page);
          expect(asking.revealed, 'a fresh line starts un-revealed').toBeFalsy();
          seen.push(asking);

          await page.locator('.rail-ask .rail-btn').click();
          await expect(page.locator('.rail-answer')).toBeVisible({ timeout: 10000 });
          seen.push(await readStage(page));

          await page.locator('.rail-reveal .rail-btn').click();
          await expect(page.locator('.rail-ask .rail-btn')).toBeVisible({ timeout: 10000 });
          turns += 1;

          const now = await readStage(page);
          if (now.line === firstLine) break;         // all the way round the pool
          if (turns >= CEILING) {
            console.log(`[rail] stopped at ${CEILING} lines — the pool is larger than the ceiling`);
            break;
          }
        }

        expect(turns, 'the walk must have turned the line at least twice').toBeGreaterThanOrEqual(2);
        expect(seen.length, 'every line must have been read in both states').toBe(turns * 2);

        // ── THE RULING ──────────────────────────────────────────────────────────────────
        // Identical, not "close". These are integers read off the same DOM in the same
        // viewport; a single pixel of drift here is a line of text changing the layout, which
        // is the whole fault.
        const railHeights = [...new Set(seen.map((s) => s.railH))];
        const stageHeights = [...new Set(seen.map((s) => s.stageH))];
        const nextTops = [...new Set(seen.map((s) => s.nextTop))];

        expect(stageHeights,
          `the stage changed height across ${turns} lines in both states. It owns a FIXED height — `
          + 'Ikenna\'s ruling of 27 Aug 2026. See RAIL_STAGE in app/bookstore/page.js.')
          .toEqual([baseline.stageH]);
        expect(railHeights,
          'the whole Opening Lines section changed height — the eyebrow and the padding are '
          + 'fixed, so this means the stage did').toEqual([baseline.railH]);
        expect(nextTops,
          `${baseline.nextTag} moved. That is the FICTION heading, the genre tabs and the shelf `
          + 'being shoved down the page on a line change or a reveal, which is exactly what was '
          + 'ruled out.').toEqual([baseline.nextTop]);

        // And the walk really did see different lines — otherwise the numbers above are all
        // measurements of the same state.
        expect(new Set(seen.map((s) => s.line)).size,
          'the walk must have shown more than one line, or it proved nothing')
          .toBeGreaterThanOrEqual(2);
      } finally {
        await ctx.close();
      }
    });
  }

  test('at full speed too — the turn and the reveal both happen inside the stage', async ({ page }) => {
    // The reduced-motion walk above covers every line. This one covers the ANIMATED path, where
    // a height change would be masked by 420ms of motion and would read as part of the effect.
    await page.setViewportSize({ width: 390, height: 844 });
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    if (await page.locator('.rail-words').count() === 0) {
      test.skip(true, 'the live catalogue has fewer than two titles carrying an opening line');
    }
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(400);

    const readings = [await readStage(page)];
    for (let n = 0; n < 2; n += 1) {
      await page.locator('.rail-ask .rail-btn').click();
      await expect(page.locator('.rail-answer')).toBeVisible({ timeout: 10000 });
      readings.push(await readStage(page));
      await page.locator('.rail-reveal .rail-btn').click();
      await expect(page.locator('.rail-ask .rail-btn')).toBeVisible({ timeout: 10000 });
      readings.push(await readStage(page));
    }

    expect([...new Set(readings.map((r) => r.stageH))],
      'the stage changed height during an animated turn or reveal').toEqual([readings[0].stageH]);
    expect([...new Set(readings.map((r) => r.nextTop))],
      'the shelf below moved during an animated turn or reveal').toEqual([readings[0].nextTop]);
  });

  test('the height is measured ONCE and locked — the probe is not left in the DOM', async ({ page }) => {
    // The stage is sized from a hidden probe that renders every line in both states. It must be
    // MOUNTED long enough to be measured and gone afterwards: a probe left standing is a second
    // copy of the whole pool in the document, on the page R20 spent a round making lighter.
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    if (await page.locator('.rail-words').count() === 0) {
      test.skip(true, 'the live catalogue has fewer than two titles carrying an opening line');
    }
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(600);

    expect(await page.locator('.rail-probe').count(),
      'the probe must be unmounted once the stage is locked').toBe(0);

    // And the lock really is a declared height rather than the content sizing the box.
    const vars = await page.evaluate(() => {
      const stage = document.querySelector('.rail-stage');
      const q = document.querySelector('.rail-quote-zone');
      const c = document.querySelector('.rail-controls-zone');
      return {
        quoteVar: stage.style.getPropertyValue('--rail-quote-h'),
        ctrlVar: stage.style.getPropertyValue('--rail-ctrl-h'),
        quoteH: getComputedStyle(q).height,
        ctrlH: getComputedStyle(c).height,
      };
    });
    expect(vars.quoteVar, 'the quote zone must carry a measured, locked height').toMatch(/^\d+px$/);
    expect(vars.ctrlVar, 'the controls zone must carry a measured, locked height').toMatch(/^\d+px$/);
    expect(vars.quoteH).toBe(vars.quoteVar);
    expect(vars.ctrlH).toBe(vars.ctrlVar);

    // A turn must not re-measure. If it does, the lock is live-resizing wearing a lock's name.
    await page.locator('.rail-ask .rail-btn').click();
    await expect(page.locator('.rail-answer')).toBeVisible({ timeout: 10000 });
    const after = await page.evaluate(() => document.querySelector('.rail-stage').style.getPropertyValue('--rail-quote-h'));
    expect(after, 'a reveal must not re-measure the stage').toBe(vars.quoteVar);
    expect(await page.locator('.rail-probe').count(),
      'a reveal must not remount the probe').toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ R22.1C — THE VIEW-TRANSITION OPT-IN IS WITHHELD FROM SHIPPED OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 27 August 2026. Three reasons, and the third settles it:
//
//   · the pair-or-nothing guard was proven in CHROMIUM ONLY, and Safari is what he reads on;
//   · the pair cannot form at all until R9 unwinds the launch gate's STATE SHAPE, so today the
//     opt-in buys nothing and risks the fallback;
//   · the app shipped this exact effect and it FAILED ON GLASS as an unpaired translucent
//     dissolve — which is not a prediction about the unguarded fallback, it is a report of it.
//
// So R22C's cases have been replaced rather than deleted. They asserted that the opt-in WAS in
// every parsed head, that the arriving board was named by rule, and that a navigation offered a
// transition. All three now assert the opposite, plus the thing that actually matters for R9:
// THAT NOTHING WAS LOST. The mechanism is intact behind one const, and R22C's two hard-won
// findings are still on the record where the next round will look for them.
//
// ── WHAT MUST NOT BE RELEARNED ───────────────────────────────────────────────────────────
//   · THE OPT-IN MUST BE IN THE PARSED <head>. In a <style> React renders, `pagereveal` on the
//     arriving document finds nothing and the destination declines, silently, every time.
//   · THE BOARD MUST EXIST AT FIRST RENDER — parse or a task after `pagereveal`, never a frame
//     later. The gate renders the whole shop in an effect, and flipping GATE_ENABLED does not
//     help: `unlocked` still starts false and is still set in an effect. That is R9's work.
test.describe('the view transition is withheld until R9', () => {
  const BT_SRC = readFileSync(join(ROOT, 'app/bookstore/components/bookTransition.js'), 'utf8');
  const btConst = (name) => {
    const m = new RegExp(`^export const ${name} = '([^']+)';`, 'm').exec(BT_SRC);
    if (!m) throw new Error(`bookTransition.js no longer exports a string const named ${name}.`);
    return m[1];
  };
  const VT_NAME = btConst('BOOK_VT_NAME');
  const SLUG_ATTR = btConst('BOOK_SLUG_ATTR');
  const ARRIVAL_ATTR = btConst('BOOK_ARRIVAL_ATTR');

  // ⚠ THE ONE EXEMPTION, NAMED RATHER THAN ASSUMED.
  //
  // /voices carries its OWN `@view-transition` — the island morph, a separate feature with its
  // own fence (that layout wraps /voices and /voices/{slug} and nothing else), its own
  // reduced-motion nesting, and its own approval. It is not the book transition, it was not
  // what failed on the app, and R22.1C is not a ruling about it. Removing it here would have
  // been a round quietly reverting a shipped feature nobody complained about.
  //
  // It is exempted BY PATH, so a book-transition opt-in cannot hide behind the exemption by
  // being emitted somewhere else in the export.
  const VOICES_EXEMPT = (rel) => rel === '/voices.html' || rel === '/voices.txt'
    || rel.startsWith('/voices/') || rel.startsWith('/voices.');

  test('⛔ no view-transition opt-in anywhere in the export, outside the voices morph', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const OUT = join(ROOT, 'out');
    let exists = true;
    try { statSync(OUT); } catch { exists = false; }
    expect(exists, 'out/ must exist — this suite runs against the real static export').toBeTruthy();

    const offenders = [];
    let voices = 0;
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (!/\.(html|css|js|txt)$/.test(name)) continue;
        if (full.includes('/vendor/')) continue;
        const text = readFileSync(full, 'utf8');
        if (!text.includes('@view-transition')) continue;
        const rel = full.slice(OUT.length);
        if (VOICES_EXEMPT(rel)) { voices += 1; continue; }
        offenders.push(rel);
      }
    })(OUT);

    expect(offenders,
      'a @view-transition opt-in is in the shipped export. It is withheld until R9 — the guard '
      + 'was proven in Chromium only, the pair cannot form until the launch gate is unwound, '
      + 'and the app shipped this effect and it failed on glass as an unpaired dissolve. See '
      + 'BOOK_TRANSITION_WITHHELD in app/bookstore/components/bookTransition.js.')
      .toEqual([]);

    // The exemption must be a REAL exemption for a REAL feature. If /voices ever stops opting
    // in, this list is dead code pretending to be a carve-out and should go.
    expect(voices,
      'the voices morph is the one exemption and it must still be there — otherwise this '
      + 'carve-out is protecting nothing').toBeGreaterThan(0);
  });

  test('neither the opt-in nor the guard is emitted into any document head', async () => {
    // The two elements lived in app/layout.js's static <head>, which is the ONLY place early
    // enough for `pagereveal` on the arriving document — see the header note. Withholding them
    // therefore means withholding them from there.
    const { readFileSync: rf } = await import('node:fs');
    for (const rel of ['out/bookstore.html', 'out/index.html']) {
      const html = rf(join(ROOT, rel), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head.includes('@view-transition'), `${rel}: the opt-in must not be emitted`).toBeFalsy();
      expect(head.includes('pagereveal'), `${rel}: the pair-or-nothing guard must not be emitted`).toBeFalsy();
    }
  });

  test('a shelf → detail navigation is a plain instant swap', async ({ page }) => {
    // ⭑ THE BEHAVIOURAL ASSERTION, and the one that would catch a partial removal. Without the
    // opt-in the UA does not begin a cross-document transition at all, so `pageswap` carries no
    // `viewTransition`. That is the plain swap — the same path a browser with no support takes.
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    const slug = await liveDetailSlug(page);

    // ⚠ THE VERDICT HAS TO SURVIVE THE NAVIGATION IT IS ABOUT. `pageswap` fires on the OUTGOING
    // document as it is being torn down, so a variable on `window` — and the evaluate holding
    // it — die with the page. sessionStorage is same-origin and survives, and it is read on the
    // other side. (Awaiting inside the evaluate that triggers the click fails outright:
    // "Execution context was destroyed".)
    await page.evaluate(() => {
      try { sessionStorage.removeItem('cs_swap_vt'); } catch { /* private mode */ }
      window.addEventListener('pageswap', (e) => {
        try { sessionStorage.setItem('cs_swap_vt', e.viewTransition ? 'yes' : 'no'); } catch { /* ignore */ }
      });
      const a = document.createElement('a');
      a.id = 'cs-nav-probe';
      a.href = '/bookstore';
      a.textContent = 'go';
      a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff;color:#000';
      document.body.appendChild(a);
    });
    await page.evaluate((s) => {
      document.getElementById('cs-nav-probe').href = `/bookstore/${s}`;
    }, slug);

    await page.click('#cs-nav-probe');
    await page.waitForURL(`**/bookstore/${slug}`, { timeout: 30000 });
    await expect(page.locator('.bd-cta').first()).toBeVisible({ timeout: 30000 });

    const seen = await page.evaluate(() => {
      try { return sessionStorage.getItem('cs_swap_vt'); } catch { return null; }
    });
    // null = pageswap never fired at all; 'no' = it fired with no transition offered. Either is
    // a plain navigation. 'yes' is the thing that must not happen.
    expect(seen, 'a navigation must not offer a view transition while the opt-in is withheld')
      .not.toBe('yes');
  });

  test('the shop ships none of the pair\'s CSS either', async ({ page }) => {
    // BOOK_TRANSITION_CSS is inert without the opt-in, but shipping it would leave the export
    // reading as though the feature were live and would let a later round restore the effect by
    // adding two lines to a <head> without anyone re-reading the ruling. One const governs
    // both, so both are checked.
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });

    const found = await page.evaluate((name) => {
      const hits = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }  // a cross-origin font sheet
        for (const r of rules) {
          if (r.cssText && (r.cssText.includes(name) || r.cssText.includes('::view-transition'))) {
            hits.push(r.cssText.slice(0, 120));
          }
        }
      }
      return hits;
    }, VT_NAME);
    expect(found, 'the pair\'s CSS must not be on the shop while the transition is withheld').toEqual([]);

    // And no board is carrying the name, so nothing is half-armed.
    const named = await page.evaluate((n) => document.querySelectorAll(`[style*="${n}"]`).length, VT_NAME);
    expect(named, 'no board may be named while the transition is withheld').toBe(0);
  });

  test('the flag is the ONLY thing off — the mechanism is intact for R9', async () => {
    // ⭑ THIS IS THE CASE THAT PROTECTS THE DAY THE CURTAIN COMES DOWN. R22C's cost was not the
    // code, it was the two findings; a round that "cleaned up" this module would make R9 pay
    // for them again.
    expect(/^export const BOOK_TRANSITION_SHIPPED = false;$/m.test(BT_SRC),
      'BOOK_TRANSITION_SHIPPED must be a single, greppable const — it is the whole gate').toBeTruthy();

    // The built transition, still built.
    for (const name of ['BOOK_TRANSITION_CSS', 'VIEW_TRANSITION_OPT_IN_CSS', 'VIEW_TRANSITION_GUARD_JS',
      'SHIPPED_BOOK_TRANSITION_CSS', 'armBookTransition', 'disarmBookTransition', 'installBookTransitions']) {
      expect(BT_SRC.includes(`export const ${name}`) || BT_SRC.includes(`export function ${name}`),
        `${name} must survive — flipping the flag on the day must be a flip, not a rebuild`).toBeTruthy();
    }
    // The pair's two ends, and the arriving board's rule, still named by constant.
    expect(BT_SRC.includes(`[${ARRIVAL_ATTR}] `), 'the arriving board is still named by rule').toBeTruthy();
    expect(BT_SRC.includes(SLUG_ATTR), 'the outgoing board is still findable by slug').toBeTruthy();

    // AND THE TWO FINDINGS, ON THE RECORD AS DATA rather than only in a comment — so this is a
    // test that fails when they are dropped, not a paragraph that quietly stops being true.
    const findings = /findings: \[([\s\S]*?)\],/.exec(BT_SRC);
    expect(findings, 'BOOK_TRANSITION_WITHHELD must record R22C\'s findings').not.toBeNull();
    expect(findings[1].toLowerCase()).toContain('parsed head');
    expect(findings[1].toLowerCase()).toContain('first rendering opportunity after pagereveal');

    // The shop pages must import the GATED string, never the built one — otherwise the gate is
    // one edit from being routed around.
    for (const f of ['app/bookstore/page.js', 'app/bookstore/[slug]/page-detail.js']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src.includes('SHIPPED_BOOK_TRANSITION_CSS'), `${f} must render the gated CSS`).toBeTruthy();
      expect(/\$\{BOOK_TRANSITION_CSS\}/.test(src), `${f} must not reach past the gate`).toBeFalsy();
    }
  });

  test('NOTHING HERE IS LOAD-BEARING FOR THE NAVIGATION', async () => {
    // Unchanged from R22C, and more important than ever: with the feature off, every link on the
    // shop must behave exactly as it did before R22 existed. No handler prevents default and no
    // script performs a navigation.
    expect(/\.preventDefault\s*\(/.test(BT_SRC), 'the click handler must never preventDefault').toBeFalsy();
    expect(/location\.(href|assign|replace)|router\.push/.test(BT_SRC),
      'nothing in this module may perform a navigation').toBeFalsy();
    // And the installer is a no-op while the flag is down, so the shop is not even listening.
    expect(/if \(!BOOK_TRANSITION_SHIPPED\) return \(\) => \{\};/.test(BT_SRC),
      'installBookTransitions must be a no-op while the transition is withheld').toBeTruthy();
  });
});
