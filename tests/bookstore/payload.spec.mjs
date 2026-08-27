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

// R20 — the grain's own record, read from the module rather than restated here. If the ruling
// is ever reversed, it is reversed in ONE file and this suite follows it there instead of
// asserting a number nobody can find the origin of.
const GRAIN_SRC = readFileSync(join(ROOT, 'app/bookstore/components/grain.js'), 'utf8');
const numConst = (name) => {
  const m = new RegExp(`^export const ${name} = (\\d+);`, 'm').exec(GRAIN_SRC);
  if (!m) throw new Error(`app/bookstore/components/grain.js no longer exports a numeric const named ${name}.`);
  return Number(m[1]);
};
const GRAIN_BLEED_PX = numConst('GRAIN_BLEED_PX');

// R22 — the removal, read out of the module's own record rather than restated here. The
// ratchet below scans the BUILT export for these strings, so if a future round puts the
// shimmer back by copying `wasDeclaration` out of the record, the ratchet trips on the copy.
const removedConst = (name) => {
  const m = new RegExp(`^  ${name}: '((?:[^'\\\\]|\\\\.)*)',$`, 'm').exec(GRAIN_SRC);
  if (!m) throw new Error(`GRAIN_ANIMATION_REMOVED no longer records a single-quoted ${name}.`);
  return m[1];
};
const GRAIN_KEYFRAME_NAME = removedConst('keyframeName');

