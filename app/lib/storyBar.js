// THE STORY BAR — W9. Pure, so the suite can drive it with the scroll values an iPhone reports.
//
// ── WHY IT DRIFTED (reproduced in WebKit at 1180×820, 820×1180 and 390; tests/storybar) ──────
// Not visualViewport, not a scroll-delta transform, not sticky inside a transformed ancestor
// (none of the bar's ancestors carries a transform, filter, perspective or contain). It was the
// bar's own furniture and its own scroll logic:
//   1. The bar sat at `top: 3px`, with the reading-progress line a separate fixed element at
//      top 0 — so a 3px strip of the page showed above the bar, and the line floated 45–61px
//      above the bar's bottom edge.
//   2. Hidden was `translateY(-100%)` of a bar that started at 3px: it rested with 3px of itself
//      still on screen.
//   3. Shown/hidden flipped on EVERY scroll event, on the raw sign of the delta — no threshold,
//      no rubber-band filter. A momentum scroll's tail, a bounce at either end (iOS reports
//      scrollY below 0 and past the maximum) and the Safari toolbar expanding at the bottom (which
//      clamps scrollY down) all read as "scrolled up", so the bar kept reversing mid-transition,
//      and a bar caught between two 300ms transitions is a bar that follows the scroll.
//   4. Each event set React state, re-rendering the whole story page and re-binding the listener,
//      so on an iPad the transitions started late, from wherever the last one had got to.
//
// ── THE RULE (Ikenna, W9) ──────────────────────────────────────────────────────────────────
// Pinned flush to the viewport top (top 0, env(safe-area-inset-top) as padding), progress line on
// its bottom edge with no gap, nothing ever visible above it. It rests FULLY SHOWN or FULLY
// HIDDEN and animates between the two — never an offset derived from scroll. Rubber-band is
// ignored. This function is the whole decision; the component only writes its answer.
//
// ── W16: WHAT W9's PROOF COULD NOT SEE ──────────────────────────────────────────────────────
// Ikenna, 26 Sep 13:29, iPhone, live: the shown bar sat ~40% down the screen, text above and
// below. W9's fix WAS live (build 51dec01c, and every build since 25 Sep 16:00), no ancestor of
// the bar had a containing-block property (checked per frame on live), and the service worker
// serves no story document or unhashed script from cache. What remains is the one thing W9's
// probe measured wrongly: getBoundingClientRect().top is a LAYOUT-viewport coordinate. A fixed
// bar belongs to the layout viewport, and on iOS the layout viewport's top is the screen's top
// only while the visual viewport sits at offsetTop 0, scale 1. Zoomed in (a pinch, a double-tap,
// or Safari's own zoom onto a focused field, which outlives the keyboard) or panned by the
// keyboard, the visual viewport moves inside the layout viewport — and the bar, correctly
// "at top 0", is drawn wherever the layout top now falls on the glass: 40% down, say. W9's
// harness reported 0px because 0px is what the rect says.
//
// THE RULE, applied to that: the bar is shown only while the two viewports agree. When they
// don't, it is HIDDEN — never chased with an offset (that is a scroll-derived position, the
// thing W9 ruled out, and on iOS it lags a momentum scroll by a frame or more). When they agree
// again, it comes back only by the ordinary rules: in the top zone, or after a scroll up.

export const BAR_TOP_ZONE = 80;     // within this of the top, the bar is always shown
export const BAR_THRESHOLD = 32;    // px of travel in one direction before it changes its mind
export const BAR_TRANSITION_MS = 280;
export const VIEWPORT_TOLERANCE_PX = 2;   // visualViewport.offsetTop within this counts as "at the top"
export const ZOOM_TOLERANCE = 0.01;       // visualViewport.scale within this of 1 counts as "not zoomed"

/**
 * Is the screen's top the layout viewport's top? Only then is a `fixed; top: 0` bar at the top
 * of the glass. `vv` is window.visualViewport's { offsetTop, scale }, or null where there is
 * none (then there is nothing to disagree with).
 *   · scale above 1: zoomed — the layout viewport is bigger than the screen.
 *   · offsetTop above the tolerance: the visual viewport has been panned down inside the layout
 *     viewport (zoom, or the keyboard).
 *   · a NEGATIVE offsetTop is the rubber-band at the top, which the bar already rides out (W9).
 */
