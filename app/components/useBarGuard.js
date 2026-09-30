'use client';
// W31 — THE TOP-BAR GUARD, ONE HOOK. Shared by StoryBar (story, news, poetry, the Series), Navbar
// (the site bar, mounted by every Home / Book Store / Membership … page) and the verify-email
// banner. W16 wrote it inside StoryBar; Navbar never got it, and on 30 Sep that was the bar
// Ikenna saw floating mid-screen. The decision is barView() in app/lib/storyBar.js.
//
//   useViewportGuard(ref, { hideOnScroll, hold })
//     One rAF-coalesced read on window scroll/resize and visualViewport resize/scroll, one
//     attribute write (data-state) on change, no React state per event.
//     hold: while true the bar is left exactly as it is (Navbar's open menu drawer).
//
//   useBarReadout(ref)
//     ?debug=bar for a FOUNDER mounts the live readout (app/components/BarReadout.js) against
//     this bar. For everyone else: one string test, nothing loaded.

import { useEffect } from 'react';
import { initialBar, barView } from '../lib/storyBar';
import { useAuth } from '../lib/AuthContext';
import { isFounder } from '../lib/founders';

export function useViewportGuard(ref, { hideOnScroll = false, hold = false } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || hold) return undefined;
    const vvp = window.visualViewport || null;
    let s = initialBar();
    let written = el.getAttribute('data-state');
    let raf = 0;
    const read = () => {
      raf = 0;
      const doc = document.scrollingElement || document.documentElement;
      const h = window.innerHeight;
      const vv = vvp ? { offsetTop: vvp.offsetTop, scale: vvp.scale } : null;
      s = barView(s, { y: window.scrollY, maxY: doc.scrollHeight - h, h, vv }, hideOnScroll);
      if (s.view !== written) { el.setAttribute('data-state', s.view); written = s.view; }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    vvp?.addEventListener('resize', on);
    vvp?.addEventListener('scroll', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      vvp?.removeEventListener('resize', on);
      vvp?.removeEventListener('scroll', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, hideOnScroll, hold]);
}

export function useBarReadout(ref) {
  const uid = useAuth()?.user?.uid || null;
  useEffect(() => {
    const el = ref.current;
    if (!el || !isFounder(uid)) return undefined;
    if (new URLSearchParams(window.location.search).get('debug') !== 'bar') return undefined;
    let unmount = null, gone = false;
    import('./BarReadout').then((m) => { if (!gone) unmount = m.mountBarReadout(el); }).catch(() => {});
    return () => { gone = true; if (unmount) unmount(); };
  }, [ref, uid]);
}
