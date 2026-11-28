'use client';
// W31 — THE TOP-BAR GUARD, ONE HOOK. Shared by StoryBar (story, news, poetry, the Series), Navbar
// (the site bar, mounted by every Home / Book Store / Membership … page) and the verify-email
// banner. W16 wrote it inside StoryBar; Navbar never got it, and on 30 Sep that was the bar
// Ikenna saw floating mid-screen. The decision is barView() in app/lib/storyBar.js.
//
//   useViewportGuard(ref, { hideOnScroll, hold, rev })
//     One rAF-coalesced read per event, one attribute write (data-state) and one style write
//     (translate) on change, no React state per event.
//     hold: while true the bar is left exactly as it is (Navbar's open menu drawer).
//     rev:  bump it when the bar's element is replaced (Navbar moving into its body host), so the
//           guard re-attaches to the new node.
//
// BAR-1 — EVERY EVENT THAT CAN MOVE A VIEWPORT. W16/W31 listened to window scroll/resize and
// visualViewport resize/scroll only. A bfcache restore (pageshow), an interactive swipe-back, the
// keyboard closing (focusout), a rotation, the tab coming back (visibilitychange) and a history step
// (popstate) can each leave the viewports somewhere new WITHOUT a scroll or resize, and the guard
// then kept whatever it last decided. Each of those now triggers a read, and iOS settles its
// visual viewport some time AFTER the event, so each also schedules a short burst of re-reads
// (REREAD_MS). And the answer at scale 1 is to FOLLOW, not hide: see viewportShift in
// app/lib/storyBar.js.
//
//   useBarReadout(ref)
//     ?debug=bar for a FOUNDER mounts the live readout (app/components/BarReadout.js) against
//     this bar. For everyone else: one string test, nothing loaded.

import { useEffect } from 'react';
import { initialBar, barView } from '../lib/storyBar';

/** A field that has focus: a keyboard is up, or about to be, and the offset is the keyboard's (BAR-1 go). */
export const isField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true);

/** The window events that can move a viewport without a scroll or a resize (BAR-1). */
export const SETTLE_EVENTS = Object.freeze(['pageshow', 'focusin', 'focusout', 'orientationchange', 'visibilitychange', 'popstate']);
/** After any of them, and on mount: re-read at these delays, because iOS settles late. */
export const REREAD_MS = Object.freeze([60, 180, 400, 800, 1500]);
import { useAuth } from '../lib/AuthContext';
import { isFounder } from '../lib/founders';

export function useViewportGuard(ref, { hideOnScroll = false, hold = false, rev = 0 } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || hold) return undefined;
    // Read through window.visualViewport each time, never a cached object: a bfcache restore can
    // hand back a different one.
    const vvNow = () => window.visualViewport || null;
    let s = initialBar();
    let written = el.getAttribute('data-state');
    // Re-attaching to a bar that is already following an offset (the drawer closing, a hold ending):
    // that same offset counts as settled, so the bar is not dropped back off the glass for 150ms.
    const had = Number(el.getAttribute('data-shift')) || 0;
    if (had) s = { ...s, off: had, offSince: -Infinity };
    // A hold leaves the bar exactly as it was, translate included: pick up what is already written.
    let shiftWritten = Number(el.getAttribute('data-shift')) || 0;
    let raf = 0;
    let timers = [];
    let settleTimer = 0;
    const read = () => {
      raf = 0;
      const doc = document.scrollingElement || document.documentElement;
      const h = window.innerHeight;
      const vvp = vvNow();
      const vv = vvp ? { offsetTop: vvp.offsetTop, scale: vvp.scale } : null;
      s = barView(s, { y: window.scrollY, maxY: doc.scrollHeight - h, h, vv, now: performance.now(), field: isField(document.activeElement) }, hideOnScroll);
      // An offset that hasn't settled yet: look again when it will have (FOLLOW_SETTLE_MS).
      if (s.waitMs > 0) { clearTimeout(settleTimer); settleTimer = setTimeout(readNow, s.waitMs + 16); }
      if (s.view !== written) { el.setAttribute('data-state', s.view); written = s.view; }
      // BAR-1: follow the glass at scale 1. `translate` composes with the bar's own transform.
      const shift = Math.round((s.shift || 0) * 100) / 100;
      if (shift !== shiftWritten) {
        el.style.translate = shift ? `0 ${shift}px` : '';
        if (shift) el.setAttribute('data-shift', String(shift)); else el.removeAttribute('data-shift');
        shiftWritten = shift;
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    // A TIMER's re-read reads at once: frame-coalescing is for scroll storms, and a timer is not one.
    // (On a busy page a frame can be late; the settle check must not wait a frame per step.)
    const readNow = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } read(); };
    const settle = () => {
      on();
      timers.forEach(clearTimeout);
      timers = REREAD_MS.map((ms) => setTimeout(readNow, ms));
    };
    read();
    settle();
    let vvp = vvNow();
    const bindVv = () => {
      vvp?.removeEventListener('resize', on);
      vvp?.removeEventListener('scroll', on);
      vvp = vvNow();
      vvp?.addEventListener('resize', on);
      vvp?.addEventListener('scroll', on);
    };
    const onSettle = () => { bindVv(); settle(); };
    bindVv();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', settle);
    for (const ev of SETTLE_EVENTS) (ev === 'visibilitychange' ? document : window).addEventListener(ev, onSettle);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', settle);
      for (const ev of SETTLE_EVENTS) (ev === 'visibilitychange' ? document : window).removeEventListener(ev, onSettle);
      vvp?.removeEventListener('resize', on);
      vvp?.removeEventListener('scroll', on);
      timers.forEach(clearTimeout);
      clearTimeout(settleTimer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, hideOnScroll, hold, rev]);
}

/**
 * BAR-1 go: THE RECORDER, for founders, on EVERY visit. Three modes, held for the session in
 * sessionStorage, founders only (checked before the readout's code is even loaded, so a stray flag
 * does nothing for anyone else):
 *   'record'  the default: it records silently and shows NOTHING until a record freezes; then the
 *             frozen panel appears, and a tap clears it.
 *   'live'    ?debug=bar: the live panel, as before, frozen record beneath it.
 *   'off'     ?debug=bar-off: nothing at all, not even recording, until ?debug=bar.
 */
export const BAR_DEBUG_KEY = 'cs_debug_bar';
export function barDebugMode() {
  try {
    const q = new URLSearchParams(window.location.search).get('debug');
    if (q === 'bar-off') sessionStorage.setItem(BAR_DEBUG_KEY, 'off');
    if (q === 'bar') sessionStorage.setItem(BAR_DEBUG_KEY, '1');
    const v = sessionStorage.getItem(BAR_DEBUG_KEY);
    return v === '1' ? 'live' : v === 'off' ? 'off' : 'record';
  } catch { return 'record'; }
}

export function useBarReadout(ref, rev = 0) {
  const uid = useAuth()?.user?.uid || null;
  useEffect(() => {
    const el = ref.current;
    if (!el || !isFounder(uid)) return undefined;
    const mode = barDebugMode();
    if (mode === 'off') return undefined;
    let unmount = null, gone = false;
    import('./BarReadout').then((m) => { if (!gone) unmount = m.mountBarReadout(el, { live: mode === 'live' }); }).catch(() => {});
    return () => { gone = true; if (unmount) unmount(); };
  }, [ref, uid, rev]);
}