export function viewportsAgree(vv) {
  if (!vv) return true;
  const { offsetTop, scale } = vv;
  if (Number.isFinite(scale) && scale > 1 + ZOOM_TOLERANCE) return false;
  if (Number.isFinite(offsetTop) && offsetTop > VIEWPORT_TOLERANCE_PX) return false;
  return true;
}

/** Zoomed: the one case where the bar is still hidden rather than followed (BAR-1, below). */
export const isZoomed = (vv) => !!vv && Number.isFinite(vv.scale) && vv.scale > 1 + ZOOM_TOLERANCE;

// ── BAR-1: FOLLOW THE GLASS AT SCALE 1, DON'T HIDE ──────────────────────────────────────────
// Ikenna, 28 Nov 03:33, iPhone, live, NOT zoomed: the site bar PAINTED about 240pt down
// /public-library, the bottom tab bar where it belonged. W16's guard can't have hidden it: it reads
// a negative offsetTop as rubber-band, and iOS 26 has an open regression (Apple forums thread
// 800125, WebKit bug 300523) in which, after the keyboard closes or an interactive swipe-back, the
// visual viewport stays offset from the layout viewport and/or short of innerHeight, unzoomed. A
// layout viewport whose top sits 240pt below the glass while its bottom is the glass's bottom draws
// exactly that picture: top bar mid-screen, tab bar in place.
//
// Ruling (Ikenna, 28 Nov): the bar must stay at the top of the screen, not hide. So at scale 1 an
// offset of EITHER SIGN is now followed: the bar is translated by the visual viewport's offsetTop
// (the `translate` property, which composes with the story bar's own transform slide and is never
// transitioned). It does not lag the way W16 feared:
//   · in the healthy state offsetTop is 0, so nothing is applied and the bar is compositor-fixed
//     exactly as before, through every momentum scroll;
//   · the stuck offset is STATIC (that is the bug), so following it is one write, not a chase;
//   · the only moving offset at scale 1 is the keyboard's pan while a field is focused, where a
//     frame of trail is a far smaller fault than a bar 240pt down or gone.
// Zoomed (scale above 1) is where the offset moves with every pan and pinch; there the bar is
// still hidden ('apart'), as W16 ruled.

/**
 * At scale 1: how far the layout viewport's top sits from the screen's top, in CSS px: the visual
 * viewport's offsetTop when it is off by more than the tolerance either way, else 0. Zoomed: 0 (the
 * bar is hidden instead).
 */
export function viewportShift(vv) {
  if (!vv || isZoomed(vv)) return 0;
  const o = vv.offsetTop;
  return Number.isFinite(o) && Math.abs(o) > VIEWPORT_TOLERANCE_PX ? o : 0;
}

// ── BAR-1 GO: FOLLOW ONLY A SETTLED OFFSET ──────────────────────────────────────────────────
// The fault being corrected is STATIC: a viewport left offset after the keyboard or a swipe-back.
// So code never moves a bar while the offset is moving (that is the lag W16 avoided). A bar
// follows only when ALL of these hold; otherwise W16's behaviour stands (a positive offset hides the
// bar, a negative one leaves it where the layout viewport puts it):
//   · no field has focus (a keyboard is up, or about to be: its pan moves the offset per keystroke)
//   · the offset has not changed for FOLLOW_SETTLE_MS
//   · the page is not overscrolled (a rubber band at the top or the bottom)
// One rule for every bar the guard drives: the site bar (Navbar), the story bar (StoryBar, with its
// scroll-hide) and the verify banner.

/**
 * How long an offset must hold still before a bar follows it. A CHOSEN number, not a measured one:
 * long enough that a keyboard's pan, a bounce or a toolbar animation is still moving at the end of
 * it, short enough that a stuck viewport is corrected before a reader's eye has settled on the bar.
 */
export const FOLLOW_SETTLE_MS = 150;

export const initialBar = () => ({ state: 'shown', lastY: null, acc: 0, lastH: null, apart: false, off: 0, offSince: null });

