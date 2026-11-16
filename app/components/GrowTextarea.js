'use client';
// TEXT-W1 — ruling 390: every multi-line text box on the website is this one, so they all behave
// the same. A drop-in <textarea>: every prop, class, style and ref passes straight through, so each
// box keeps its own look (392). What it adds:
//
//   · it grows with the text, line by line, to `maxLines` (GROW_LINES, six), then scrolls inside
//     itself; a long-form editor passes a LONG_FORM limit instead (app/lib/growBox.js)
//   · it shrinks back when text is deleted or sent (the parent clears `value`), and a paste is just
//     a bigger change of text, so it behaves the same
//   · the cursor stays in view: at the cap with the caret at the end, the box scrolls to its last
//     line; and while it grows, the page scrolls just enough to keep the box's foot (for a long-form
//     box, the line being typed) above the bottom of what the reader can see, the phone keyboard
//     included (the visual viewport). A box in a fixed sheet is the sheet's business
//     (useKeyboardInset), so the page is never moved for it
//
// Its resting height is its own CSS and `rows`: growth starts only when the text needs more, so a
// box at rest looks exactly as it did. Measuring sets the height back to its own for one moment in
// the same frame, so every scroll position that moment could disturb (the page's, any scrolling
// parent's, the box's own) is put back before anything paints: a long piece never jumps.
//
// Send buttons sit level with the box's last line where each box is used (`align-items: flex-end`).

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { GROW_LINES, growHeight } from '../lib/growBox';
import { revealBy } from '../lib/composerRail';

const px = (v) => parseFloat(v) || 0;
const lineCache = new Map();

/** One line of this box's text, in px. `line-height: normal` is measured, never guessed. */
function lineHeightOf(cs) {
  const lh = parseFloat(cs.lineHeight);
  if (Number.isFinite(lh)) return lh;
  const key = `${cs.font}|${cs.letterSpacing}`;
  if (lineCache.has(key)) return lineCache.get(key);
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;padding:0;border:0;margin:0;white-space:pre;line-height:normal';
  probe.style.font = cs.font;
  probe.style.letterSpacing = cs.letterSpacing;
  probe.textContent = 'x\nx\nx\nx';
  document.body.appendChild(probe);
  const one = probe.getBoundingClientRect().height / 4;
  probe.remove();
  lineCache.set(key, one);
  return one;
}

function inFixedSheet(el) {
  for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
    if (getComputedStyle(n).position === 'fixed') return true;
  }
  return false;
}

/**
 * Size `el` to its text. Returns what it measured (the tests read it from data-grow-* too).
 * `revealMargin` is how much of the visible foot something of the page's own covers (a composer bar).
 */
export function fitBox(el, maxLines = GROW_LINES, { revealMargin = 12 } = {}) {
  if (!el || typeof window === 'undefined') return null;
  const cs = getComputedStyle(el);
  const padY = px(cs.paddingTop) + px(cs.paddingBottom);
  const bY = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  const borderBox = cs.boxSizing === 'border-box';
  const before = el.getBoundingClientRect().height;

  // Every scroll the moment at resting height could disturb.
  const kept = [];
  for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollTop) kept.push([n, n.scrollTop]);
  const winX = window.scrollX, winY = window.scrollY, inner = el.scrollTop;

  el.style.height = '';
  const natural = el.getBoundingClientRect().height;
  const content = el.scrollHeight + bY;
  const { height, scrolls } = growHeight({ natural, content, lineHeight: lineHeightOf(cs), padY, bY, maxLines });
  if (height > natural + 0.5) el.style.height = `${borderBox ? height : height - padY - bY}px`;
  el.style.overflowY = scrolls ? 'auto' : 'hidden';

  // Every put-back is instant: the site sets scroll-behavior: smooth, and a smooth put-back would
  // still be animating when the next keystroke (or the reveal below) scrolls, and undo it.
  const put = (n, top) => { if (n.scrollTop !== top) n.scrollTo({ top, behavior: 'instant' }); };
  for (const [n, t] of kept) put(n, t);
  if (window.scrollY !== winY || window.scrollX !== winX) window.scrollTo({ left: winX, top: winY, behavior: 'instant' });
  put(el, inner);

  const focused = document.activeElement === el;
  const atEnd = el.selectionEnd === el.value.length;
  // The cursor, inside the box: at the cap, typing at the end keeps the last line in view.
  if (scrolls && focused && atEnd) put(el, el.scrollHeight - el.clientHeight);

  // The box, inside the page: while it grows under the reader's hand, its foot (for a box that
  // grows with the page, the line being typed) stays above the visible foot.
  if (focused && height > before + 0.5 && !inFixedSheet(el)) {
    const vv = window.visualViewport;
    const vvTop = vv ? vv.offsetTop : 0;
    const vvHeight = vv ? vv.height : window.innerHeight;
    const r = el.getBoundingClientRect();
    const lh = lineHeightOf(cs);
    const caretFoot = maxLines === Infinity && atEnd ? r.bottom - px(cs.paddingBottom) - px(cs.borderBottomWidth) : r.bottom;
    const caretTop = maxLines === Infinity ? caretFoot - 2 * lh : r.top;
    const by = revealBy({ fieldTop: caretTop, fieldBottom: caretFoot, vvTop, vvHeight, margin: revealMargin });
    if (by > 0) window.scrollBy({ top: by, left: 0, behavior: 'instant' });
  }

  el.dataset.growLines = String(maxLines);
  el.dataset.growScrolls = scrolls ? '1' : '0';
  return { natural, content, height, scrolls };
}

/**
 * The behaviour, for a box that can't be swapped for <GrowTextarea>. Re-fits on every change of
 * `value`, on any input (an uncontrolled box), when the box's width changes (wrapping moves), and
 * once the web fonts are in (line height and wrapping move).
 */
export function useGrow(ref, value, maxLines = GROW_LINES, opts = {}) {
  const margin = opts.revealMargin ?? 12;
  const fit = useCallback(() => fitBox(ref.current, maxLines, { revealMargin: margin }), [ref, maxLines, margin]);
  useLayoutEffect(() => { fit(); }, [fit, value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onInput = () => fit();
    el.addEventListener('input', onInput);
    let width = el.clientWidth;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } })
      : null;
    if (ro) ro.observe(el);
    let live = true;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (live) fit(); });
    return () => { live = false; el.removeEventListener('input', onInput); if (ro) ro.disconnect(); };
  }, [ref, fit]);
}

/** <textarea>, growing (ruling 390). `maxLines` defaults to six; `revealMargin` see fitBox. */
const GrowTextarea = forwardRef(function GrowTextarea({ maxLines = GROW_LINES, revealMargin, ...props }, outer) {
  const own = useRef(null);
  const setRef = useCallback((el) => {
    own.current = el;
    if (typeof outer === 'function') outer(el);
    else if (outer) outer.current = el;
  }, [outer]);
  useGrow(own, props.value, maxLines, { revealMargin });
  return <textarea data-grow="" {...props} ref={setRef} />;
});

export default GrowTextarea;
