'use client';

// ── Reaction ──────────────────────────────────────────────────────────────────
// W13. ONE reaction button for every surface on the web: story comments and their
// replies (/stories, /reader), the Square's posts and replies, and Open Pages (the
// piece's own heart, its comments and replies). The motion is app/lib/reactionMotion.js,
// the prototype Ikenna approved on 25 Sept, verbatim. This file only builds the DOM that
// code expects and wires it to React.
//
// The DOM the prototype expects, per button:
//   button[data-kind]            b; b.st = { n, icon, fx, off, on, count, timers }
//     span.rx-press              the press-down (never inside .icon — clear() would snap it)
//       span.rx-icon             S × S
//         svg.rx-fx              3S × 3S, centred, behind, overflow visible, no pointer events
//         svg.rx-off             outline
//         svg.rx-on              filled (fire: FIRE, TONGUE on top)
//     span.rx-count              .n spans, owned by setCount alone (through showCount)
//
// THE ROW (the app's A14). Each reaction has a 44px slot, which is also its touch area. The
// icon sits at the slot's left edge, the count 5px after it. Counts are 14px lining tabular
// figures, cream at 72% at rest, at full strength once you've reacted.
//
// MEASURED ON THE WEB, NOT COPIED: A14 says a slot widens only when icon + 5 + count + 10px
// clear won't fit in 44, "so 0–99 never moves a neighbour". In Cormorant at 14px two tabular
// digits are 13.75px, so 16 + 5 + 13.75 + 10 = 44.75: the letter of the rule would move every
// neighbour at 10. The outcome is the ruling, so 0–99 holds the 44px slot exactly (the clear
// at two digits is the 9.25px left), and from 100 the slot widens by the letter (data-wide:
// min 44, 10px clear). RULED 26 Sept (ruling 36): the 44px slot stays, with 9.25px after a
// two-digit count. W13 asked; W15 pins it.
//
// ZERO. RULED 26 Sept (ruling 37): a count is hidden until the first reaction, so zero shows
// the icon alone. The prototype's setCount (verbatim, untouchable) always draws the number, so
// showCount below marks a "0" with .z and the stylesheet hides it with visibility, never
// display: the count keeps its box, the slot keeps its 44px, and 0→1 or 1→0 moves nothing in
// or around the row. 0→1 is the 1 sliding in with no 0 leaving; 1→0 is the 1 sliding out with
// nothing arriving. The aria-label already names no zero.
//
// THE CONTRACT WITH THE SURFACE. onToggle() flips the state AT ONCE (optimistically) and
// returns a promise. If the save fails, it restores the state and rejects. The button
// animates on the tap, never on a prop change, so a database echo, another device's tap or
// the revert itself draws no burst. The count slides only when the number really changes
// (setCount returns on an equal value), and never on mount.
//
// No JSX, like PostBody.js, so a node --test file and the proof harness import it as is.

