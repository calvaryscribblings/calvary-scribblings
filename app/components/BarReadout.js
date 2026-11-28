'use client';
// W16 — THE BAR READOUT. Founders only, with ?debug=bar. Mounted by useBarReadout
// (app/components/useBarGuard.js) from <StoryBar> AND, since W31, from <Navbar> — so every page with
// the site bar has it. The hook does both checks before this file is loaded.
//
// BAR-1 GO (28 Nov 2026): A RECORDER FOR FOUNDERS, ON EVERY VISIT. Without ?debug=bar it records
// silently and draws nothing; the panel appears only when a record freezes, and a tap clears it.
// ?debug=bar shows it live as below; ?debug=bar-off stops it for the session. A condition must hold
// for TRIGGER_HOLD_MS before it freezes (a bounce or a keyboard closing is not the fault).
//
// BAR-1 (28 Nov 2026): the bar floated again (site bar, /public-library, ~240pt down, not zoomed)
// and no engine this repo can run reproduces iOS 26's viewport. So the readout now CATCHES it:
//   · ?debug=bar is STICKY for the session (sessionStorage), across client-side navigation and full
//     page loads, until ?debug=bar-off. ?debug=bar-reset clears a frozen record.
//   · It keeps the last LOG_MS of readings, one per frame, and the last few window / viewport events.
//   · It FREEZES the moment something is wrong, and keeps the frozen record in sessionStorage, so it
//     is still on screen after the reader moves on:
//       OFF-GLASS   the painted, shown bar's top is BELOW the top of the glass (on-screen top > 1)
//       FOLLOWING   the guard is translating the bar to follow the glass (an offset at scale 1)
//       SHORT VIEW  the visual viewport is shorter than innerHeight at scale 1 with no field focused
//                   (the iOS 26 signature: the keyboard has gone, the viewport hasn't come back)
//     One screenshot then shows the readings around the moment, and the event that preceded it.
//
// Lines, live:
//   build     this page's build, and the build /build.json says is live (STALE if older)
//   scrollY   window.scrollY, innerHeight, and whether a field has focus
//   vv        visualViewport offsetTop, height, scale
//   bar       top in the layout viewport and ON SCREEN, its data-state, and the translate applied
//   views     agree / APART (zoomed: hidden) / SHIFTED (followed)
//   tabbar    the bottom tab bar's bottom edge on the glass, against the glass's height
//   ancestor  the first ancestor with a transform / filter / contain / will-change … or "none"
//
// It follows the VISUAL viewport (a transform on itself, never on an ancestor of the bar), writes
// nothing to the database, and reads the DOM once per frame only while mounted.

import { containingBlockAncestor, viewportsAgree, isZoomed } from '../lib/storyBar';
import { BUILD_COMMIT, readLiveBuild, isStaleBuild } from '../lib/buildId';

const fx = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
export const LOG_MS = 4000;
/**
 * How long a trigger must hold before the record freezes. A CHOSEN number: longer than a rubber band
 * or a keyboard's close (both well under half a second), far shorter than a reader looking at a bar in
 * the wrong place. ANCESTOR freezes at once: a containing block is never a transient.
 */
export const TRIGGER_HOLD_MS = 600;
/** The containing-block walk reads every ancestor's style; once every this many ms is plenty. */
const ANCESTOR_EVERY_MS = 250;
export const FROZEN_KEY = 'cs_debug_bar_frozen';
const EVENTS = ['pageshow', 'pagehide', 'focusin', 'focusout', 'orientationchange', 'visibilitychange', 'popstate', 'resize'];

// One log per document, shared by every readout mounted in it (a client-side navigation mounts a
// new Navbar, and with it a new readout; the record carries on).
function shared() {
  if (!window.__csBarLog) window.__csBarLog = { samples: [], events: [] };
  return window.__csBarLog;
}

const isField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/** What is wrong in one sample, or null. Pure; exported for the CI test. */
export function freezeTrigger(x) {
  // Below the top only: a story bar mid-slide is legitimately between −height and 0.
  if (x.painted && x.state === 'shown' && x.screenTop > 1) return 'OFF-GLASS';
  if (x.shift) return 'FOLLOWING';
  if (!x.zoomed && !x.field && Number.isFinite(x.vvH) && x.vvH < x.innerH - 2) return 'SHORT VIEW';
  return null;
}