// Both pages carry the grain, and R20 changed it on both. A suite that only checked the
// storefront would let the detail page drift back on its own.
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
// THE GRAIN — R20, Ikenna's ruling of 26 August 2026.
//
//   "Grain that holds still while the page moves reads as dust on the lens; grain that
//    travels with the page reads as texture in the paper."
//
// The grain IS the single largest cost in a scroll of the storefront — but un-fixing it is not
// what recovers that, and the header of app/bookstore/components/grain.js sets out the faulty
// ablation that briefly suggested otherwise. These cases guard a DRAWING.
//
// WHAT THESE CASES GUARD is the ATTACHMENT, because that is the whole of the change and it is
// a single word in a stylesheet. `position:fixed` would restore a viewport-locked layer that
// re-composites against every scroll offset, and nothing else on this platform would notice.
// It would not break a page, fail a build, or move a pixel at rest.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the grain', () => {
  for (const pg of GRAIN_PAGES) {
    for (const vp of VIEWPORTS) {
      test(`${pg.name} ${vp.name}: the grain travels with the page and covers it`, async ({ page }) => {
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
        await page.waitForTimeout(1500);

        const g = await page.evaluate(() => {
          const el = document.querySelector('.bookstore-grain');
          if (!el) return null;
          const cs = getComputedStyle(el);
          const parent = el.parentElement;
          const r = el.getBoundingClientRect();
          return {
            position: cs.position,
            parentTag: parent.tagName,
            parentPositioned: getComputedStyle(parent).position !== 'static',
            isFirstChild: parent.firstElementChild === el,
            height: Math.round(r.height),
            parentScrollHeight: parent.scrollHeight,
            viewportH: window.innerHeight,
            animationName: cs.animationName,
            animationDuration: cs.animationDuration,
            // R22 — every running KEYFRAME animation the document holds, not just this
            // element's own declaration. getAnimations() sees one whoever declared it, so a
            // restoration wired through a global stylesheet or a parent rule is caught here
            // even though the computed style above would read 'none'. CSSTransition entries
            // carry no animationName and drop out, which is correct: R22B's page-turn is a
            // transition and is not what this is watching for.
            //
            // The shop legitimately runs OTHER keyframes — fadeUp on entrance, pulse and
            // lampPulse on the hero — so this narrows to anything grain-shaped rather than
            // demanding silence it never had.
            grainAnimationsRunning: document.getAnimations()
              .map((a) => a.animationName || '')
              .filter((n) => /grain/i.test(n)),
            opacity: cs.opacity,
            backgroundImage: cs.backgroundImage,
          };
        });
        expect(g, 'the grain must be on the page').not.toBeNull();

        // THE RULING ITSELF.
        expect(g.position,
          'the grain must travel with the page — Ikenna\'s ruling of 26 Aug 2026. position:fixed '
          + 'is the pre-R20 arrangement. This is a DESIGN assertion, not a performance one: the '
          + 'two positioning schemes measure the same, and the header of '
          + 'app/bookstore/components/grain.js corrects an earlier claim that they did not. '
          + 'Read that before changing this.')
          .toBe('absolute');

        // AND THE ARRANGEMENT THAT MAKES IT WORK. An absolutely positioned element with no
        // positioned ancestor resolves against the viewport-sized initial containing block —
        // so the grain would cover one screenful and stop, which looks fine above the fold and
        // is why this is asserted rather than left to review.
        expect(g.parentTag, 'the grain must live inside <main>').toBe('MAIN');
        expect(g.parentPositioned, '<main> must be positioned, or the grain resolves against the viewport and runs out').toBeTruthy();

        // COVERAGE, to the full height of the shop's own surface plus the bleed.
        expect(g.height,
          `the grain is ${g.height}px against a ${g.parentScrollHeight}px page — it must reach the foot`)
          .toBeGreaterThanOrEqual(g.parentScrollHeight);

        // A SHORT PAGE still gets a full screen of it.
        expect(g.height, 'a short page must still be covered to the fold').toBeGreaterThanOrEqual(g.viewportH);

        // ⛔ R22 — THE SHIMMER IS GONE, AND THIS IS THE RATCHET.
        //
        // Ikenna, 26 Aug 2026, shown the animated grain on glass: "doesn't look good at all...
        // needs to go very quickly." THE LOOK RULED. The animation also cost frames — 34.1% →
        // 20.8% on this page at this viewport, `npm run bench:grain`, both arms on one build —
        // and that is a BONUS. It is not the reason, and winning the performance argument does
        // not reopen this. See GRAIN_ANIMATION_REMOVED in app/bookstore/components/grain.js,
        // including why R22 records 13 points where R20 recorded 22.
        //
        // Asserted on the COMPUTED style, at both viewports, on both pages, so a restoration
        // by any route — the module, a page's inline CSS, a global stylesheet — is caught.
        expect(g.animationName,
          'the grain must not animate — Ikenna\'s ruling of 26 Aug 2026, on how it looked. '
          + 'Read GRAIN_ANIMATION_REMOVED before restoring it.').toBe('none');
        expect(g.animationDuration, 'no animation means no duration').toBe('0s');
        // NOT animationPlayState: its INITIAL value is 'running', so it reads 'running' on an
        // element with no animation at all. Asserting on it would be a check that can never
        // fail in the direction it was written for.
        // And nothing on the page is running a grain keyframe under any other name or from any
        // other stylesheet.
        expect(g.grainAnimationsRunning,
          'a grain animation is running from somewhere other than the grain rule').toEqual([]);

        // THE LOOK. Opacity and both gradient passes are what make the texture; they are
        // unchanged by R20 and this is where that is written down.
        expect(g.opacity).toBe('0.05');
        expect(g.backgroundImage).toContain('repeating-linear-gradient');
        expect((g.backgroundImage.match(/repeating-linear-gradient/g) || []).length,
          'both gradient passes — the 0deg and the 90deg — make the texture').toBe(2);
      });
    }
  }

  test('the bleed stays at 16px — it sets the texture\'s phase, not the travel', async () => {
    // R20 sized this to exceed the largest keyframe offset (9px) so a step could not drag an
    // uncovered edge into view. R22 removed the steps, and the number is load-bearing for a
    // DIFFERENT reason that outlives them: the texture's colour stops are absolute pixels, so
    // the gradient's phase is a function of the element's origin. The 90deg pass has a 3px
    // period — move the origin and the texture lands out of phase, which is a visible change
    // to a drawing two rulings protect.
    expect(GRAIN_BLEED_PX, 'the bleed sets the gradient origin; changing it re-phases the texture').toBe(16);
  });

  test('⛔ the BUILT export ships no grain animation anywhere', async () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // THE RATCHET. R22.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    //
    // The computed-style cases above prove the shimmer is not running on the two pages this
    // suite loads. THIS one proves it is not in the artefact AT ALL — every HTML file and every
    // emitted stylesheet in out/. The difference matters because a keyframe restored on a page
    // this suite does not visit, or behind a media query, or in a chunk that only loads on a
    // third route, would pass every assertion above and still be a shimmer on Ikenna's iPad.
    //
    // It scans for the keyframe NAME read out of GRAIN_ANIMATION_REMOVED, so the one route a
    // restoration would actually take — copying `wasKeyframes` back out of the record — is the
    // route this catches first.
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
        if (/\.(html|css)$/.test(name)) files.push(full);
      }
    })(OUT);
    expect(files.length, 'the export must contain HTML and CSS to scan').toBeGreaterThan(10);

    const offenders = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (text.includes(GRAIN_KEYFRAME_NAME)) offenders.push(`${f.slice(OUT.length)} (keyframe name)`);
      // The declaration, however it is spelled: `animation:` or `animation-name:` inside the
      // grain rule. Sliced tightly so an unrelated animation elsewhere in the file is not
      // blamed on the grain.
      let at = 0;
      for (;;) {
        const i = text.indexOf(`.${'bookstore-grain'}{`, at);
        if (i === -1) break;
        const rule = text.slice(i, text.indexOf('}', i) + 1);
        if (/animation(-name)?\s*:/.test(rule)) offenders.push(`${f.slice(OUT.length)} (grain rule: ${rule.slice(0, 120)})`);
        at = i + 1;
      }
    }
    expect(offenders,
      'the grain animation was removed on Ikenna\'s ruling of 26 Aug 2026 — "doesn\'t look good '
      + 'at all... needs to go very quickly". It also cost 13 points of dropped frames, which is '
      + 'a bonus and not the reason. See GRAIN_ANIMATION_REMOVED in app/bookstore/components/grain.js.')
      .toEqual([]);
  });

  test('there is exactly one definition of the grain', async () => {
    // It used to be duplicated byte-for-byte in app/bookstore/page.js and
    // app/bookstore/[slug]/page-detail.js. Two copies of a ruling is one copy that gets
    // reversed on its own, which is precisely the failure the cases above are guarding.
    for (const f of ['app/bookstore/page.js', 'app/bookstore/[slug]/page-detail.js']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src.includes('position:fixed;inset:-50%'),
        `${f} still carries its own copy of the pre-R20 grain rule`).toBeFalsy();
      expect(src.includes('GRAIN_CSS'), `${f} must render the shared grain`).toBeTruthy();
    }
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
    await words.page().locator('.rail-btn').first().click();          // "Whose line is this?"
    const attrib = words.page().locator('.rail-attrib');
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
    const markBoxBefore = await page_.locator('.rail-mark').first().boundingBox();

    await page_.locator('.rail-btn').first().click();                 // reveal
    await page_.locator('.rail-btn').first().click();                 // "Another line"
    await page_.waitForTimeout(DURATION_MS + 300);

    expect(await words.textContent(), 'the rail must be showing a different line').not.toBe(before);
    const markBoxAfter = await page_.locator('.rail-mark').first().boundingBox();
    // The frame is a frame. A mark that moved would mean the quotation marks had been carried
    // out with the words, which is the version of this effect the mock rejected.
    expect(Math.abs(markBoxAfter.x - markBoxBefore.x), 'the opening quotation mark moved horizontally').toBeLessThan(1.5);
    expect(Math.abs(markBoxAfter.y - markBoxBefore.y), 'the opening quotation mark moved vertically').toBeLessThan(1.5);
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
// R22C — THE BOOK CARRIES YOU TO ITS PAGE
// ═══════════════════════════════════════════════════════════════════════════════
//
// ⚠ WHAT CAN AND CANNOT BE ASSERTED HEADLESSLY, STATED PLAINLY.
//
// CANNOT: that the cover looks like it lifts, travels and lands. No headless assertion reads
// that, and pretending otherwise with a screenshot diff of a mid-transition frame would be a
// test that goes red when the easing is adjusted by a designer and green when the effect is
// broken. Ikenna judges the feel on glass; that is the correct instrument for it.
//
// CAN, and these are the ones that actually decay:
//   · both documents opt in from their PARSED <head>, not from a stylesheet React renders.
//     This is the exact defect that made the first working version of R22C do nothing at all.
//   · the pair-or-nothing guard is in the head as a classic script, so it is listening before
//     `pagereveal`.
//   · a navigation really does offer a transition — `pageswap` carries a live viewTransition.
//   · the outgoing board is findable by slug and carries a front face to photograph.
//   · nothing here is load-bearing for the navigation itself.
test.describe('the book carries you to its page', () => {
  const BT_SRC = readFileSync(join(ROOT, 'app/bookstore/components/bookTransition.js'), 'utf8');
  const btConst = (name) => {
    const m = new RegExp(`^export const ${name} = '([^']+)';`, 'm').exec(BT_SRC);
    if (!m) throw new Error(`bookTransition.js no longer exports a string const named ${name}.`);
    return m[1];
  };
  const VT_NAME = btConst('BOOK_VT_NAME');
  const SLUG_ATTR = btConst('BOOK_SLUG_ATTR');
  const ARRIVAL_ATTR = btConst('BOOK_ARRIVAL_ATTR');

  test('the opt-in is in the PARSED head of every page, not in a stylesheet React renders', async () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // THE RATCHET FOR THE BUG THAT COST THIS ROUND ITS FIRST WORKING VERSION.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    //
    // `@view-transition{navigation:auto}` is read by the UA at `pagereveal`, before first
    // render. Put it in a <style> the app renders and the ARRIVING document declines the
    // transition — measured: pageswap YES, pagereveal no, on every navigation, silently. It
    // reads exactly like "view transitions do not work in a static export". They do.
    //
    // Scanned in the built HTML, before any script has run, on a shop page and a non-shop page:
    // this is site-wide by design and the guard is what keeps that from meaning "cross-fade
    // everything".
    const { readFileSync: rf } = await import('node:fs');
    for (const rel of ['out/bookstore.html', 'out/index.html']) {
      const html = rf(join(ROOT, rel), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head.includes('@view-transition'),
        `${rel}: the opt-in must be in the parsed <head>, or the arriving page declines the transition`)
        .toBeTruthy();
      expect(head.includes('pagereveal'),
        `${rel}: the pair-or-nothing guard must be a head script, listening before pagereveal`)
        .toBeTruthy();
    }
  });

  test('a detail page is built with the same head, so the pair can form on arrival', async ({ page }) => {
    const slug = await (async () => {
      await enterShop(page);
      await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
      await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
      return liveDetailSlug(page);
    })();
    const { readFileSync: rf } = await import('node:fs');
    const html = rf(join(ROOT, `out/bookstore/${slug}.html`), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head.includes('@view-transition'), 'the arriving document must opt in from its parsed head').toBeTruthy();
  });

  test('the outgoing board is findable by slug and has a face to photograph', async ({ page }) => {
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });

    const boards = await page.locator(`[${SLUG_ATTR}]`).count();
    expect(boards, 'every BoundBook on the shop must carry its slug, or a link cannot find it').toBeGreaterThan(0);

    const slug = await liveDetailSlug(page);
    const found = await page.evaluate(([attr, s]) => {
      const host = document.querySelector(`[${attr}="${s}"]`);
      return { host: !!host, face: !!host?.querySelector('.bb-front') };
    }, [SLUG_ATTR, slug]);
    expect(found.host, `no board on the shop carries ${SLUG_ATTR}="${slug}"`).toBeTruthy();
    expect(found.face, 'the board must have a front face — that is what travels').toBeTruthy();
  });

  test('naming a board does not create a duplicate name anywhere on the shop', async ({ page }) => {
    // Duplicates are the silent killer here: two elements claiming one view-transition-name
    // makes the browser skip the transition for BOTH, with no error. The shop draws twenty-odd
    // boards, so arming has to clear before it stamps.
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    const slugs = await page.evaluate((attr) =>
      [...document.querySelectorAll(`[${attr}]`)].map((el) => el.getAttribute(attr)).filter(Boolean).slice(0, 4),
    SLUG_ATTR);
    expect(slugs.length).toBeGreaterThan(0);

    const named = await page.evaluate(([attr, list, name]) => {
      // Arm each in turn, exactly as a click would, and count the claimants each time.
      const counts = [];
      for (const s of list) {
        for (const el of document.querySelectorAll(`[style*="${name}"]`)) el.style.viewTransitionName = '';
        const face = document.querySelector(`[${attr}="${s}"] .bb-front`);
        if (face) face.style.viewTransitionName = name;
        counts.push(document.querySelectorAll(`[style*="${name}"]`).length);
      }
      for (const el of document.querySelectorAll(`[style*="${name}"]`)) el.style.viewTransitionName = '';
      return counts;
    }, [SLUG_ATTR, slugs, VT_NAME]);
    for (const c of named) expect(c, 'exactly one element may claim the name').toBe(1);
  });

  test('a real navigation offers a transition on the way out', async ({ page }) => {
    await enterShop(page);
    await page.addInitScript(() => {
      window.addEventListener('pageswap', (e) => {
        try { sessionStorage.setItem('cs-swap-vt', e.viewTransition ? 'yes' : 'no'); } catch { /* private mode */ }
      });
    });
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    const slug = await liveDetailSlug(page);

    await page.evaluate((s) => {
      const a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === `/bookstore/${s}`);
      if (a) a.click();
      else location.href = `/bookstore/${s}`;
    }, slug);
    await page.waitForLoadState();
    await page.waitForTimeout(500);

    const swap = await page.evaluate(() => { try { return sessionStorage.getItem('cs-swap-vt'); } catch { return null; } });
    expect(swap, 'the outgoing document must offer a cross-document view transition').toBe('yes');
  });

  test('the arriving board is named by RULE, so nothing has to remember to name it', async ({ page }) => {
    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    const slug = await liveDetailSlug(page);
    await page.goto(`/bookstore/${slug}`, { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.bd-cta').first()).toBeVisible({ timeout: 30000 });

    const arrival = await page.evaluate((attr) => {
      const wrap = document.querySelectorAll(`[${attr}]`);
      const face = document.querySelector(`[${attr}] .bb-front`);
      return { wraps: wrap.length, name: face ? getComputedStyle(face).viewTransitionName : null };
    }, ARRIVAL_ATTR);

    expect(arrival.wraps, 'the detail page must have exactly one arrival slot — a second would be a duplicate name').toBe(1);
    expect(arrival.name, 'the arriving board must carry the name from the stylesheet').toBe(VT_NAME);
  });

  test('NOTHING HERE IS LOAD-BEARING FOR THE NAVIGATION', async ({ page }) => {
    // The property that makes every degradation path safe: no handler calls preventDefault and
    // no navigation is performed by script. A browser with no view-transition support, a reader
    // with reduced motion, a thrown error inside arming — all of them still get the page.
    // `.preventDefault(` — a CALL. Reading `e.defaultPrevented` is the opposite thing and is
    // exactly what a well-behaved delegated handler should do.
    expect(/\.preventDefault\s*\(/.test(BT_SRC), 'the click handler must never preventDefault').toBeFalsy();
    expect(/location\.(href|assign|replace)|router\.push/.test(BT_SRC),
      'navigation must stay with the <a>, never move into script').toBeFalsy();

    await enterShop(page);
    await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
    const slug = await liveDetailSlug(page);
    // Arm, then follow: the page must still be reached.
    await page.evaluate((s) => {
      const a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === `/bookstore/${s}`);
      if (a) a.click(); else location.href = `/bookstore/${s}`;
    }, slug);
    await page.waitForURL(`**/bookstore/${slug}`, { timeout: 30000 });
    await expect(page.locator('.bd-cta').first()).toBeVisible({ timeout: 30000 });
  });
});
