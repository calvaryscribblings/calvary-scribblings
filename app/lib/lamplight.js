'use client';

// LAMPLIGHT — ambient night reading light.
//
// A circadian "lamp" that warms the reading surface after dark: edge feathers
// and corner pools of ember light that breathe, gutter when you scroll (as if
// stirred by moving air), and deepen as a story closes. Off by day.
//
// This module owns three things:
//   1. getLamplight(date)  — the night curve (minutes-of-day, linear interp).
//   2. lerpEmber(warmth)   — the amber→deep-ember tone ramp.
//   3. <Lamplight>          — the React layer that renders and animates it all,
//                             compositor-only (opacity/transform), zero idle cost.
//
// The visual layers (feathers, pools, warmth wash, breathing keyframes) live in
// globals.css under the `.lamplight-*` / `.ll-*` classes. This file drives them
// through a handful of CSS custom properties:
//   --ll-ember     "r,g,b"  current ember tone
//   --ll-intensity 0..~1.1  overall strength (time + session)
//   --ll-mount     0 | 1     the 2.5s come-on / fade-out
//   --ll-disturb   ~0..1.2   fast opacity multiplier from the flame physics

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// ── The two ember tones ────────────────────────────────────────────────────
const EMBER_WARM = [212, 140, 70]; // warmth 0 — early-evening amber
const EMBER_DEEP = [196, 104, 58]; // warmth 1 — deep late-night ember

// ── Night-paper tones (story surface) ──────────────────────────────────────
// The reading surface itself after dark: lamplit paper, not the brand near-black.
const PAPER_LIT = [22, 18, 14];  // #16120e — warmth 0, a shade lifted and warm
const PAPER_DEEP = [25, 16, 8];  // #191008 — warmth 1, the paper deepens at night

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The night-paper background for a given time-warmth, as an rgb() string.
function paperColor(warmth) {
  const w = clamp01(warmth);
  const r = Math.round(PAPER_LIT[0] + (PAPER_DEEP[0] - PAPER_LIT[0]) * w);
  const g = Math.round(PAPER_LIT[1] + (PAPER_DEEP[1] - PAPER_LIT[1]) * w);
  const b = Math.round(PAPER_LIT[2] + (PAPER_DEEP[2] - PAPER_LIT[2]) * w);
  return `rgb(${r},${g},${b})`;
}

// Linear interpolation between the two ember tones. Returns an "r,g,b" string
// ready to drop into rgba(var(--ll-ember), a).
export function lerpEmber(warmth) {
  const w = clamp01(warmth);
  const r = Math.round(EMBER_WARM[0] + (EMBER_DEEP[0] - EMBER_WARM[0]) * w);
  const g = Math.round(EMBER_WARM[1] + (EMBER_DEEP[1] - EMBER_WARM[1]) * w);
  const b = Math.round(EMBER_WARM[2] + (EMBER_DEEP[2] - EMBER_WARM[2]) * w);
  return `${r},${g},${b}`;
}

// ── The night curve ────────────────────────────────────────────────────────
// Twelve hours exactly, 20:00 → 08:00, measured on a "night axis" nt = minutes
// since 20:00 (so the plateau across midnight is a straight line, no wrap math
// downstream). Nodes are [nt, value]; sampled with linear interpolation.
//
//   20:00 nt0    ramp-in begins        intensity 0     warmth 0  (amber)
//   20:30 nt30   full                  intensity 1.0   warmth 0
//   23:00 nt180                        intensity 1.0   warmth 0.5
//   01:00 nt300  deep-ember plateau    intensity 0.85  warmth 1.0
//   05:30 nt570  plateau ends          intensity 0.85  warmth 1.0
//   07:15 nt675  cooling toward day    intensity 0.85  warmth 0.4
//   08:00 nt720  OFF                   intensity 0     warmth 0.4
const NIGHT_START = 20 * 60;   // 20:00 in minutes-of-day
const NIGHT_LENGTH = 12 * 60;  // 720 minutes