function readFrozen() {
  try { return JSON.parse(sessionStorage.getItem(FROZEN_KEY) || 'null'); } catch { return null; }
}

export function mountBarReadout(bar, { live: liveMode = true } = {}) {
  try {
    if (new URLSearchParams(window.location.search).get('debug') === 'bar-reset') sessionStorage.removeItem(FROZEN_KEY);
  } catch { /* private mode: nothing to clear */ }
  const log = shared();
  const box = document.createElement('div');
  box.setAttribute('data-bar-readout', '');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed', left: '0px', top: '0px', zIndex: '2147483000', transformOrigin: '0 0',
    margin: '0', padding: '8px 10px', maxWidth: '360px', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.88)', color: '#e8e0d4', border: '1px solid #c9a84c', borderRadius: '8px',
    font: '10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre', pointerEvents: 'none',
    display: liveMode ? 'block' : 'none',
  });
  box.setAttribute('data-mode', liveMode ? 'live' : 'record');
  document.body.appendChild(box);
  // A tap on a FROZEN panel clears the record. In record mode the panel then goes away again.
  const clear = (e) => {
    e.preventDefault();
    try { sessionStorage.removeItem(FROZEN_KEY); } catch { /* nothing to clear */ }
    held = null;
    quiet = true;   // seen: no new record until this condition has cleared once
  };
  let quiet = false;
  box.addEventListener('click', clear);

  let live = null;
  readLiveBuild().then((c) => { live = c || 'unreadable'; });

  const onEvent = (e) => {
    log.events.push({ t: Date.now(), ev: e.type });
    if (log.events.length > 8) log.events.shift();
  };
  for (const ev of EVENTS) (ev === 'visibilitychange' ? document : window).addEventListener(ev, onEvent);
  const vvp = window.visualViewport;
  const onVv = (e) => onEvent({ type: `vv.${e.type}` });
  vvp?.addEventListener('resize', onVv);

  let raf = 0;
  let held = null;          // { trigger, since } — a trigger waiting out TRIGGER_HOLD_MS
  let anc = null, ancAt = -Infinity;
  const tick = () => {
    const now = Date.now();
    const vv = window.visualViewport;
    const r = bar.getBoundingClientRect();
    const vvTop = vv ? vv.offsetTop : 0;
    const scale = vv ? vv.scale : 1;
    const screenTop = (r.top - vvTop) * scale;
    const vvObj = vv ? { offsetTop: vv.offsetTop, scale: vv.scale } : null;
    const agree = viewportsAgree(vvObj);
    const zoomed = isZoomed(vvObj);
    const shift = Number(bar.getAttribute('data-shift')) || 0;
    const state = bar.getAttribute('data-state') || '?';
    const painted = getComputedStyle(bar).visibility !== 'hidden';
    const field = isField(document.activeElement);
    if (now - ancAt >= ANCESTOR_EVERY_MS) { anc = containingBlockAncestor(bar, (el) => getComputedStyle(el)); ancAt = now; }
    const tab = document.querySelector('.cs-tabbar');
    const tr = tab ? tab.getBoundingClientRect() : null;
    const glassH = vv ? vv.height * scale : window.innerHeight;
    const sample = {
      t: now, y: window.scrollY, innerH: window.innerHeight, vvTop, vvH: vv ? vv.height : NaN, scale,
      barTop: r.top, screenTop, state, shift, painted, zoomed, field,
      tabScreen: tr ? (tr.bottom - vvTop) * scale : NaN, glassH, anc: anc ? `${anc.tag} → ${anc.reason}` : null,
    };
    log.samples.push(sample);
    while (log.samples.length && log.samples[0].t < now - LOG_MS) log.samples.shift();

    let frozen = readFrozen();
    const seen = sample.anc ? 'ANCESTOR' : freezeTrigger(sample);
    if (!seen) { held = null; quiet = false; }
    else if (!held || held.trigger !== seen) held = { trigger: seen, since: now };
    const trigger = held && (held.trigger === 'ANCESTOR' || now - held.since >= TRIGGER_HOLD_MS) ? held.trigger : null;
    if (trigger && !frozen && !quiet) {
      frozen = {
        at: now, trigger, path: window.location.pathname, build: BUILD_COMMIT,
        samples: log.samples.filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 14)) === 0 || i === a.length - 1)
          .map((x) => [x.t - now, x.y, x.innerH, x.vvTop, x.vvH, x.scale, x.screenTop, x.state, x.shift, x.tabScreen, x.glassH, x.field ? 'F' : '-']),
        events: log.events.map((e) => [e.t - now, e.ev]),
        anc: sample.anc,
      };
      try { sessionStorage.setItem(FROZEN_KEY, JSON.stringify(frozen)); } catch { /* the panel still shows it this page */ }
    }

    const stale = live && live !== 'unreadable' ? (isStaleBuild(BUILD_COMMIT, live) ? '  STALE' : '  (live)') : '';
    const lines = [
      `build    ${BUILD_COMMIT}${stale}`,
      `live     ${live || '…'}`,
      `scrollY  ${fx(window.scrollY)}   innerH ${window.innerHeight}   field ${field ? 'FOCUSED' : 'none'}`,
      `vv       top ${fx(vvTop)}  h ${fx(sample.vvH)}  scale ${fx(scale, 2)}`,
      `bar      top ${fx(r.top)}  on screen ${fx(screenTop)}  ${state}  shift ${fx(shift)}`,
      `views    ${zoomed ? 'APART (zoomed: hidden)' : !agree || shift ? 'SHIFTED (followed)' : 'agree'}`,
      `tabbar   ${tr ? `bottom on screen ${fx(sample.tabScreen)} of ${fx(glassH)}` : 'none'}`,
      `ancestor ${sample.anc || 'none'}`,
    ];
    if (frozen) {
      const at = new Date(frozen.at).toLocaleTimeString('en-GB');
      lines.push(`── FROZEN ${at}  ${frozen.trigger}  ${frozen.path}  ${frozen.build}`);
      lines.push('  ms     y      inH  vvTop  vvH    sc   barScr st      sh   tab    glass f');
      for (const s of frozen.samples) {
        lines.push(`  ${String(s[0]).padStart(5)} ${fx(s[1], 0).padStart(6)} ${String(s[2]).padStart(4)} ${fx(s[3]).padStart(6)} ${fx(s[4]).padStart(6)} ${fx(s[5], 2)} ${fx(s[6]).padStart(6)} ${String(s[7]).padEnd(6)} ${fx(s[8], 0).padStart(4)} ${fx(s[9], 0).padStart(5)} ${fx(s[10], 0).padStart(5)} ${s[11]}`);
      }
      lines.push(`  events ${frozen.events.map(([t, e]) => `${e}@${t}`).join(' ') || 'none'}`);
      if (frozen.anc) lines.push(`  ancestor ${frozen.anc}`);
    }
    // Record mode shows only a frozen record; live mode shows everything.
    const show = liveMode || !!frozen;
    box.style.display = show ? 'block' : 'none';
    box.style.pointerEvents = frozen ? 'auto' : 'none';
    if (!liveMode && frozen) lines.splice(0, lines.length, ...lines.slice(lines.findIndex((l) => l.startsWith('── FROZEN'))), '  (tap to clear)');
    else if (frozen) lines.push('  (tap to clear)');
    box.textContent = lines.join('\n');
    // Sit near the bottom of the VISUAL viewport, clear of the founder pill (bottom 12, ~40 tall),
    // at screen size whatever the zoom.
    if (vv) {
      const h = box.offsetHeight / scale;
      box.style.transform = `translate(${vv.offsetLeft + 8 / scale}px, ${Math.max(vv.offsetTop, vv.offsetTop + vv.height - h - 64 / scale)}px) scale(${1 / scale})`;
    } else {
      box.style.transform = `translate(8px, ${Math.max(0, window.innerHeight - box.offsetHeight - 64)}px)`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    box.removeEventListener('click', clear);
    for (const ev of EVENTS) (ev === 'visibilitychange' ? document : window).removeEventListener(ev, onEvent);
    vvp?.removeEventListener('resize', onVv);
    box.remove();
  };
}
