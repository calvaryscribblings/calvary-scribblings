// W9 — THE LOCK and THE BAR, pure halves.
//
//   node --test tests/ci/w9-lock-bar.test.mjs      (part of npm run test:ci)
//
// The frame-sampled half is tests/storybar/bar-probe.mjs (WebKit, iPad and iPhone sizes).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCK_THEMES, LOCK_RHYTHM, LOCK_MAX_WIDTH, LOCK_REVEAL_MS, LOCK_GLYPH, STORY_LOCK_COPY, SERIES_LOCK_COPY,
  contrast, fadeGradient, boxesClash, PILL_CLEARANCE,
} from '../../app/lib/archiveLock.js';
import { nextBar, initialBar, BAR_THRESHOLD, BAR_TOP_ZONE } from '../../app/lib/storyBar.js';

const src = (p) => readFileSync(p, 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('W9 · the lock — the words', () => {
  // RULED (Ikenna, 26 Sep 2026): these words stand exactly as they are. Changing one needs a new ruling.
  test('no lock carries a DRAFT mark any more', () => {
    assert.doesNotMatch(src('app/lib/archiveLock.js'), /DRAFT/);
  });
  test('the ruled words, and "this week" — never "first week"', () => {
    assert.equal(STORY_LOCK_COPY.eyebrow, 'From the archive');
    assert.equal(STORY_LOCK_COPY.headline, 'This story is in the archive.');
    assert.equal(STORY_LOCK_COPY.body, 'Every story published this week is free to read, Monday to Sunday. Earlier stories are open to members.');
    assert.equal(STORY_LOCK_COPY.cta, 'See membership');
    assert.deepEqual(STORY_LOCK_COPY.signIn, ['Already a member?', 'Sign in']);
  });
  test('the old "first week" line is gone from every lock surface', () => {
    for (const p of ['app/components/StoryGate.js', 'app/components/ArchiveLock.js', 'app/lib/archiveLock.js',
      'app/series/instalment/[instalmentId]/page-instalment.js', 'app/series/read/[instalmentId]/page-reader.js']) {
      assert.doesNotMatch(code(p), /first week/i, p);
    }
  });
  test('StoryGate is the ArchiveLock, cream, with the fade; sign-in only when signed out; degraded has no upsell', () => {
    const g = code('app/components/StoryGate.js');
    assert.match(g, /import ArchiveLock from '\.\/ArchiveLock'/);
    assert.match(g, /theme="cream" fade/);
    assert.match(g, /signIn=\{signedIn \? null :/);
    const degraded = g.slice(g.indexOf('gate.degraded'), g.indexOf('return (', g.indexOf('gate.degraded') + 60));
    assert.doesNotMatch(degraded, /membership/, 'the degraded branch sells nothing');
  });
  test('the Series lock is the same component, dark, on both Series surfaces', () => {
    for (const p of ['app/series/instalment/[instalmentId]/page-instalment.js', 'app/series/read/[instalmentId]/page-reader.js']) {
      const s = code(p);
      assert.match(s, /import ArchiveLock from/, p);
      assert.match(s, /<ArchiveLock theme="dark"/, p);
    }
    assert.equal(SERIES_LOCK_COPY.cta, STORY_LOCK_COPY.cta);
  });
  // RULED (Ikenna, 26 Sep 2026): the Series lock stands as A12 set it, matching the app.
  test('the Series lock\'s ruled words: "FROM THE SERIES" / "This instalment is closed." / the refusal line', () => {
    assert.equal(SERIES_LOCK_COPY.eyebrow.toUpperCase(), 'FROM THE SERIES');
    assert.equal(SERIES_LOCK_COPY.headline, 'This instalment is closed.');
    assert.equal(SERIES_LOCK_COPY.cta, 'See membership');
    assert.deepEqual(SERIES_LOCK_COPY.signIn, ['Already a member?', 'Sign in']);
    assert.equal('body' in SERIES_LOCK_COPY, false, 'the body is the instalment\'s own refusal line');
    assert.match(code('app/series/instalment/[instalmentId]/page-instalment.js'), /body=\{refusalCopy\(grant\)\}/);
    assert.match(code('app/series/read/[instalmentId]/page-reader.js'), /body=\{copy\.body\}/);
  });
});

describe('W9 · the lock — colour and contrast', () => {
  test('the body line reaches 4.5:1 on its ground, in both themes (today\'s grey was 3.12:1)', () => {
    assert.ok(contrast('#8a8378', '#f0ead8') < 4.5, 'the old grey fails');
    for (const [k, t] of Object.entries(LOCK_THEMES)) {
      assert.ok(contrast(t.body, t.ground) >= 4.5, `${k} body ${contrast(t.body, t.ground).toFixed(2)}`);
      assert.ok(contrast(t.headline, t.ground) >= 4.5, `${k} headline`);
      assert.ok(contrast(t.eyebrow, t.ground) >= 4.5, `${k} eyebrow ${contrast(t.eyebrow, t.ground).toFixed(2)}`);
    }
  });
  test('ink gold #7f6726 on cream, gold #c9a84c on dark', () => {
    assert.equal(LOCK_THEMES.cream.eyebrow, '#7f6726');
    assert.equal(LOCK_THEMES.dark.eyebrow, '#c9a84c');
  });
  test('the cream ground IS the story page\'s reading ground', () => {
    assert.match(src('app/stories/[slug]/page-client.js'), /\.story-body-wrap \{ background: #f0ead8;/);
    assert.equal(LOCK_THEMES.cream.ground, '#f0ead8');
  });
  test('the glow: gold on cream, purple on dark', () => {
    assert.match(LOCK_THEMES.cream.glow, /^rgba\(201,168,76,0\.\d+\)$/);
    assert.match(LOCK_THEMES.dark.glow, /^rgba\(107,47,173,0\.\d+\)$/);
  });
});

describe('W9 · the fade — no box', () => {
  test('it ends in the EXACT ground and contains no other colour', () => {
    const g = fadeGradient('#f0ead8');
    assert.match(g, /rgb\(240,234,216\) 100%\)$/);
    const colours = g.match(/rgba?\(([^)]+)\)/g).map((c) => c.replace(/rgba?\(|\)/g, '').split(',').slice(0, 3).join(','));
    assert.deepEqual([...new Set(colours)], ['240,234,216'], 'one colour, varying alpha only');
    assert.match(g, /^linear-gradient\(to bottom, rgba\(240,234,216,0\) 0%/);
  });
  test('the old pale-rectangle fade (#f5f0e8 on a #f0ead8 page) is gone', () => {
    assert.doesNotMatch(code('app/components/StoryGate.js'), /f5f0e8/i);
  });
  test('it spans the full measure: no side padding on the fade or around it', () => {
    const a = src('app/components/ArchiveLock.js');
    const fade = a.slice(a.indexOf('data-archive-fade'), a.indexOf('}} />', a.indexOf('data-archive-fade')));
    assert.match(fade, /width: '100%'/);
    assert.doesNotMatch(fade, /padding|margin(Left|Right)|maxWidth/);
    assert.doesNotMatch(code('app/components/StoryGate.js'), /padding/);
  });
  test('it ends 24px above the mark', () => { assert.equal(LOCK_RHYTHM.fadeToMark, 24); });
});

describe('W9 · the block — the rhythm', () => {
  test('the numbers, on an 8px rhythm (12 is the brief\'s half-step)', () => {
    assert.equal(LOCK_MAX_WIDTH, 520);
    assert.deepEqual(
      [LOCK_RHYTHM.mark, LOCK_RHYTHM.glyph, LOCK_RHYTHM.stroke, LOCK_RHYTHM.markToEyebrow, LOCK_RHYTHM.eyebrowToHeadline,
        LOCK_RHYTHM.headlineToBody, LOCK_RHYTHM.bodyToCta, LOCK_RHYTHM.ctaHeight, LOCK_RHYTHM.ctaToSignIn],
      [56, 22, 1.5, 24, 12, 16, 32, 48, 16]);
    assert.equal(LOCK_REVEAL_MS, 500);
  });
  test('the component draws them: Cinzel 11px tracked 0.24em, Cormorant 300 at 30–34px, a 48px CTA', () => {
    const a = src('app/components/ArchiveLock.js');
    assert.match(a, /fontSize: 11, lineHeight: '16px',\s*letterSpacing: '0\.24em', textTransform: 'uppercase'/);
    assert.match(a, /fontWeight: 300,\s*fontSize: 'clamp\(30px, [^,]+, 34px\)'/);
    assert.match(a, /height: R\.ctaHeight/);
    assert.match(a, /prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation: none/);
  });
  test('the glyph is pixel-snapped at 2x and centred: every stroke edge on a 0.5 grid', () => {
    const half = 1.5 / 2;
    const onGrid = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
    const { x, y, width, height } = LOCK_GLYPH.body;
    for (const e of [x - half, x + half, x + width - half, x + width + half, y - half, y + half, y + height - half, y + height + half]) {
      assert.ok(onGrid(e), `body edge ${e}`);
    }
    assert.equal(x + width / 2, 11, 'centred horizontally');
    const [, lx, top] = LOCK_GLYPH.shackle.match(/^M([\d.]+) ([\d.]+)/).map(Number);
    for (const e of [lx - half, lx + half, 22 - lx - half, 22 - lx + half]) assert.ok(onGrid(e), `shackle leg edge ${e}`);
    const k = LOCK_GLYPH.keyhole;
    assert.ok(onGrid(k.cx - k.r) && onGrid(k.cy - k.r) && k.cx === 11);
    // optical: 3 above, 2.5 below
    const arcTop = Number(LOCK_GLYPH.shackle.match(/V([\d.]+)a([\d.]+)/)[1]) - Number(LOCK_GLYPH.shackle.match(/a([\d.]+)/)[1]) - half;
    assert.equal(arcTop, 3);
    assert.equal(22 - (y + height + half), 2.5);
    assert.ok(top === y);
  });
});

describe('W9 · the founder pill never sits on the lock', () => {
  test('boxesClash: overlap and near-miss clash; clear boxes do not', () => {
    const pill = { left: 12, right: 280, top: 800, bottom: 832 };
    assert.equal(boxesClash(pill, { left: 0, right: 390, top: 700, bottom: 900 }), true);
    assert.equal(boxesClash(pill, { left: 0, right: 390, top: 850, bottom: 1000 }), true, 'within the 24px clearance');
    assert.equal(boxesClash(pill, { left: 0, right: 390, top: 860, bottom: 1000 }), false);
    assert.equal(boxesClash(pill, { left: 330, right: 850, top: 700, bottom: 900 }), false, 'beside it at 1180');
    assert.equal(PILL_CLEARANCE, 24);
  });
  test('the pill checks every lock block, steps aside on a clash, and the lock block carries the marker', () => {
    const g = code('app/components/GatePreview.js');
    assert.match(g, /querySelectorAll\('\[data-archive-lock\]'\)/);
    assert.match(g, /data-aside="1"\] \{ transform: translateY\(calc\(100% \+ 24px\)\); opacity: 0; pointer-events: none; transition: none; \}/, 'leaves at once — no visible slide over the lock');
    assert.match(src('app/components/ArchiveLock.js'), /data-archive-lock=""/);
  });
});

// ── THE BAR ─────────────────────────────────────────────────────────────────────────────────
const H = 844, MAX = 20000;
const run = (ys, { h = H, max = MAX, from = null } = {}) => {
  let s = from || initialBar();
  const states = [];
  for (const y of ys) {
    const hh = typeof y === 'object' ? y.h : h;
    const yy = typeof y === 'object' ? y.y : y;
    s = nextBar(s, { y: yy, maxY: max, h: hh });
    states.push(s.state);
  }
  return { s, states };
};

describe('W9 · the bar — only ever fully shown or fully hidden, and never from a bounce', () => {
  test('scrolling down past the threshold hides it once; scrolling up past it shows it once', () => {
    const down = run([1000, 1010, 1020, 1040, 1100, 1300]);
    assert.equal(down.s.state, 'hidden');
    assert.equal(down.states.filter((x, i, a) => i && x !== a[i - 1]).length, 1);
    const up = run([1250, 1240, 1200, 1100], { from: down.s });
    assert.equal(up.s.state, 'shown');
  });
  test('a momentum tail — small jitters under the threshold — never flips it', () => {
    const hidden = run([1000, 1200]).s;
    assert.equal(hidden.state, 'hidden');
    const tail = run([1210, 1205, 1212, 1190, 1195, 1180, 1182], { from: hidden });
    assert.ok(tail.states.every((x) => x === 'hidden'), tail.states.join());
    assert.ok(BAR_THRESHOLD >= 24);
  });
  test('RUBBER-BAND AT THE BOTTOM: the overshoot and the spring back are ignored — it stays hidden', () => {
    const hidden = run([MAX - 400, MAX]).s;
    assert.equal(hidden.state, 'hidden');
    const bounce = [MAX + 12, MAX + 52, MAX + 80, MAX + 60, MAX + 24, MAX + 3, MAX];
    const r = run(bounce, { from: hidden });
    assert.ok(r.states.every((x) => x === 'hidden'), r.states.join());
  });
  test('RUBBER-BAND AT THE TOP: negative scrollY changes nothing, and the bar is shown throughout', () => {
    const r = run([0, -12, -52, -80, -40, -3, 0]);
    assert.ok(r.states.every((x) => x === 'shown'));
  });
  test('THE TOOLBAR: a viewport height change clamping scrollY is not a scroll up', () => {
    const hidden = run([MAX - 400, MAX]).s;
    // the toolbar expands at the bottom: innerHeight shrinks 74px, and scrollY is clamped down by 74
    const r = run([{ y: MAX - 74, h: H - 74 }, { y: MAX - 74, h: H - 74 }, { y: MAX, h: H }], { from: hidden, max: MAX });
    assert.ok(r.states.every((x) => x === 'hidden'), r.states.join());
  });
  test('within the top zone the bar is always shown', () => {
    const hidden = run([1000, 1400]).s;
    assert.equal(run([BAR_TOP_ZONE], { from: hidden }).s.state, 'shown');
  });
});

describe('W9 · the bar — pinned, and the line on its edge', () => {
  test('StoryBar: fixed at top 0 with the safe-area inset as padding; hidden is exactly -100%; line at top:100%', () => {
    const b = src('app/components/StoryBar.js');
    assert.match(b, /\[data-story-bar\] \{ position: fixed; top: 0; left: 0; right: 0;/);
    assert.match(b, /padding-top: env\(safe-area-inset-top, 0px\)/);
    assert.match(b, /\[data-story-bar\]\[data-state="hidden"\] \{ transform: translate3d\(0, -100%, 0\); \}/);
    assert.match(b, /\[data-story-bar-progress\] \{ position: absolute; left: 0; right: 0; top: 100%;/);
    // No scroll-derived offset: the only transforms are the two resting values.
    assert.deepEqual((code('app/components/StoryBar.js').match(/translate3d\([^)]*\)/g) || []).sort(), ['translate3d(0, -100%, 0)', 'translate3d(0, 0, 0)']);
    assert.doesNotMatch(code('app/components/StoryBar.js'), /useState/, 'no React state per scroll');
  });
  test('the story page (story, news, poetry) uses it, and the old 3px bar and its per-scroll state are gone', () => {
    const p = code('app/stories/[slug]/page-client.js');
    assert.match(p, /<StoryBar hideOnScroll progressRef=\{threadRef\} className="story-nav">/);
    assert.doesNotMatch(p, /top: 3px/);
    assert.doesNotMatch(p, /\.story-nav\.hidden|className="reading-progress"|setLastScrollY|setIsHeaderVisible/);
  });
  test('the Series pages use it too — no sticky nav left to ride the bounce', () => {
    for (const p of ['app/series/[slug]/page-detail.js', 'app/series/instalment/[instalmentId]/page-instalment.js']) {
      const s = code(p);
      assert.match(s, /<StoryBar style=/, p);
      assert.doesNotMatch(s, /position: 'sticky'/, p);
    }
  });
});

test('W9 · the story bar\'s hairline is a shadow, so the progress line meets the bar\'s edge exactly', () => {
  const p = code('app/stories/[slug]/page-client.js');
  const rule = p.match(/\.story-nav \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /border/);
  assert.match(rule, /box-shadow: inset 0 -1px 0/);
});

test('W9 · the headline\'s Cormorant 300 is actually loaded (not faked from 400)', () => {
  assert.match(src('app/layout.js'), /Cormorant\+Garamond:ital,wght@0,300;/);
});
