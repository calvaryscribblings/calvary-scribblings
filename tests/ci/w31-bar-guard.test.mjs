// W31 — the site bar (Navbar) gets W16's viewport guard, from ONE hook shared with StoryBar, and
// "apart" means NOT PAINTED. Pure and source halves; the frame-sampled half is
// tests/storybar/w16-probe.mjs (--page /public-library --bar .cs-nav).
//
//   node --test tests/ci/w31-bar-guard.test.mjs      (part of npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barView, apartCss, initialBar, BAR_THRESHOLD } from '../../app/lib/storyBar.js';

const src = (p) => readFileSync(p, 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const AGREE = { offsetTop: 0, scale: 1 };
const ZOOMED = { offsetTop: 0, scale: 1.8 };
const PANNED = { offsetTop: 444, scale: 1 };        // Ikenna's 30 Sep picture: layout top 444px down
const sample = (y, vv) => ({ y, maxY: 10000, h: 874, vv });

describe('W31 · barView — three answers', () => {
  test('the site bar (no scroll-hide): agreeing → shown; zoomed or panned → apart', () => {
    assert.equal(barView(initialBar(), sample(0, AGREE)).view, 'shown');
    assert.equal(barView(initialBar(), sample(0, null)).view, 'shown', 'no visualViewport: nothing to disagree with');
    assert.equal(barView(initialBar(), sample(900, ZOOMED)).view, 'apart');
    assert.equal(barView(initialBar(), sample(900, PANNED)).view, 'apart');
  });
  test('the site bar comes back the moment they agree — wherever the page is scrolled', () => {
    const apart = barView(initialBar(), sample(3000, PANNED));
    assert.equal(barView(apart, sample(3000, AGREE)).view, 'shown');
  });
  test('the story bar: its ordinary scroll-hide is "hidden" (slid, painted); apart is "apart"', () => {
    let s = barView(initialBar(), sample(0, AGREE), true);
    s = barView(s, sample(400, AGREE), true);
    s = barView(s, sample(400 + BAR_THRESHOLD, AGREE), true);
    assert.equal(s.view, 'hidden');
    assert.equal(barView(s, sample(400 + BAR_THRESHOLD, ZOOMED), true).view, 'apart');
    const back = barView(barView(s, sample(2000, ZOOMED), true), sample(2000, AGREE), true);
    assert.equal(back.view, 'hidden', 'agreeing again off the top zone: W16 waits for a scroll up');
  });
});

describe('W31 · "apart" is not painted', () => {
  test('apartCss: visibility hidden and pointer events off — never only a slide', () => {
    const css = apartCss('.x');
    assert.match(css, /^\.x\[data-state="apart"\] \{[^}]*visibility: hidden;/);
    assert.match(css, /pointer-events: none;/);
  });
  test('StoryBar: apart is lifted AND unpainted; the scroll-hide keeps only its slide', () => {
    const b = code('app/components/StoryBar.js');
    assert.match(b, /\$\{apartCss\('\[data-story-bar\]'\)\}/);
    assert.match(b, /\[data-story-bar\]\[data-state="apart"\] \{ transform: translate3d\(0, -100%, 0\); \}/);
    const hidden = b.match(/\[data-story-bar\]\[data-state="hidden"\] \{[^}]*\}/)[0];
    assert.doesNotMatch(hidden, /visibility|pointer-events/, 'the ordinary scroll-hide must stay painted');
  });
  test('Navbar: its <nav> carries the state and the apart rule', () => {
    const n = code('app/components/Navbar.js');
    assert.match(n, /\$\{apartCss\('\.cs-nav'\)\}/);
    assert.match(n, /<nav ref=\{navRef\} data-state="shown" className=\{`cs-nav /);
  });
});

describe('W31 · one guard, shared', () => {
  test('StoryBar, Navbar and the verify banner all call useViewportGuard; nobody keeps a private copy', () => {
    assert.match(code('app/components/StoryBar.js'), /useViewportGuard\(ref, \{ hideOnScroll \}\)/);
    assert.match(code('app/components/Navbar.js'), /useViewportGuard\(navRef, \{ hold: menuOpen \}\)/, 'the open drawer holds the bar');
    assert.match(code('app/components/VerifyEmailBanner.js'), /useViewportGuard\(bannerRef, \{ hold: !visible \}\)/);
    for (const f of ['app/components/StoryBar.js', 'app/components/Navbar.js', 'app/components/VerifyEmailBanner.js']) {
      assert.doesNotMatch(code(f), /visualViewport/, `${f} reads the viewport itself — use the hook`);
    }
  });
  test('the hook: rAF-coalesced, window scroll/resize + visualViewport resize/scroll, one attribute write, no state', () => {
    const h = code('app/components/useBarGuard.js');
    assert.match(h, /requestAnimationFrame\(read\)/);
    for (const [t, e] of [['window', 'scroll'], ['window', 'resize'], ['vvp\\?', 'resize'], ['vvp\\?', 'scroll']]) {
      assert.match(h, new RegExp(`${t}\\.addEventListener\\('${e}', on`), `${t} ${e}`);
    }
    assert.match(h, /el\.setAttribute\('data-state', s\.view\)/);
    assert.match(h, /barView\(/);
    assert.doesNotMatch(h, /useState/);
  });
  test('the readout reports the tab bar\'s bottom edge on the glass', () => {
    const r = code('app/components/BarReadout.js');
    assert.match(r, /querySelector\('\.cs-tabbar'\)/);
    assert.match(r, /tabbar   /);
  });
});
