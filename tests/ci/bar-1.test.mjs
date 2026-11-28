// BAR-1 — the site bar holds the top of the screen. The pure and source halves; the replayed
// iPhone half (WebKit, /public-library, every state) is tests/storybar/bar-1.spec.mjs.
//
//   node --test tests/ci/bar-1.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barView, initialBar, viewportShift, isZoomed, nextBar, VIEWPORT_TOLERANCE_PX } from '../../app/lib/storyBar.js';

const code = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sample = (y, vv) => ({ y, maxY: 10000, h: 874, vv });

describe('BAR-1 · follow the glass at scale 1, hide only when zoomed', () => {
  test('the shift is the visual viewport\'s offsetTop, EITHER sign, past the tolerance; zoomed → 0', () => {
    assert.equal(viewportShift(null), 0);
    assert.equal(viewportShift({ offsetTop: 0, scale: 1 }), 0);
    assert.equal(viewportShift({ offsetTop: VIEWPORT_TOLERANCE_PX, scale: 1 }), 0);
    assert.equal(viewportShift({ offsetTop: -VIEWPORT_TOLERANCE_PX, scale: 1 }), 0);
    assert.equal(viewportShift({ offsetTop: 280, scale: 1 }), 280, 'the keyboard\'s pan');
    assert.equal(viewportShift({ offsetTop: -240, scale: 1 }), -240, 'Ikenna\'s 28 Nov shape: layout top 240 below the glass');
    assert.equal(viewportShift({ offsetTop: 300, scale: 1.8 }), 0, 'zoomed: hidden, not followed');
    assert.equal(isZoomed({ offsetTop: 0, scale: 1.01 }), false);
    assert.equal(isZoomed({ offsetTop: 0, scale: 1.02 }), true);
  });
  test('28 Nov, the site bar: a negative offset at scale 1 used to read as "agree" and paint the bar 240 down; now it is shown AND translated back', () => {
    const v = barView(initialBar(), sample(900, { offsetTop: -240, scale: 1 }));
    assert.equal(v.view, 'shown');
    assert.equal(v.shift, -240);
    // On the glass: (layout top + shift − offsetTop) × scale = (0 − 240 + 240) × 1 = 0.
    assert.equal((0 + v.shift - (-240)) * 1, 0);
  });
  test('the story bar keeps its scroll-hide under a shift, and the shift is carried in both states', () => {
    const vv = { offsetTop: 200, scale: 1 };
    let s = barView(initialBar(), sample(0, vv), true);
    assert.deepEqual([s.view, s.shift], ['shown', 200]);
    s = barView(s, sample(400, vv), true);
    s = barView(s, sample(440, vv), true);
    assert.deepEqual([s.view, s.shift], ['hidden', 200]);
    const z = barView(s, sample(440, { offsetTop: 200, scale: 2 }), true);
    assert.deepEqual([z.view, z.shift], ['apart', 0]);
    assert.equal(nextBar(initialBar(), { y: 0, maxY: 1000, h: 800, vv }).apart, false);
  });
});

describe('BAR-1 · the guard re-reads on every event that can move a viewport', () => {
  const h = code('app/components/useBarGuard.js');
  test('pageshow, focusin, focusout, orientationchange, visibilitychange, popstate — and a settle burst after each', () => {
    assert.match(h, /SETTLE_EVENTS = Object\.freeze\(\['pageshow', 'focusin', 'focusout', 'orientationchange', 'visibilitychange', 'popstate'\]\)/);
    assert.match(h, /for \(const ev of SETTLE_EVENTS\) \(ev === 'visibilitychange' \? document : window\)\.addEventListener\(ev, onSettle\)/);
    assert.match(h, /REREAD_MS = Object\.freeze\(\[60, 180, 400, 800, 1500\]\)/);
    assert.match(h, /timers = REREAD_MS\.map\(\(ms\) => setTimeout\(on, ms\)\)/);
    assert.match(h, /read\(\);\n\s*settle\(\);/, 'and on mount');
  });
  test('it writes the follow as `translate` (composes with the story bar\'s transform; never transitioned)', () => {
    assert.match(h, /el\.style\.translate = shift \? `0 \$\{shift\}px` : ''/);
    assert.match(h, /let shiftWritten = Number\(el\.getAttribute\('data-shift'\)\) \|\| 0;/, 'a hold keeps the translate it had');
    // Each bar's OWN rule: nothing may transition the follow (a hamburger line's `all` is not the bar).
    for (const [f, sel] of [['app/components/StoryBar.js', '[data-story-bar] {'], ['app/components/Navbar.js', '.cs-nav {'], ['app/components/VerifyEmailBanner.js', '.cs-verify {']]) {
      const src = code(f);
      const at = src.indexOf(sel);
      assert.ok(at >= 0, `${f}: ${sel}`);
      const rule = src.slice(at, src.indexOf('}', at));
      assert.doesNotMatch(rule, /transition:[^;]*\b(all|translate)\b/, `${f}: nothing may transition the follow`);
    }
  });
  test('the visualViewport is re-read after a bfcache restore, never cached for the hook\'s life', () => {
    assert.match(h, /const vvNow = \(\) => window\.visualViewport \|\| null;/);
    assert.match(h, /const onSettle = \(\) => \{ bindVv\(\); settle\(\); \};/);
  });
});

