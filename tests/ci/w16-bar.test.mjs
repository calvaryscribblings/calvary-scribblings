// W16 — the story bar on the glass, the containing-block guard, the founder readout, the build ID
// and the service worker's last stale path. Pure and source halves.
//
//   node --test tests/ci/w16-bar.test.mjs      (part of npm run test:ci)
//
// The frame-sampled half is tests/storybar/w16-probe.mjs (WebKit: on-screen position, every
// ancestor on every frame, rotation, viewports apart, and a canary the check must catch).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nextBar, initialBar, viewportsAgree, containingBlockReason, containingBlockAncestor,
  BAR_THRESHOLD, VIEWPORT_TOLERANCE_PX, ZOOM_TOLERANCE,
} from '../../app/lib/storyBar.js';
import { isStaleBuild } from '../../app/lib/buildId.js';

const src = (p) => readFileSync(p, 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const run = (samples, s = initialBar()) => samples.reduce((acc, x) => nextBar(acc, { maxY: 10000, h: 800, ...x }), s);
const AGREE = { offsetTop: 0, scale: 1 };

describe('W16 · the viewports must agree before the bar is shown', () => {
  test('agree: no visualViewport, offsetTop 0, within the tolerances, and the top rubber-band (negative)', () => {
    assert.equal(viewportsAgree(null), true);
    assert.equal(viewportsAgree(AGREE), true);
    assert.equal(viewportsAgree({ offsetTop: VIEWPORT_TOLERANCE_PX, scale: 1 + ZOOM_TOLERANCE }), true);
    assert.equal(viewportsAgree({ offsetTop: -60, scale: 1 }), true);
  });
  test('apart: zoomed, or panned down inside the layout viewport', () => {
    assert.equal(viewportsAgree({ offsetTop: 0, scale: 1.5 }), false);
    assert.equal(viewportsAgree({ offsetTop: 300, scale: 1 }), false);
    assert.equal(viewportsAgree({ offsetTop: 300, scale: 1.8 }), false);
  });
  test('a SHOWN bar is hidden the moment they come apart — even in the top zone, even mid-scroll-up', () => {
    let s = run([{ y: 0, vv: AGREE }, { y: 40, vv: AGREE }]);
    assert.equal(s.state, 'shown');
    s = nextBar(s, { y: 40, maxY: 10000, h: 800, vv: { offsetTop: 0, scale: 1.8 } });
    assert.equal(s.state, 'hidden');
    s = run([{ y: 1000, vv: { offsetTop: 300, scale: 1 } }, { y: 600, vv: { offsetTop: 300, scale: 1 } }], s);
    assert.equal(s.state, 'hidden', 'a scroll up while apart does not bring it back');
  });
  test('when they agree again: shown in the top zone, otherwise hidden until a real scroll up', () => {
    const apart = run([{ y: 0 }, { y: 2000, vv: { offsetTop: 0, scale: 2 } }]);
    const back = nextBar(apart, { y: 2000, maxY: 10000, h: 800, vv: AGREE });
    assert.equal(back.state, 'hidden');
    assert.equal(back.apart, false);
    assert.equal(run([{ y: 2000 - BAR_THRESHOLD - 1, vv: AGREE }], back).state, 'shown');
    const top = nextBar(apart, { y: 20, maxY: 10000, h: 800, vv: AGREE });
    assert.equal(top.state, 'shown');
  });
  test('W9 still holds with the viewports agreeing (vv passed every frame)', () => {
    const s = run([{ y: 0 }, { y: 400 }, { y: 400 + BAR_THRESHOLD }].map((x) => ({ ...x, vv: AGREE })));
    assert.equal(s.state, 'hidden');
  });
});

describe('W16 · the containing-block check', () => {
  const NONE = { transform: 'none', translate: 'none', rotate: 'none', scale: 'none', perspective: 'none', filter: 'none', backdropFilter: 'none', webkitBackdropFilter: 'none', contain: 'none', willChange: 'auto', containerType: 'normal', contentVisibility: 'visible', transformStyle: 'flat' };
  test('a plain element is not a containing block', () => { assert.equal(containingBlockReason(NONE), null); });
  for (const [k, v] of [['transform', 'matrix(1, 0, 0, 1, 0, 0)'], ['translate', '0px 4px'], ['rotate', '1deg'], ['scale', '1.01'],
    ['perspective', '800px'], ['filter', 'blur(2px)'], ['backdropFilter', 'blur(8px)'], ['webkitBackdropFilter', 'blur(8px)'],
    ['contain', 'paint'], ['contain', 'layout'], ['contain', 'strict'], ['contain', 'content'], ['willChange', 'transform'],
    ['willChange', 'opacity, filter'], ['willChange', 'backdrop-filter'], ['containerType', 'inline-size'], ['containerType', 'size'],
    ['contentVisibility', 'auto'], ['transformStyle', 'preserve-3d']]) {
    test(`catches ${k}: ${v}`, () => { assert.match(containingBlockReason({ ...NONE, [k]: v }) || '', new RegExp(`^${k}: `)); });
  }
  test('does NOT flag what cannot contain a fixed box: opacity, will-change: opacity, contain: style, container-type: normal', () => {
    assert.equal(containingBlockReason({ ...NONE, opacity: '0.5', willChange: 'opacity', contain: 'style' }), null);
  });
  test('walks every ancestor to <html> and names the first offender', () => {
    const mk = (tag, style, parent = null) => ({ tagName: tag, className: '', parentElement: parent, style });
    const html = mk('HTML', NONE);
    const body = mk('BODY', { ...NONE, transform: 'matrix(1, 0, 0, 1, 0, 0)' }, html);
    const wrap = mk('DIV', NONE, body);
    const bar = mk('NAV', { ...NONE, transform: 'matrix(1, 0, 0, 1, 0, 0)' }, wrap); // the bar's OWN transform is fine
    assert.deepEqual(containingBlockAncestor(bar, (el) => el.style), { tag: 'body', reason: 'transform: matrix(1, 0, 0, 1, 0, 0)' });
    body.style = NONE;
    assert.equal(containingBlockAncestor(bar, (el) => el.style), null);
  });
});

describe('W16 · the bar has no ancestor but <body>', () => {
  test('the story page mounts <StoryBar> OUTSIDE the animated fade-in wrapper', () => {
    const p = code('app/stories/[slug]/page-client.js');
    const ret = p.slice(p.indexOf('const showQuiz = quizAllowed(story);'));
    const bar = ret.indexOf('<StoryBar hideOnScroll progressRef={threadRef}');
    const wrap = ret.indexOf("<div className={storyReady ? 'story-fade-in' : ''}");
    assert.ok(bar > 0 && wrap > 0 && bar < wrap, 'the bar opens before the wrapper');
    const between = ret.slice(ret.indexOf('</style>'), bar);
    assert.doesNotMatch(between, /<(div|main|section|article|header)\b/, 'nothing opens between the fragment and the bar');
  });
  test('no global rule puts a containing-block property on html, body or *', () => {
    const PROPS = /\b(transform|filter|backdrop-filter|perspective|contain|will-change|container-type|content-visibility|translate|rotate|scale)\s*:/;
    for (const p of ['app/globals.css', 'app/stories/[slug]/page-client.js', 'app/series/[slug]/page-detail.js', 'app/series/instalment/[instalmentId]/page-instalment.js']) {
      for (const m of src(p).matchAll(/(?:^|[}\s,])((?:html|body|\*|:root)(?:\s*,\s*[^{]+)?)\s*\{([^}]*)\}/g)) {
        assert.doesNotMatch(m[2], PROPS, `${p}: ${m[1].trim()} { ${m[2].trim()} }`);
      }
    }
  });
  test('the Series shells that wrap the bar carry no containing-block property', () => {
    for (const p of ['app/series/[slug]/page-detail.js', 'app/series/instalment/[instalmentId]/page-instalment.js']) {
      const s = code(p);
      const shell = s.slice(s.indexOf('function Shell('), s.indexOf('<StoryBar', s.indexOf('function Shell(')));
      assert.doesNotMatch(shell, /transform|filter|perspective|contain|willChange|containerType|contentVisibility/, p);
    }
  });
});

