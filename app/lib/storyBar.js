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

export const initialBar = () => ({ state: 'shown', lastY: null, acc: 0, lastH: null, apart: false });

/**
 * One scroll sample → the next bar state.
 *   s     { state: 'shown'|'hidden', lastY, acc, lastH }
 *   y     window.scrollY as reported (negative / past max during a bounce)
 *   maxY  scrollHeight − innerHeight
 *   h     innerHeight (changes when the Safari toolbar collapses or expands)
 *   vv    { offsetTop, scale } of window.visualViewport, or null (W16)
 *   s.apart  true while the viewports disagree (W16)
 */
export function nextBar(s, { y, maxY, h, vv = null }) {
  // W16: THE VIEWPORTS DISAGREE — the bar's top 0 is not the screen's top. Hidden, and nothing
  // decided from this frame's scroll: a zoomed pan and a keyboard's scroll-into-view are not the
  // reader asking for the bar.
  if (!viewportsAgree(vv)) return { state: 'hidden', lastY: y, acc: 0, lastH: h, apart: true };
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