describe('BAR-1 · the site bar\'s only ancestors are <body> and <html>', () => {
  const n = code('app/components/Navbar.js');
  test('after hydration it renders through a portal into ONE host, <body>\'s first child, display: contents', () => {
    assert.match(n, /return host \? createPortal\(tree, host\) : tree;/);
    assert.match(n, /const host = useSyncExternalStore\(noSubscribe, barHost, noHost\);/);
    assert.match(n, /h\.style\.display = 'contents';/);
    assert.match(n, /document\.body\.insertBefore\(h, document\.body\.firstChild\);/);
  });
  test('the guard and the readout re-attach when the bar moves', () => {
    assert.match(n, /useViewportGuard\(navRef, \{ hold: menuOpen, rev: host \? 1 : 0 \}\)/);
    assert.match(n, /useBarReadout\(navRef, host \? 1 : 0\)/);
    assert.match(code('app/components/useBarGuard.js'), /\}, \[ref, hideOnScroll, hold, rev\]\);/);
  });
});

describe('BAR-1 · the readout catches it next time', () => {
  const r = code('app/components/BarReadout.js');
  const g = code('app/components/useBarGuard.js');
  test('?debug=bar is sticky for the session, until ?debug=bar-off; founder-gated before anything loads', () => {
    assert.match(g, /BAR_DEBUG_KEY = 'cs_debug_bar'/);
    assert.match(g, /if \(q === 'bar-off'\) \{ sessionStorage\.removeItem\(BAR_DEBUG_KEY\); return false; \}/);
    assert.match(g, /if \(!el \|\| !isFounder\(uid\)\) return undefined;\n\s*if \(!barDebugOn\(\)\) return undefined;/);
  });
  test('it keeps the last 4 seconds across client-side navigation, and freezes into sessionStorage', () => {
    assert.match(r, /export const LOG_MS = 4000;/);
    assert.match(r, /if \(!window\.__csBarLog\) window\.__csBarLog = \{ samples: \[\], events: \[\] \};/);
    assert.match(r, /sessionStorage\.setItem\(FROZEN_KEY, JSON\.stringify\(frozen\)\)/);
    assert.match(r, /'pageshow', 'pagehide', 'focusin', 'focusout', 'orientationchange', 'visibilitychange', 'popstate', 'resize'/);
  });
  test('the freeze triggers: off the glass (below the top), following, a short view with no field', async () => {
    const src = r.slice(r.indexOf('export function freezeTrigger'), r.indexOf('function readFrozen'));
    const freezeTrigger = new Function(`${src.replace('export ', '')}; return freezeTrigger;`)();
    const ok = { painted: true, state: 'shown', screenTop: 0, shift: 0, zoomed: false, field: false, vvH: 874, innerH: 874 };
    assert.equal(freezeTrigger(ok), null);
    assert.equal(freezeTrigger({ ...ok, screenTop: 240 }), 'OFF-GLASS');
    assert.equal(freezeTrigger({ ...ok, screenTop: -30 }), null, 'a story bar mid-slide is not off the glass');
    assert.equal(freezeTrigger({ ...ok, state: 'apart', painted: false, screenTop: 240 }), null);
    assert.equal(freezeTrigger({ ...ok, shift: -240 }), 'FOLLOWING');
    assert.equal(freezeTrigger({ ...ok, vvH: 600 }), 'SHORT VIEW');
    assert.equal(freezeTrigger({ ...ok, vvH: 600, field: true }), null, 'the keyboard is up: short is right');
  });
});
