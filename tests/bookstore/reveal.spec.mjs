// ═══════════════════════════════════════════════════════════════════════════════════════════
// R23 — THE DETAIL PAGE ARRIVES FINISHED, AND THIS IS WHAT HOLDS IT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:reveal
//
// ── WHAT WAS CUT, AND WHAT IT WAS ACTUALLY DOING ────────────────────────────────────────────
//
// Ikenna's ruling of 27 Aug, from a recording of the live site on iPhone Safari: the
// shelf→detail arrival "still doesn't look good at all" and the staggered reveal is CUT.
//
// There was never a stagger. The detail page had exactly ONE entrance animation — a 600ms
// `fadeUp` on the single wrapper around all of the ready content — and measurement against the
// built export showed it producing every symptom the recording shows:
//
//   · THE COVER DIPPED. The loading branch draws the R22C seed board at FULL opacity. When
//     `state` flips to ready that branch unmounts and the same book re-mounts INSIDE the
//     wrapper, at opacity 0. Measured effective opacity on .bd-cover-wrap across the swap:
//     1 → 0 → 1. The reveal was un-drawing the very board the seed exists to keep still.
//   · OUT-OF-DOM-ORDER ARRIVAL. Not a ladder — because the cover is already on screen from the
//     loading branch ~150ms before the breadcrumb, kicker and title exist at all.
//   · ~430ms OF ASSEMBLY, from a 600ms animation: the climb to about nine-tenths opacity is
//     the part a viewer registers as things arriving.
//
// ── WHAT THIS SUITE REFUSES TO BE ──────────────────────────────────────────────────────────
//
// Six instances have been found in this repo of tests pinning the SHAPE of something the
// product had stopped rendering. So there is no assertion here about the source of
// page-detail.js, no grep for `animation:`, and no check that a class is absent. Every case
// drives the real built page in a real browser and reads COMPUTED STYLE AT THE FIRST FRAME THE
// CONTENT EXISTS — the exact frame that used to read opacity 0 and translateY(16px).
//
// And the probe is proved able to see a reveal: the last case puts the removed animation back,
// through CSS injected at document_start with the same declaration the deleted inline style
// produced, and requires every assertion above to go red. Without that half, "opacity is 1"
// would also pass against a selector that matches nothing.
//
// ── R26 — WHAT MOVED UNDER THIS SUITE, AND WHY IT MEASURES MORE NOW ────────────────────────
//
// `.cs-settle` used to exist ONLY in the ready branch, so "the first frame .cs-settle exists"
// and "the first frame the ready content exists" were the same frame. R26 collapsed the
// loading and ready branches into one — one board, one <img>, one box, because the flip
// between two branches was moving the drawn cover 53.42px and re-fetching it — so `.cs-settle`
// now mounts with the SEED, some 35ms earlier, carrying the breadcrumb and the board.
//
// The measurement is unchanged in kind and strictly stronger in reach: the same element, at an
// EARLIER first frame, still has to be at final opacity and final position with nothing
// animating. Two consequences are written into the cases below rather than papered over:
//
//   · THE SKELETON PULSE IS INSIDE THE WRAPPER NOW. It belongs to the right-hand column, which
//     is genuinely not here yet, and it is RULED — so it is named and excluded, exactly as the
//     `running` case beside it already excluded it. Nothing else may animate.
//   · THE <h1> DOES NOT EXIST ON THAT FRAME. It arrives with the live record. So its opacity
//     is measured on the first frame it DOES exist, which is what R23's assertion always
//     meant: the title must not climb out of a fade when it appears.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveDetailSlug } from './live-slug.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports GATE_STORAGE_KEY as a single-quoted string.');
  return m[1];
})();

// The exact declaration the deleted JSX produced. Injected by the mutation case only.
const REMOVED_REVEAL = `
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  .cs-settle{animation:fadeUp .6s ease forwards}
`;

// Records, frame by frame from document_start, the FIRST frame on which the ready content
// exists — and what its computed style was on that frame. That is the whole measurement: a
// reveal is precisely something that is not yet in its final state when it first appears.
const RECORDER = () => {
  window.__firstPaint = null;
  // R26 — the title arrives after the wrapper does. Same question, its own frame.
  window.__titlePaint = null;
  const effectiveOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return +o.toFixed(4);
  };
  const look = () => {
    if (!window.__titlePaint) {
      const h = document.querySelector('h1');
      if (h) {
        const cover = document.querySelector('.bd-cover-wrap');
        window.__titlePaint = {
          t: Math.round(performance.now()),
          h1Opacity: effectiveOpacity(h),
          coverOpacity: cover ? effectiveOpacity(cover) : null,
        };
      }
    }
    if (!window.__firstPaint) {
      const w = document.querySelector('.cs-settle');
      if (w) {
        const cs = getComputedStyle(w);
        const cover = document.querySelector('.bd-cover-wrap');
        const h1 = document.querySelector('h1');
        // Every element in the content subtree, so a per-element delay anywhere is caught and
        // not just one on the wrapper.
        const offenders = [];
        for (const el of w.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          const delayed = s.transitionDelay.split(',').some((d) => parseFloat(d) > 0);
          if (s.animationName !== 'none' || delayed) {
            offenders.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), animation: s.animationName, transitionDelay: s.transitionDelay });
          }
        }
        window.__firstPaint = {
          t: Math.round(performance.now()),
          opacity: +cs.opacity,
          transform: cs.transform,
          animationName: cs.animationName,
          transitionDelay: cs.transitionDelay,
          coverOpacity: cover ? effectiveOpacity(cover) : null,
          h1Opacity: h1 ? effectiveOpacity(h1) : null,   // null before the record lands — see __titlePaint
          running: document.getAnimations().map((a) => a.animationName || a.transitionProperty).filter(Boolean),
          offenders,
        };
      }
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

