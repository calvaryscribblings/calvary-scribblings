'use client';
// W55.2 — THE PHONE KEYBOARD, for every place a reader types.
//
// On iPhone and iPad the keyboard covers the page without shrinking the layout viewport; only the
// VISUAL viewport shrinks (app/lib/composerRail.js, keyboardInset). Two kinds of field, two answers:
//
//   useKeyboardInset()  for a SHEET fixed to the foot of the screen (the Messages panel, the Readers'
//                       Notes composer). `bottom: 0` is the layout viewport's foot, under the
//                       keyboard, and no scrolling can bring it out. The sheet is lifted by the inset
//                       and its height held to the glass that is left — what the thread's reply bar
//                       has done since W52.
//
//   <KeyboardReveal />  for a field in the PAGE'S FLOW (a story's response box and its replies, Open
//                       Pages' comments, the Square's post box). Mounted once, in Providers. While a
//                       text field has focus and the keyboard is up, every change in the visual
//                       viewport's size, and every keystroke, checks that the field's foot is above the
//                       keyboard and scrolls the page by the difference (revealBy). Safari makes its
//                       own scroll once, as the keyboard opens; nothing re-checked after it, so a box
//                       it left under the keyboard, or one the keyboard's rise or its suggestion bar
//                       covered later, stayed there while the reader typed.
//
// A field inside a fixed sheet is the sheet's business, and a field under [data-keyboard-own] keeps
// itself in view (the Open Pages composer's bar, the thread's reply bar); KeyboardReveal leaves both
// alone. It does nothing unless a keyboard is up (keyboardInset > 0), so a desktop page or an
// Android phone, whose layout viewport shrinks with its keyboard, is never moved.

import { useEffect, useState } from 'react';
import { keyboardInset, revealBy } from '../lib/composerRail';

const vvState = () => {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return { inset: 0, top: 0 };
  const inset = keyboardInset({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop });
  // While a keyboard is up the sheet's box is the glass: from the visual viewport's top to its foot.
  return { inset, top: inset > 0 ? Math.max(0, Math.round(vv.offsetTop)) : 0 };
};

/**
 * { inset, top }: a fixed sheet's container set to `top: top; bottom: inset` covers exactly the glass
 * the keyboard leaves. Both are 0 when no keyboard is up.
 */
export function useKeyboardInset() {
  const [state, setState] = useState({ inset: 0, top: 0 });
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const next = vvState();
      setState((s) => (s.inset === next.inset && s.top === next.top ? s : next));
    };
    const onChange = () => { if (!raf) raf = requestAnimationFrame(measure); };
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    measure();
    return () => { vv.removeEventListener('resize', onChange); vv.removeEventListener('scroll', onChange); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return state;
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);
function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUTS.has((el.getAttribute('type') || '').toLowerCase());
  return el.isContentEditable === true;
}
function managedElsewhere(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hasAttribute('data-keyboard-own')) return true;
    if (getComputedStyle(n).position === 'fixed') return true;
  }
  return false;
}

export function KeyboardReveal() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    let field = null;
    let raf = 0;
    let late = 0;
    const check = () => {
      raf = 0;
      if (!field || document.activeElement !== field) { field = null; return; }
      if (keyboardInset({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop }) <= 0) return;
      const r = field.getBoundingClientRect();
      const by = revealBy({ fieldTop: r.top, fieldBottom: r.bottom, vvTop: vv.offsetTop, vvHeight: vv.height });
      if (by > 0) window.scrollBy({ top: by, left: 0, behavior: 'instant' });
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(check); };
    const onFocus = (e) => {
      const el = e.target;
      field = isTextField(el) && !managedElsewhere(el) ? el : null;
      if (!field) return;
      soon();
      // The keyboard is still rising when focus lands; look again once it has.
      clearTimeout(late);
      late = setTimeout(soon, 400);
    };
    const onBlur = () => { setTimeout(() => { if (field && document.activeElement !== field) field = null; }, 0); };
    const onInput = (e) => { if (field && e.target === field) soon(); };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('input', onInput);
    // Resize, not scroll: a reader who scrolls up to reread while the keyboard is open is left there
    // until they type again.
    vv.addEventListener('resize', soon);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('input', onInput);
      vv.removeEventListener('resize', soon);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(late);
    };
  }, []);
  return null;
}
