// THE LOCK — W9's contract, pure, so the suite can hold every number without rendering JSX.
// Rendered by app/components/ArchiveLock.js, on story pages (cream) and in the Series (dark).
//
// Design language: the April 2026 age gate — a ringed lock mark, a small-caps eyebrow, a light
// Cormorant headline, a soft radial glow — translated for the cream reading ground as well as
// the dark one. Everything is spaced on an 8px rhythm; the numbers below are the design.
//
// ── THE FADE, AND WHY IT HAD A BOX ─────────────────────────────────────────────────────────
// Until W9 the fade ended in #f5f0e8 on a page whose reading ground is #f0ead8, so its lower
// half was a visibly paler rectangle; and it sat inside its own 2rem side padding within the
// article's, 64px narrower than the text and offset from its left edge. The fade now ends in
// the EXACT ground, starts from the same colour at alpha 0 (never from a transparent black,
// which greys the middle), and spans the full measure with no padding of its own.

export const LOCK_MAX_WIDTH = 520;
export const LOCK_RHYTHM = {
  fadeHeight: 160,      // how far up into the last lines the fade reaches
  fadeToMark: 24,       // the fade ends this far above the lock mark
  mark: 56,             // the ring's outer diameter
  glyph: 22,            // the lock glyph's box
  stroke: 1.5,          // the glyph's stroke
  markToEyebrow: 24,
  eyebrowToHeadline: 12,
  headlineToBody: 16,
  bodyToCta: 32,
  ctaHeight: 48,
  ctaToSignIn: 16,
};
export const LOCK_REVEAL_MS = 500;

export const LOCK_THEMES = {
  cream: {
    ground: '#f0ead8',            // .story-body-wrap — the reading ground, exactly
    ring: 'rgba(127,103,38,0.55)', // ink gold #7f6726, hairline
    wash: 'rgba(201,168,76,0.08)',
    glyph: '#7f6726',
    eyebrow: '#7f6726',            // ink gold on cream (house-gold tone pair)
    headline: '#1f1a12',
    body: '#4f473a',
    cta: '#7f6726',
    ctaBorder: 'rgba(127,103,38,0.6)',
    ctaHoverWash: 'rgba(201,168,76,0.10)',
    link: '#4f473a',
    glow: 'rgba(201,168,76,0.14)',  // gold at very low alpha
  },
  dark: {
    ground: '#080610',             // the Series page
    ring: 'rgba(201,168,76,0.55)',
    wash: 'rgba(201,168,76,0.07)',
    glyph: '#c9a84c',
    eyebrow: '#c9a84c',            // gold on dark (the cross-repo contract)
    headline: '#f5f0e8',
    body: '#cfc6b6',
    cta: '#c9a84c',
    ctaBorder: 'rgba(201,168,76,0.6)',
    ctaHoverWash: 'rgba(201,168,76,0.10)',
    link: '#cfc6b6',
    glow: 'rgba(107,47,173,0.30)',  // purple on dark
  },
};

// ── COPY ────────────────────────────────────────────────────────────────────────────────────
// The story body is the APP's words (DRAFT), so both platforms say the same thing. The old
// "free to read for its first week" contradicted the ruled LONDON CALENDAR WEEK (W4): a story
// published on a Sunday is free for one day, not seven.
export const STORY_LOCK_COPY = {
  eyebrow: 'From the archive',
  headline: 'This story is in the archive.',
  body: 'Every story published this week is free to read, Monday to Sunday. Earlier stories are open to members.',
  cta: 'See membership',
  signIn: ['Already a member?', 'Sign in'],
};
export const STORY_LOCK_STATUS = 'DRAFT';

// Degraded: the membership read failed. NO UPSELL (see StoryGate.js) — a retry and nothing else.
export const DEGRADED_LOCK_COPY = {
  eyebrow: 'From the archive',
  headline: 'We could not check your membership just now.',
  body: 'You are reading the opening. If you are a member, a refresh should bring the rest.',
  cta: 'Try again',
};

export const SERIES_LOCK_COPY = {
  eyebrow: 'The Series',
  headline: 'This instalment is for members.',
  cta: 'See membership',
  signIn: ['Already a member?', 'Sign in'],
};

// ── THE MARK ────────────────────────────────────────────────────────────────────────────────
// A 22-unit box drawn at 22px, stroke 1.5. Pixel-snapped at 2x (the phones and iPads this is
// read on): every stroke EDGE — centre ± 0.75 — falls on a multiple of 0.5, i.e. on a device
// pixel. So centres sit at n.25 / n.75. Optically centred, not geometrically: the body is the
// visual mass, so the shackle's extra height is split 3 above / 2.5 below rather than 3.5 / 2.
export const LOCK_GLYPH = {
  viewBox: '0 0 22 22',
  body: { x: 4.75, y: 10.25, width: 12.5, height: 8.5, rx: 2 },   // edges 4 → 18, 9.5 → 19.5
  shackle: 'M7.75 10.25V7a3.25 3.25 0 0 1 6.5 0v3.25',             // legs 7 → 8.5, 13.5 → 15; top edge 3
  keyhole: { cx: 11, cy: 14.5, r: 1 },                                // filled, 10 → 12
};

// ── MEASUREMENT ─────────────────────────────────────────────────────────────────────────────
function rgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2 contrast ratio of two opaque hex colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The fade: the ground at alpha 0 to the ground, top to bottom. No other colour ever appears. */
export function fadeGradient(ground) {
  const [r, g, b] = rgb(ground);
  return `linear-gradient(to bottom, rgba(${r},${g},${b},0) 0%, rgba(${r},${g},${b},0.72) 55%, rgb(${r},${g},${b}) 100%)`;
}

/** The glow behind the block. Radial, ending transparent inside its own box — no edge. */
export function glowGradient(glow) {
  return `radial-gradient(ellipse 50% 50% at 50% 45%, ${glow} 0%, transparent 100%)`;
}

// ── THE FOUNDER-PREVIEW PILL ────────────────────────────────────────────────────────────────
// The pill is fixed at the bottom-left; the lock scrolls. At 390 the block is the full width, so
// there is no resting place the lock cannot pass under. The pill therefore STEPS ASIDE — slides
// below the viewport edge — whenever its resting box would overlap a lock block, by more than
// nothing, plus a gap of PILL_CLEARANCE. It comes back as soon as the block has moved on.
export const PILL_CLEARANCE = 12;
/** True when two {left, top, right, bottom} boxes come within `gap` px of each other. */
export function boxesClash(a, b, gap = PILL_CLEARANCE) {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}