const INTENSITY = [[0, 0], [30, 1], [180, 1], [300, 0.85], [675, 0.85], [720, 0]];
const WARMTH = [[0, 0], [30, 0], [180, 0.5], [300, 1], [570, 1], [675, 0.4], [720, 0.4]];

function sampleCurve(nodes, x) {
  if (x <= nodes[0][0]) return nodes[0][1];
  const last = nodes[nodes.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < nodes.length; i++) {
    const [x1, y1] = nodes[i];
    if (x <= x1) {
      const [x0, y0] = nodes[i - 1];
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

// getLamplight(date) → { active, warmth, intensity }.
// Local device time. Daytime returns { active: false } and the layers unmount.
export function getLamplight(date = new Date()) {
  const mins = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const nt = (((mins - NIGHT_START) % 1440) + 1440) % 1440;
  if (nt >= NIGHT_LENGTH) return { active: false, warmth: 0, intensity: 0 };
  return { active: true, warmth: sampleCurve(WARMTH, nt), intensity: sampleCurve(INTENSITY, nt) };
}

// ── The flame physics spring ───────────────────────────────────────────────
// Underdamped so the disturbance settles in ~700ms with a slight overshoot
// below zero — that dip reads as a "steadying" brightness swell as the lamp
// recovers. (omega ≈ 8 rad/s, zeta ≈ 0.7 → ~4.6% overshoot.)
const SPRING_STIFFNESS = 64;
const SPRING_DAMPING = 11.2;

// ── The component ──────────────────────────────────────────────────────────
// Props:
//   scroll       attach a window-scroll listener (story page): disturbance from
//                scroll velocity, progress from scroll position.
//   reader       enable "the room settling in" — session warming over 20 min.
//   getProgress  optional 0..1 supplier (unused when the parent drives progress
//                imperatively via the ref).
//
// Imperative handle (ref): bump(amount), pulse(), chapter(), setProgress(p),
// startSession(). The book reader wires these to Foliate page/chapter events.
export const Lamplight = forwardRef(function Lamplight({ scroll = false, reader = false, surface = false }, ref) {
  const [mounted, setMounted] = useState(false);
  const mountedRef = useRef(false);
  const rootRef = useRef(null);
  const warmthRef = useRef(null);
  const reducedRef = useRef(false);

  // All fast-changing state lives here to avoid React re-renders per frame.
  const st = useRef({
    time: { active: false, warmth: 0, intensity: 0 },
    progress: 0,
    sessionStart: null,
    d: 0, vel: 0,            // disturbance spring
    pulseStart: -1, pulsePeak: 1, pulseDur: 0,
    chapterStart: -1,
    lastSwellFired: false,
    rafId: 0,
    running: false,
  });

  // Write a CSS var onto both driven layers (ember/intensity feed the wash too).
  const setVar = (prop, val, bothLayers) => {
    rootRef.current?.style.setProperty(prop, val);
    if (bothLayers) warmthRef.current?.style.setProperty(prop, val);
  };

  // Recompute ember tone + intensity from the slow inputs (time + session +
  // scroll-progress warmth) and push them to the DOM. Cheap; called per minute,
  // on progress change, and once on mount.
  const applyVars = () => {
    const s = st.current;
    const t = s.time;
    if (!t.active || !rootRef.current) return;
    let sessI = 0, sessW = 0;
    if (reader && s.sessionStart != null) {
      const f = clamp01((Date.now() - s.sessionStart) / (20 * 60 * 1000));
      sessI = 0.25 * f;
      sessW = 0.15 * f;
    }
    const warmth = clamp01(t.warmth + 0.2 * s.progress + sessW); // hearth deepens as story closes
    const intensity = Math.max(0, t.intensity + sessI);
    setVar('--ll-ember', lerpEmber(warmth), true);
    setVar('--ll-intensity', intensity.toFixed(3), true);
    // Night paper (story surface): the background follows the TIME warmth only —
    // it deepens through the night, not as you scroll. Published on <html> so the
    // story page's scoped [data-lamplight] rules can crossfade the surface.
    if (surface && typeof document !== 'undefined') {
      const doc = document.documentElement;
      doc.style.setProperty('--ll-paper', paperColor(t.warmth));
      doc.style.setProperty('--ll-warmth', t.warmth.toFixed(3));
    }
  };

  // The single rAF loop — runs ONLY while something is animating, then stops.
  const ensureLoop = () => {
    const s = st.current;
    if (s.running || reducedRef.current) return;
    s.running = true;
    let prev = performance.now();
    const frame = (ts) => {
      const s2 = st.current;
      const dt = Math.min(0.05, Math.max(0.001, (ts - prev) / 1000));
      prev = ts;

      // Disturbance spring toward 0 (slight overshoot below 0 = steadying swell).
      const acc = -SPRING_STIFFNESS * s2.d - SPRING_DAMPING * s2.vel;
      s2.vel += acc * dt;
      s2.d += s2.vel * dt;
      if (Math.abs(s2.d) < 0.0015 && Math.abs(s2.vel) < 0.0015) { s2.d = 0; s2.vel = 0; }

      // Fast, low-amplitude gutter flicker while genuinely disturbed (moving air).
      let gutter = 1;
      if (s2.d > 0.15) {
        const amp = 0.04 * Math.min(1, (s2.d - 0.15) / 0.4);
        const n = Math.sin(ts * 0.045) * 0.6 + Math.sin(ts * 0.031 + 1.3) * 0.4;
        gutter = 1 + n * amp;
      }

      // Brightness swell (page turn / last-page breath) — a rise-and-fall bell.
      let pulseMult = 1;
      if (s2.pulseStart >= 0) {
        const e = ts - s2.pulseStart;
        if (e >= s2.pulseDur) { s2.pulseStart = -1; }
        else pulseMult = 1 + (s2.pulsePeak - 1) * Math.sin(Math.PI * (e / s2.pulseDur));
      }

      // Chapter turn — dim to 0.4 over 400ms, restore over 900ms (a scene change).
      let chapterMult = 1;
      if (s2.chapterStart >= 0) {
        const e = ts - s2.chapterStart;
        if (e < 400) chapterMult = 1 + (0.4 - 1) * (e / 400);
        else if (e < 1300) chapterMult = 0.4 + (1 - 0.4) * ((e - 400) / 900);
        else s2.chapterStart = -1;
      }

      const disturb = Math.max(0, Math.min(1.2, (1 - 0.35 * s2.d) * gutter * pulseMult * chapterMult));
      setVar('--ll-disturb', disturb.toFixed(4), false);

      const stillGoing = s2.d !== 0 || s2.vel !== 0 || s2.pulseStart >= 0 || s2.chapterStart >= 0;
      if (stillGoing) { s2.rafId = requestAnimationFrame(frame); }
      else { s2.running = false; setVar('--ll-disturb', '1', false); }
    };
    s.rafId = requestAnimationFrame(frame);
  };

  const bumpInternal = (amount) => {
    if (reducedRef.current) return;
    const s = st.current;
    s.d = Math.min(1, Math.max(s.d, amount));
    ensureLoop();
  };
  const triggerPulse = (peak, dur) => {
    if (reducedRef.current) return;
    const s = st.current;
    s.pulseStart = performance.now();
    s.pulsePeak = peak;
    s.pulseDur = dur;
    ensureLoop();
  };
  const triggerChapter = () => {
    if (reducedRef.current) return;
    st.current.chapterStart = performance.now();
    ensureLoop();
  };
  const setProgressInternal = (p) => {
    const s = st.current;
    s.progress = clamp01(p);
    applyVars();
    if (s.progress < 0.9) s.lastSwellFired = false;
    if (!reducedRef.current && s.progress >= 0.98 && !s.lastSwellFired) {
      s.lastSwellFired = true;
      triggerPulse(1.22, 1600); // the last-page breath, once
    }
  };

  useImperativeHandle(ref, () => ({
    bump: (a) => bumpInternal(a == null ? 0.5 : a),
    pulse: () => triggerPulse(1.35, 1600),
    chapter: () => triggerChapter(),
    setProgress: (p) => setProgressInternal(p),
    startSession: () => { if (st.current.sessionStart == null) st.current.sessionStart = Date.now(); },
  }), []);

  // Reduced-motion: the comfort stays (static lamps), the motion goes.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { reducedRef.current = mq.matches; };
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  // Per-minute night-curve evaluation: mount at dusk, unmount by day.
  useEffect(() => {
    let unmountTimer;
    const evaluate = () => {
      const L = getLamplight(new Date());
      st.current.time = L;
      if (L.active && !mountedRef.current) {
        mountedRef.current = true;
        setMounted(true);
      } else if (!L.active && mountedRef.current) {
        setVar('--ll-mount', '0', false); // fade the lamps down like lamps
        // Let the reading surface crossfade back to cream over the same 2.5s.
        if (surface && typeof document !== 'undefined') document.documentElement.removeAttribute('data-lamplight');
        clearTimeout(unmountTimer);
        unmountTimer = setTimeout(() => { mountedRef.current = false; setMounted(false); }, 2600);
      }
      applyVars();
    };
    evaluate();
    const id = setInterval(evaluate, 60000);
    return () => { clearInterval(id); clearTimeout(unmountTimer); };
  }, []);

  // On (re)mount of the layers: seed vars, start the session clock, then raise
  // --ll-mount on the next frame so the 2.5s CSS transition plays (comes on).
  useEffect(() => {
    if (!mounted) return;
    if (reader) st.current.sessionStart = st.current.sessionStart ?? Date.now();
    applyVars();
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => {
        setVar('--ll-mount', '1', false);
        // Arrive with the same 2.5s grace as the lamps: flip the surface signal
        // on <html> now so the story page's night-paper crossfade begins in step.
        if (surface && typeof document !== 'undefined') document.documentElement.setAttribute('data-lamplight', 'on');
      });
      st.current._r2 = r2;
    });
    return () => { cancelAnimationFrame(r1); if (st.current._r2) cancelAnimationFrame(st.current._r2); };
  }, [mounted, reader]);

  // Story page: disturbance from scroll velocity, progress from scroll position.
  useEffect(() => {
    if (!scroll || !mounted || typeof window === 'undefined') return;
    let lastY = window.scrollY;
    let lastT = performance.now();
    const onScroll = () => {
      const y = window.scrollY;
      const t = performance.now();
      const dt = Math.max(16, t - lastT);
      const v = Math.abs(y - lastY) / dt; // px/ms
      lastY = y; lastT = t;
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      setProgressInternal(docH > 0 ? y / docH : 0);
      bumpInternal(Math.min(1, v / 3)); // a fast flick (~2.4px/ms) ≈ 0.8
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [scroll, mounted]);

  // Stop any loop on unmount; drop the surface signal so day styling returns.
  useEffect(() => () => {
    if (st.current.rafId) cancelAnimationFrame(st.current.rafId);
    st.current.running = false;
    if (surface && typeof document !== 'undefined') document.documentElement.removeAttribute('data-lamplight');
  }, []);

  if (!mounted) return null;

  return (
    <>
      {/* Layer 3 — page warmth. A separate top-level sibling (not nested under
          the opacity-animated lamp root) so mix-blend multiply reaches the page
          behind it. A whisper: 0.03 × intensity. */}
      <div ref={warmthRef} className="ll-warmth-layer" aria-hidden="true" />
      {/* Layers 1 & 2 — the lamps. Root owns the mount fade; stage owns the fast
          flame-physics opacity; the four gradients own their breathing. */}
      <div ref={rootRef} className="lamplight-root" aria-hidden="true">
        <div className="lamplight-stage">
          <div className="ll-feather ll-feather-l" />
          <div className="ll-feather ll-feather-r" />
          <div className="ll-pool ll-pool-l" />
          <div className="ll-pool ll-pool-r" />
        </div>
      </div>
    </>
  );
});