async function openDetail(page, { putTheRevealBack = false } = {}) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));

  await page.goto('/bookstore');
  await expect(page.locator('a[href^="/bookstore/"]').first()).toBeAttached({ timeout: 30000 });
  const slug = await liveDetailSlug(page);

  if (putTheRevealBack) {
    await page.addInitScript((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      const put = () => (document.head || document.documentElement).appendChild(s);
      if (document.head) put(); else document.addEventListener('readystatechange', put, { once: true });
    }, REMOVED_REVEAL);
  }
  await page.addInitScript(RECORDER);
  await page.goto(`/bookstore/${slug}`);
  await expect(page.locator('.cs-settle h1')).toBeVisible({ timeout: 30000 });
  const paint = await page.evaluate(() => window.__firstPaint);
  const titlePaint = await page.evaluate(() => window.__titlePaint);
  expect(paint, 'the recorder never saw the content wrapper — this suite measured nothing').toBeTruthy();
  expect(titlePaint, 'the recorder never saw the title — this suite measured nothing').toBeTruthy();
  return { slug, paint, titlePaint };
}

// The one animation ruled IN. It is on the right-hand column's skeleton bars, which stand for
// text that has genuinely not arrived; it is not on the cover, which has.
const RULED_PULSE = 'pulse';

test.describe('the detail page renders in its final state at first paint', () => {
  test('the content wrapper is at final opacity and final position on the frame it appears', async ({ page }) => {
    // ⭑ THE CENTRAL CASE. Before R23 this exact frame read opacity 0 and matrix(1,0,0,1,0,16).
    const { paint } = await openDetail(page);
    expect(paint.opacity, 'the content must be fully opaque on its first frame, not fading in').toBe(1);
    expect(paint.transform, 'the content must be at its final position, not translated into place')
      .toMatch(/^(none|matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\))$/);
  });

  test('nothing in the content is animating or waiting on a transition delay', async ({ page }) => {
    // Every element in the subtree, not just the wrapper — a stagger would live on the children.
    const { paint } = await openDetail(page);
    expect(paint.animationName, 'the wrapper must carry no entrance animation').toBe('none');
    expect(paint.transitionDelay.split(',').map((d) => parseFloat(d)).filter((d) => d > 0),
      'the wrapper must carry no transition delay').toEqual([]);
    const offenders = paint.offenders.filter((o) => o.animation !== RULED_PULSE || parseFloat(o.transitionDelay) > 0);
    expect(offenders, `these elements arrive animated or delayed: ${JSON.stringify(offenders)}`).toEqual([]);
    // …and the pulse is only ever allowed on the skeleton. It may not spread to the cover.
    expect(paint.offenders.filter((o) => o.animation === RULED_PULSE && !/bd-skeleton/.test(o.cls)),
      'the ruled skeleton pulse has escaped the skeleton').toEqual([]);
  });

  test('THE COVER DOES NOT DIP — the board is at full opacity the moment the page is ready', async ({ page }) => {
    // ⭑ The symptom Ikenna described most concretely, and the one the R22C seed exists to
    // prevent: the same board drawn at full opacity in the loading state must not be re-drawn
    // from transparent when the real record lands.
    const { paint, titlePaint } = await openDetail(page);
    expect(paint.coverOpacity, 'the cover must not be climbing out of a fade on the frame the page arrives').toBe(1);
    // R26 — the same board, still at full opacity on the LATER frame the record lands. Before
    // R26 that was a different <img> in a different box; now it is the same element, and this
    // is the assertion that says so in opacity terms.
    expect(titlePaint.coverOpacity, 'the cover must not dip when the live record lands').toBe(1);
    expect(titlePaint.h1Opacity, 'the title must not be climbing out of a fade either').toBe(1);
  });

  test('no entrance animation is running anywhere on the page at that frame', async ({ page }) => {
    // The skeleton pulse belongs to the LOADING state and is gone by the time the ready content
    // exists, so the honest assertion is that nothing is running on this frame at all.
    const { paint } = await openDetail(page);
    expect(paint.running.filter((n) => n !== 'pulse'),
      `animations running on the first ready frame: ${paint.running.join(', ')}`).toEqual([]);
  });

  test('PROOF THE PROBE WORKS — put the reveal back and every assertion above goes red', async ({ page }) => {
    // ⭑ Without this, all four cases above would also pass against a probe that found nothing,
    // a selector that stopped matching, or a page that never rendered. The CSS injected here is
    // the declaration the deleted inline style produced, applied to the same element.
    const { paint } = await openDetail(page, { putTheRevealBack: true });

    expect(paint.opacity, 'with the reveal back the wrapper must NOT be at final opacity').toBeLessThan(1);
    expect(paint.transform, 'with the reveal back the wrapper must NOT be at its final position')
      .not.toMatch(/^(none|matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\))$/);
    expect(paint.animationName, 'with the reveal back the wrapper must carry the animation').toBe('fadeUp');
    expect(paint.coverOpacity, 'with the reveal back the cover must be mid-dip').toBeLessThan(1);
    expect(paint.running, 'with the reveal back fadeUp must be running').toContain('fadeUp');
  });
});