import { createElement as h, Fragment, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import {
  HEART, LIKE, FIRE, TONGUE, PALETTE, clear, play, off, setCount,
  reducedMotion, resolveBg, pressIn, pressOut, shake,
} from '../../lib/reactionMotion.js';

// A descriptor maps a per-surface DB key onto one of the prototype's three kinds. Keys are
// stored data and never change here:
//   comments under stories → heart, fire. Their stored clap counts stay stored, not shown
//                            (ruling, 26 Sept: as in the app and the prototype).
//   the Square             → heart on `like`, like on `clap`, fire on `fire`.
export const COMMENT_REACTIONS = Object.freeze([
  { key: 'heart', kind: 'heart' },
  { key: 'fire', kind: 'fire' },
]);
export const SQUARE_REACTIONS = Object.freeze([
  { key: 'like', kind: 'heart' },
  { key: 'clap', kind: 'like' },
  { key: 'fire', kind: 'fire' },
]);

const PATH = { heart: HEART, like: LIKE, fire: FIRE };
const ORIGIN = { heart: '50% 55%', like: '32% 80%', fire: '50% 92%' };
const LABEL = { heart: 'Heart', like: 'Like', fire: 'Fire' };
const CREAM = '241,228,200';
export const REACTION_REST = `rgba(${CREAM},0.72)`;
export const REACTION_FULL = `rgb(${CREAM})`;
export const FAIL_COPY = "Couldn't save your reaction. Try again.";

export const REACTION_CSS = `
.rx{position:relative;display:inline-flex;align-items:center;flex:none;box-sizing:border-box;width:44px;height:44px;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.rx[data-wide]{width:auto;min-width:44px;padding-right:10px}
.rx[data-inert]{cursor:default}
.rx:focus-visible{outline:2px solid rgba(216,180,90,.55);outline-offset:-2px;border-radius:8px}
.rx-press{display:block;flex:none}
.rx-icon{position:relative;display:block}
.rx-icon>svg{position:absolute;left:0;top:0;width:100%;height:100%;display:block;overflow:visible}
.rx-icon>.rx-fx{left:-100%;top:-100%;width:300%;height:300%;pointer-events:none}
.rx-count{display:inline-grid;margin-left:5px;font-family:'Cormorant Garamond',Georgia,serif;font-size:14px;font-weight:500;line-height:1;font-variant-numeric:lining-nums tabular-nums;font-feature-settings:"lnum" 1,"tnum" 1}
.rx-count>.n{grid-area:1/1;display:block}
.rx-count>.n.z{visibility:hidden}
.rx-row{display:flex;align-items:center;flex-wrap:wrap}
.rx-note{margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;font-style:italic;line-height:1.4;color:${REACTION_REST}}
`;
// React 19 owns this stylesheet: a <style href precedence> is hoisted into <head>, deduped by
// href, and kept there by React itself. A <style> appended by hand is not React's, and one run
// of the live proof caught it gone after the document re-rendered: the buttons measured 300px.
const styleTag = () => h('style', { href: 'w13-reaction', precedence: 'medium' }, REACTION_CSS);

// setCount, then ruling 37: every number showing "0" (arriving or at rest) is marked .z and
// so hidden. Every count on every surface goes through here, never through setCount directly.
export function showCount(b, n) {
  setCount(b, n);
  for (const s of b.st.count.querySelectorAll('.n')) s.classList.toggle('z', s.textContent === '0');
}

export function Reaction({ kind, on, count = 0, size = 16, onToggle, canReact = true, onFail }) {
  const btn = useRef(null), press = useRef(null), icon = useRef(null), fx = useRef(null);
  const offEl = useRef(null), onEl = useRef(null), countEl = useRef(null);
  const onRef = useRef(on); onRef.current = on;
  const busy = useRef(false);
  const mounted = useRef(false);

  // b.st, as the prototype keeps it. The first setCount has no .n to slide from, so the
  // number is simply there: never a slide on mount.
  useLayoutEffect(() => {
    const b = btn.current;
    b.st = { n: count, icon: icon.current, fx: fx.current, off: offEl.current, on: onEl.current, count: countEl.current, timers: [] };
    showCount(b, count);
    return () => clear(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    showCount(btn.current, count);
  }, [count]);

  const onClick = () => {
    if (!canReact) { onToggle?.(); return; }
    if (busy.current) return; // one save in flight per button; the state can't run ahead of it
    const b = btn.current;
    const next = !onRef.current;
    if (!reducedMotion()) {
      clear(b);
      if (next) play(b, { ...PALETTE, bg: resolveBg(b) }); else off(b);
    }
    busy.current = true;
    let pending;
    try { pending = Promise.resolve(onToggle?.()); } catch (e) { pending = Promise.reject(e); }
    pending.then(
      () => { busy.current = false; },
      () => { busy.current = false; clear(b); shake(b); onFail?.(); },
    );
  };

  const origin = ORIGIN[kind];
  const label = count > 0 ? `${LABEL[kind]}, ${count}` : LABEL[kind];
  const svg = (props, ...children) => h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', ...props }, ...children);
  return h(Fragment, null, styleTag(), h('button', {
    ref: btn, type: 'button', className: 'rx', 'data-kind': kind,
    'data-inert': canReact ? undefined : '',
    'data-wide': count >= 100 ? '' : undefined,
    'aria-pressed': canReact ? !!on : undefined, 'aria-label': label,
    onClick,
    onPointerDown: () => canReact && pressIn(press.current),
    onPointerUp: () => pressOut(press.current),
    onPointerLeave: () => pressOut(press.current),
    onPointerCancel: () => pressOut(press.current),
  },
    h('span', { ref: press, className: 'rx-press' },
      h('span', { ref: icon, className: 'rx-icon', style: { width: size, height: size } },
        h('svg', { ref: fx, className: 'rx-fx', 'aria-hidden': 'true' }),
        svg({ ref: offEl, className: 'rx-off', style: { transformOrigin: origin, opacity: on ? 0 : 1 } },
          h('path', { d: PATH[kind], fill: 'none', stroke: REACTION_REST, strokeWidth: 1.7, strokeLinejoin: 'round', strokeLinecap: 'round' })),
        svg({ ref: onEl, className: 'rx-on', style: { transformOrigin: origin, opacity: on ? 1 : 0 } },
          h('path', { d: PATH[kind], fill: PALETTE[kind] }),
          kind === 'fire' ? h('path', { className: 'tongue', d: TONGUE, fill: PALETTE.tongue }) : null))),
    h('span', { ref: countEl, className: 'rx-count', 'aria-hidden': 'true', style: { color: on ? REACTION_FULL : REACTION_REST } }),
  ));
}

// The failed-save line. Always mounted (empty, it has no height), so a screen reader hears
// it when it fills.
export function useReactionNote() {
  const [shown, setShown] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fail = useCallback(() => {
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 4000);
  }, []);
  const note = h('p', { className: 'rx-note', role: 'status', 'aria-live': 'polite' }, shown ? FAIL_COPY : '');
  return [note, fail];
}

// The same line for a list of rows (Open Pages' thread): noteFor(key) under each row, and
// fail(key) fills only the row whose save failed.
export function useKeyedReactionNote() {
  const [failed, setFailed] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fail = useCallback((key) => {
    setFailed(key);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFailed(null), 4000);
  }, []);
  const noteFor = (key) => h('p', { key: 'rx-note', className: 'rx-note', role: 'status', 'aria-live': 'polite' }, failed === key ? FAIL_COPY : '');
  return [noteFor, fail];
}
