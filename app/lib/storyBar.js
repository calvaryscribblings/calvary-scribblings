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

export const BAR_TOP_ZONE = 80;     // within this of the top, the bar is always shown
export const BAR_THRESHOLD = 32;    // px of travel in one direction before it changes its mind
export const BAR_TRANSITION_MS = 280;

export const initialBar = () => ({ state: 'shown', lastY: null, acc: 0, lastH: null });

/**
 * One scroll sample → the next bar state.
 *   s     { state: 'shown'|'hidden', lastY, acc, lastH }
 *   y     window.scrollY as reported (negative / past max during a bounce)
 *   maxY  scrollHeight − innerHeight
 *   h     innerHeight (changes when the Safari toolbar collapses or expands)
 */
export function nextBar(s, { y, maxY, h }) {
  if (s.lastY === null) return { state: y <= BAR_TOP_ZONE ? 'shown' : s.state, lastY: y, acc: 0, lastH: h };
  // RUBBER-BAND: outside the real range is the bounce, not the reader. Ignore it entirely — keep
  // lastY, so the spring back to the edge is not read as travel either.
  if (y < 0 || y > maxY + 1) return s;
  // THE TOOLBAR: the viewport changed height. Any scrollY change this frame is the browser's
  // (a clamp at the bottom), not the reader's. Re-baseline and decide nothing.
  if (h !== s.lastH) return { ...s, lastY: y, acc: 0, lastH: h };
  if (y <= BAR_TOP_ZONE) return { state: 'shown', lastY: y, acc: 0, lastH: h };
  const d = y - s.lastY;
  if (d === 0) return s;
  const acc = (Math.sign(d) === Math.sign(s.acc) ? s.acc : 0) + d;
  let state = s.state;
  if (acc >= BAR_THRESHOLD) state = 'hidden';
  else if (acc <= -BAR_THRESHOLD) state = 'shown';
  return { state, lastY: y, acc, lastH: h };
}
