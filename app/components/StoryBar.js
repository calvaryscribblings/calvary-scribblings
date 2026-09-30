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
// (app/components/BarReadout.js). W31: both now live in app/components/useBarGuard.js, shared
// with the site bar (Navbar), and the apart state is unpainted, not merely lifted.

import { useRef } from 'react';
import { BAR_TRANSITION_MS, apartCss } from '../lib/storyBar';
import { useViewportGuard, useBarReadout } from './useBarGuard';

// W31: "apart" (the viewports disagree) is NOT PAINTED — lifted like "hidden" so it never slides
// across the glass on its way back, and also visibility:hidden, because when the layout top sits
// mid-screen a bar lifted by its own height is still on the glass. The scroll-hide keeps its
// slide and its progress line.
export const STORY_BAR_CSS = `
  [data-story-bar] { position: fixed; top: 0; left: 0; right: 0; z-index: 999;
    padding-top: env(safe-area-inset-top, 0px); box-sizing: border-box;
    transform: translate3d(0, 0, 0); transition: transform ${BAR_TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  [data-story-bar][data-state="hidden"] { transform: translate3d(0, -100%, 0); }
  [data-story-bar][data-state="apart"] { transform: translate3d(0, -100%, 0); }
  ${apartCss('[data-story-bar]')}
  [data-story-bar-progress] { position: absolute; left: 0; right: 0; top: 100%; height: 2px;
    background: linear-gradient(90deg, #c9a84c, rgba(201,168,76,0.55)); transform: scaleX(0);
    transform-origin: left; opacity: 0; will-change: transform, opacity; transition: opacity 0.4s ease; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { [data-story-bar] { transition: none; } }
`;

export default function StoryBar({ hideOnScroll = false, progressRef = null, className = '', style, children, as: Tag = 'nav' }) {
  const ref = useRef(null);
  // W16's guard (and W9's scroll-hide when hideOnScroll), now shared with Navbar: W31.
  useViewportGuard(ref, { hideOnScroll });
  // W16: the founder readout — ?debug=bar and a founder account, or nothing is loaded.
  useBarReadout(ref);

  return (
    <Tag ref={ref} data-story-bar="" data-state="shown" className={className} style={style}>
      <style>{STORY_BAR_CSS}</style>
      {children}
      {progressRef && <div ref={progressRef} data-story-bar-progress="" aria-hidden="true" />}
    </Tag>
  );
}
