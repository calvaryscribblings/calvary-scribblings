'use client';
// THE STORY BAR — one bar for story, news and poetry pages (/stories/[slug]) and the Series. W9.
// The decision is app/lib/storyBar.js; see its header for why the old bar drifted.
//
//   <StoryBar hideOnScroll progressRef={ref} className="story-nav">…</StoryBar>
//
// Position is `fixed; top: 0` and nothing else: the only transform ever applied is one of two
// resting values, written to `data-state`, so the bar is either flush at 0 or entirely above it.
// The progress line is a CHILD, on the bar's bottom edge: it cannot drift from the bar, and when
// the bar is hidden it is left at the very top of the viewport, where it still reads as progress.
// Scroll handling touches no React state: one rAF-coalesced read, one attribute write on change.
//
// W16: the visual viewport is read too, and while it disagrees with the layout viewport (zoomed,
// or panned by the keyboard) the bar is hidden — on the Series as well, which otherwise never
// hides. See app/lib/storyBar.js. ?debug=bar, for a founder, mounts the live readout
// (app/components/BarReadout.js).

import { useEffect, useRef } from 'react';
import { nextBar, initialBar, viewportsAgree, BAR_TRANSITION_MS } from '../lib/storyBar';
import { useAuth } from '../lib/AuthContext';
import { isFounder } from '../lib/founders';

export const STORY_BAR_CSS = `
  [data-story-bar] { position: fixed; top: 0; left: 0; right: 0; z-index: 999;
    padding-top: env(safe-area-inset-top, 0px); box-sizing: border-box;
    transform: translate3d(0, 0, 0); transition: transform ${BAR_TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  [data-story-bar][data-state="hidden"] { transform: translate3d(0, -100%, 0); }
  [data-story-bar-progress] { position: absolute; left: 0; right: 0; top: 100%; height: 2px;
    background: linear-gradient(90deg, #c9a84c, rgba(201,168,76,0.55)); transform: scaleX(0);
    transform-origin: left; opacity: 0; will-change: transform, opacity; transition: opacity 0.4s ease; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { [data-story-bar] { transition: none; } }
`;

export default function StoryBar({ hideOnScroll = false, progressRef = null, className = '', style, children, as: Tag = 'nav' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const vvp = window.visualViewport || null;
    let s = initialBar();
    let raf = 0;
    const read = () => {
      raf = 0;
      const vv = vvp ? { offsetTop: vvp.offsetTop, scale: vvp.scale } : null;
      let next;
      if (hideOnScroll) {
        const doc = document.scrollingElement || document.documentElement;
        const h = window.innerHeight;
        next = nextBar(s, { y: window.scrollY, maxY: doc.scrollHeight - h, h, vv });
      } else {
        next = { state: viewportsAgree(vv) ? 'shown' : 'hidden' };
      }
      if (next.state !== s.state) el.setAttribute('data-state', next.state);
      s = next;
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
  }, [hideOnScroll]);

  // W16: the founder readout. Only fetched when the address carries ?debug=bar AND the signed-in
  // account is a founder; for everyone else this is one string test and nothing is loaded.
  const uid = useAuth()?.user?.uid || null;
  useEffect(() => {
    const el = ref.current;
    if (!el || !isFounder(uid)) return undefined;
    if (new URLSearchParams(window.location.search).get('debug') !== 'bar') return undefined;
    let unmount = null, gone = false;
    import('./BarReadout').then((m) => { if (!gone) unmount = m.mountBarReadout(el); }).catch(() => {});
    return () => { gone = true; if (unmount) unmount(); };
  }, [uid]);

  return (
    <Tag ref={ref} data-story-bar="" data-state="shown" className={className} style={style}>
      <style>{STORY_BAR_CSS}</style>
      {children}
      {progressRef && <div ref={progressRef} data-story-bar-progress="" aria-hidden="true" />}
    </Tag>
  );
}