/**
 * The follow decision for one sample. `now` in ms (performance.now()); `field` whether a field has
 * focus. Returns the offset seen, since when, whether the bar follows (and by how much), whether it
 * is hidden instead (W16), and how long until this offset will have settled (0 = nothing to wait for).
 */
export function followPlan(s, { y, maxY, vv, now = 0, field = false }) {
  const zoomed = isZoomed(vv);
  const off = zoomed ? 0 : Math.round(viewportShift(vv));
  const overscrolled = y < 0 || y > maxY + 1;
  const eligible = off !== 0 && !field && !overscrolled;
  // The 150ms are counted only while the bar MAY follow: an offset seen during a bounce or with a
  // field focused never counts towards settling. (When a rubber band ends, the scroll comes back a
  // moment before the offset does; that moment must not find an offset that looks long settled.)
  const offSince = eligible && off === s.off && s.offSince !== null && s.offSince !== undefined ? s.offSince : now;
  const settled = now - offSince >= FOLLOW_SETTLE_MS;
  const follow = eligible && settled;
  return {
    off, offSince, follow, shift: follow ? off : 0,
    // W16 otherwise: zoomed, or panned DOWN (a positive offset) and not followed → hidden.
    apart: zoomed || (!follow && off > VIEWPORT_TOLERANCE_PX),
    waitMs: eligible && !settled ? FOLLOW_SETTLE_MS - (now - offSince) : 0,
  };
}

/**
 * One scroll sample → the next bar state.
 *   s     { state: 'shown'|'hidden', lastY, acc, lastH }
 *   y     window.scrollY as reported (negative / past max during a bounce)
 *   maxY  scrollHeight − innerHeight
 *   h     innerHeight (changes when the Safari toolbar collapses or expands)
 *   vv    { offsetTop, scale } of window.visualViewport, or null (W16)
 *   s.apart  true while the viewports disagree (W16)
 */
export function nextBar(s, { y, maxY, h, vv = null, apart = isZoomed(vv) }) {
  // W16: ZOOMED — the bar's top 0 is not the screen's top, and the offset moves with every pan.
  // Hidden, and nothing decided from this frame's scroll: a zoomed pan is not the reader asking for
  // the bar. (BAR-1: an offset at scale 1 is FOLLOWED instead, by barView's shift; see above.)
  if (apart) return { state: 'hidden', lastY: y, acc: 0, lastH: h, apart: true };
  // Agreeing again: re-baseline. Shown only if we are in the top zone; otherwise it waits for a
  // real scroll up, like any hidden bar.
  if (s.apart) return { state: y <= BAR_TOP_ZONE ? 'shown' : 'hidden', lastY: y, acc: 0, lastH: h, apart: false };
  if (s.lastY === null) return { state: y <= BAR_TOP_ZONE ? 'shown' : s.state, lastY: y, acc: 0, lastH: h, apart: false };
  // RUBBER-BAND: outside the real range is the bounce, not the reader. Ignore it entirely — keep
  // lastY, so the spring back to the edge is not read as travel either.
  if (y < 0 || y > maxY + 1) return s;
  // THE TOOLBAR: the viewport changed height. Any scrollY change this frame is the browser's
  // (a clamp at the bottom), not the reader's. Re-baseline and decide nothing.
  if (h !== s.lastH) return { ...s, lastY: y, acc: 0, lastH: h };
  if (y <= BAR_TOP_ZONE) return { ...s, state: 'shown', lastY: y, acc: 0, lastH: h };
  const d = y - s.lastY;
  if (d === 0) return s;
  const acc = (Math.sign(d) === Math.sign(s.acc) ? s.acc : 0) + d;
  let state = s.state;
  if (acc >= BAR_THRESHOLD) state = 'hidden';
  else if (acc <= -BAR_THRESHOLD) state = 'shown';
  return { ...s, state, lastY: y, acc, lastH: h };
}

