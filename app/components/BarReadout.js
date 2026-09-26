'use client';
// W16 — THE BAR READOUT. Founders only, and only with ?debug=bar in the address. Mounted by
// <StoryBar> (app/components/StoryBar.js), which does both checks before this file is loaded.
//
// Why it exists: the story bar misplaced itself on Ikenna's iPhone on 26 Sep, and no engine this
// repo can run has an iPhone's toolbar, momentum or zoom. If the bar ever strays again, ONE
// screenshot of this panel names the cause:
//
//   build     the build this page is running, and the build /build.json says is live
//   scrollY   window.scrollY, and innerHeight
//   vv        visualViewport offsetTop, height and scale — if offsetTop isn't 0 or scale isn't 1,
//             the layout viewport's top (where a fixed bar lives) isn't the screen's top
//   bar       its top edge in the layout viewport AND on screen, its data-state, and whether the
//             two viewports agree (when they don't, the bar is meant to be hidden)
//   ancestor  the first ancestor with a transform / filter / contain / will-change … or "none";
//             any one of them makes a fixed bar scroll with the page
//
// It follows the VISUAL viewport (a transform on itself, never on an ancestor of the bar), so it
// stays readable on the glass even when the page is zoomed. It writes nothing anywhere, and it
// reads the DOM once per frame only while it is mounted.

import { containingBlockAncestor, viewportsAgree } from '../lib/storyBar';
import { BUILD_COMMIT, readLiveBuild, isStaleBuild } from '../lib/buildId';

const fx = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

export function mountBarReadout(bar) {
  const box = document.createElement('div');
  box.setAttribute('data-bar-readout', '');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed', left: '0px', top: '0px', zIndex: '2147483000', transformOrigin: '0 0',
    margin: '0', padding: '8px 10px', maxWidth: '340px', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.86)', color: '#e8e0d4', border: '1px solid #c9a84c', borderRadius: '8px',
    font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre', pointerEvents: 'none',
  });
  document.body.appendChild(box);

  let live = null;
  readLiveBuild().then((c) => { live = c || 'unreadable'; });

  let raf = 0;
  const tick = () => {
    const vv = window.visualViewport;
    const r = bar.getBoundingClientRect();
    const vvTop = vv ? vv.offsetTop : 0;
    const scale = vv ? vv.scale : 1;
    const screenTop = (r.top - vvTop) * scale;
    const agree = viewportsAgree(vv ? { offsetTop: vv.offsetTop, scale: vv.scale } : null);
    const anc = containingBlockAncestor(bar, (el) => getComputedStyle(el));
    const stale = live && live !== 'unreadable' ? (isStaleBuild(BUILD_COMMIT, live) ? '  STALE' : '  (live)') : '';
    box.textContent = [
      `build    ${BUILD_COMMIT}${stale}`,
      `live     ${live || '…'}`,
      `scrollY  ${fx(window.scrollY)}   innerH ${window.innerHeight}`,
      `vv       top ${fx(vvTop)}  h ${fx(vv ? vv.height : NaN)}  scale ${fx(scale, 2)}`,
      `bar      top ${fx(r.top)}  on screen ${fx(screenTop)}  ${bar.getAttribute('data-state') || '?'}`,
      `views    ${agree ? 'agree' : 'APART (bar should be hidden)'}`,
      `ancestor ${anc ? `${anc.tag} → ${anc.reason}` : 'none'}`,
    ].join('\n');
    // Sit near the bottom of the VISUAL viewport, clear of the founder pill (bottom 12, ~40 tall),
    // at screen size whatever the zoom.
    if (vv) {
      const h = box.offsetHeight / scale;
      box.style.transform = `translate(${vv.offsetLeft + 8 / scale}px, ${vv.offsetTop + vv.height - h - 64 / scale}px) scale(${1 / scale})`;
    } else {
      box.style.transform = `translate(8px, ${window.innerHeight - box.offsetHeight - 64}px)`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => { cancelAnimationFrame(raf); box.remove(); };
}