describe('W16 · the founder readout', () => {
  test('StoryBar loads it only for a founder AND ?debug=bar, and only by dynamic import', () => {
    const b = code('app/components/StoryBar.js');
    assert.match(b, /isFounder\(uid\)/);
    assert.match(b, /get\('debug'\) !== 'bar'/);
    assert.match(b, /import\('\.\/BarReadout'\)/);
    assert.doesNotMatch(b, /^import .*BarReadout/m, 'never a static import');
  });
  test('it shows the build, live build, scrollY, visualViewport top/height, the bar on screen, its state and the ancestor check', () => {
    const r = code('app/components/BarReadout.js');
    for (const k of ['BUILD_COMMIT', 'readLiveBuild', 'window.scrollY', 'vv.offsetTop', 'vv.height', 'screenTop', "getAttribute('data-state')", 'containingBlockAncestor']) assert.ok(r.includes(k), k);
    assert.match(r, /document\.body\.appendChild\(box\)/, 'a sibling of the page, never an ancestor of the bar');
    assert.doesNotMatch(r, /\b(set|update|push|remove)\(ref\(|fetch\([^)]*method/, 'it writes nothing');
  });
});

describe('W16 · the build ID', () => {
  test('next.config bakes the commit with the same derivation as build.json and sw.js (12 chars)', () => {
    const n = src('next.config.mjs');
    assert.match(n, /NEXT_PUBLIC_BUILD_COMMIT: BUILD_COMMIT/);
    assert.match(n, /CF_PAGES_COMMIT_SHA/);
    assert.match(n, /\.slice\(0, 12\)/);
    assert.match(src('scripts/stamp-build-info.mjs'), /commit\.slice\(0, 12\)/);
    assert.match(src('scripts/stamp-sw.mjs'), /CF_PAGES_COMMIT_SHA\.slice\(0, 12\)/);
  });
  test('it is on the story page and in the site footer', () => {
    assert.match(code('app/stories/[slug]/page-client.js'), /<BuildStamp /);
    assert.match(code('app/components/Footer.js'), /<BuildStamp /);
    assert.match(code('app/components/BuildStamp.js'), /Build \{BUILD_COMMIT\}/);
  });
  test('stale only when both builds are known and differ', () => {
    assert.equal(isStaleBuild('51dec01c5f11', '0123456789ab'), true);
    assert.equal(isStaleBuild('51dec01c5f11', '51dec01c5f11'), false);
    assert.equal(isStaleBuild('51dec01c5f11', null), false);
    assert.equal(isStaleBuild('dev', '0123456789ab'), false);
  });
  test('a resumed reading tab on an old build reloads only in the top zone, on reading routes', () => {
    const p = code('app/components/Providers.js');
    assert.match(p, /\^\\\/\(stories\|series\)\\\//);
    assert.match(p, /window\.scrollY > 80\) return/);
    assert.match(p, /e\.persisted/);
  });
});

describe('W16 · the service worker never hands an online reader an old build', () => {
  const sw = code('public/sw.js');
  test('no timeout race: the cache answers only when the network FAILS', () => {
    assert.doesNotMatch(sw, /withTimeout|Promise\.race/);
    assert.match(sw, /async function networkFirst\(request\) \{[\s\S]*?return await live;/);
    assert.match(sw, /async function navigateNetworkFirst\(event\) \{[\s\S]*?return await live;/);
  });
  test('cache-first is still ONLY the content-hashed chunks', () => {
    assert.equal((sw.match(/cacheFirst\(event\.request\)/g) || []).length, 1);
    assert.match(sw, /if \(isStaticChunk\(url\)\) \{\s*event\.respondWith\(cacheFirst\(event\.request\)\);/);
  });
  test('/sw.js itself is never edge-cached, and never skipWaiting', () => {
    assert.match(src('public/_headers'), /\/sw\.js\n\s+Cache-Control: no-cache, must-revalidate/);
    assert.doesNotMatch(sw, /skipWaiting\(\)/);
  });
});