// ── W16: THE CONTAINING-BLOCK CHECK ─────────────────────────────────────────────────────────
// Any of these on ANY ancestor makes that ancestor the bar's containing block, and a `fixed`
// bar then scrolls with it. Shared by the founder readout (?debug=bar), the WebKit probe and the
// CI test, so all three ask the same question.
const CB_WILL_CHANGE = /(^|,\s*)(transform|translate|rotate|scale|perspective|filter|backdrop-filter|-webkit-backdrop-filter|contain)(\s*,|$)/;

/**
 * The first containing-block property on one element's computed style, as "prop: value", or
 * null. `cs` is a CSSStyleDeclaration or any object with the same camelCase keys.
 */
export function containingBlockReason(cs) {
  if (!cs) return null;
  const v = (k) => (cs[k] == null ? '' : String(cs[k]).trim());
  const set = (k, none = 'none') => { const x = v(k); return x && x !== none ? x : null; };
  for (const k of ['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter', 'backdropFilter', 'webkitBackdropFilter']) {
    const x = set(k);
    if (x) return `${k}: ${x}`;
  }
  const contain = v('contain');
  if (/\b(layout|paint|strict|content)\b/.test(contain)) return `contain: ${contain}`;
  const wc = v('willChange');
  if (CB_WILL_CHANGE.test(wc)) return `willChange: ${wc}`;
  const ct = v('containerType');
  if (ct === 'size' || ct === 'inline-size') return `containerType: ${ct}`;
  const cvis = v('contentVisibility');
  if (cvis === 'auto' || cvis === 'hidden') return `contentVisibility: ${cvis}`;
  if (v('transformStyle') === 'preserve-3d') return 'transformStyle: preserve-3d';
  return null;
}

/** Walk from `el`'s parent to <html>. Returns the first offender as { tag, reason } or null. */
export function containingBlockAncestor(el, getStyle) {
  for (let a = el && el.parentElement; a; a = a.parentElement) {
    const reason = containingBlockReason(getStyle(a));
    if (reason) return { tag: a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\s+/).join('.') : ''), reason };
  }
  return null;
}

// ── W31: THE GUARD, FOR EVERY TOP BAR ───────────────────────────────────────────────────────
// Ikenna, 30 Sep 00:07, iPhone, live: the SITE bar (.cs-nav) drawn ~444px down an 874px screen on
// /public-library — W16's picture exactly, on the one fixed top bar W16 never reached. The guard
// is now shared (app/components/useBarGuard.js) and its answer has THREE values, not two:
//
//   shown   at the top of the glass
//   hidden  the ordinary scroll-hide (StoryBar with hideOnScroll): slid up by its own height,
//           still painted, progress line still on the edge — W9's resting value
//   apart   ZOOMED (since BAR-1; before it, any disagreement): NOT PAINTED (visibility hidden,
//           pointer events off). At scale 1 the bar is shown and FOLLOWS the glass (`shift`).
//           A slide is not enough here: when the layout top sits mid-screen, a bar lifted by its
//           own height is still on the glass, just 68px higher.

/**
 * One sample → the next guard state. `s` is initialBar() or this function's last answer; the
 * returned `view` is what the component writes to data-state.
 *   hideOnScroll  false: shown / apart only (the site bar, the Series bar, the verify banner)
 *                 true:  W9's scroll-hide (nextBar) under the same guard (the story bar)
 */
export function barView(s, { y, maxY, h, vv = null, now = 0, field = false }, hideOnScroll = false) {
  // BAR-1: `shift` is the translate that puts the bar's top on the screen's top, applied only to a
  // settled offset (followPlan). `waitMs` asks the caller to look again when it will have settled.
  const p = followPlan(s, { y, maxY, vv, now, field });
  const keep = { off: p.off, offSince: p.offSince, waitMs: p.waitMs };
  if (hideOnScroll) {
    const n = nextBar(s, { y, maxY, h, vv, apart: p.apart });
    return { ...n, ...keep, view: n.apart ? 'apart' : n.state, shift: n.apart ? 0 : p.shift };
  }
  return { ...s, ...keep, apart: p.apart, view: p.apart ? 'apart' : 'shown', shift: p.shift };
}

/** The CSS for the apart state: unpainted and untouchable. `sel` is the bar's selector. */
export const apartCss = (sel) => `${sel}[data-state="apart"] { visibility: hidden; pointer-events: none; }`;
