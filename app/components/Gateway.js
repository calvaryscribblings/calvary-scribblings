'use client';
// The gateway — the front door at /. Two doors: the Public Library (the reading platform,
// which is where the content and the link equity live) and the Book Store (a modal only —
// the /bookstore route stays unlinked until launch, per the bookstore workstream's protocol).
//
// The gateway is contractually ZERO-FIREBASE at runtime. The story count and the door's
// rotating whispers are read from cms_stories at BUILD TIME (app/lib/gateway-build.js) and
// handed in as props; nothing here touches Firebase. The deploy-on-publish hook keeps the
// baked values fresh.
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VEIL_AT, PUSH_AT, VEIL_FADE } from '../lib/gatewayTransition';

// The dial. When true, a returning visitor who last chose the Library is sent straight there
// and never sees the gateway again. Currently false: the gateway is the front door on every
// visit. The ?gateway=1 escape hatch and the localStorage write below stay in place but are
// inert while this is false — flipping this one const restores the old behaviour, and any
// visitor who has tapped the Library door since is already tagged.
//
// This is deliberately client-only and localStorage-gated: crawlers carry no localStorage,
// so bots always render the full gateway. Never make this a server or <meta> redirect.
const AUTO_ROUTE = false;

const CHOICE_KEY = 'cs_gateway_choice';
// Handed to /public-library so it knows to fade up from the veil rather than just appear.
// sessionStorage, not local: it must not survive the tab, and a refresh must load plainly.
const ARRIVING_KEY = 'cs_arriving';
const LIBRARY = '/public-library';
import { LAUNCH_TEXT, LAUNCH_DATE_LABEL, BOOKSTORE_OPENS, daysUntilLaunch } from '../lib/launch';

// ⚠ R9.1 — `const LAUNCH = { y: 2026, m: 9, d: 30 }` AND A BYTE-IDENTICAL daysUntilLaunch()
// STOOD HERE, hand-copied into app/my-library/page.js under a comment saying so. Both fed a
// COUNTDOWN THE READER CAN SEE, and neither was visible to a grep for "September" — which is
// why R34's nine-file launch-date inventory missed the two sites that mattered most. The date
// and the arithmetic now come from app/lib/launch.js; nothing here may name a date again.

// Press grammar, adopted from the CANONICAL source of truth founded in the Voices commit
// (app/voices/voices-client.js — PRESS_SCALE / CHOSEN_SCALE). The chosen door yields under
// the finger (0.985) before it takes command (1.02). Do not fork these — change them at the
// canonical site and mirror here.
const PRESS_SCALE = 0.985;
const CHOSEN_SCALE = 1.02;
const PRESS_MS = 90;

// Ambient drifting glyphs. Two fields: MOBILE keeps the founding density (10 glyphs), while
// DESKTOP grows to ~16 at scale (item 2) so the letter-weather registers on a wide viewport
// and the glass doors visibly catch drifting letters through their blur. Only one field is
// ever visible — the other is display:none per breakpoint (see CSS) — so sizes can live in
// inline style without a hydration hazard. Negative delays stagger them mid-flight on first
// paint rather than all rising together.
const MOBILE_LETTERS = [
  { ch: 'S', left: '5%', size: 66, o: 0.10, dur: 26, delay: -4, italic: false },
  { ch: 'a', left: '16%', size: 32, o: 0.15, dur: 33, delay: -16, italic: true },
  { ch: 'e', left: '27%', size: 50, o: 0.09, dur: 38, delay: -9, italic: false },
  { ch: 'k', left: '39%', size: 27, o: 0.16, dur: 29, delay: -22, italic: true },
  { ch: 'O', left: '52%', size: 58, o: 0.08, dur: 41, delay: -2, italic: false },
  { ch: 'n', left: '64%', size: 30, o: 0.15, dur: 31, delay: -25, italic: true },
  { ch: 'g', left: '76%', size: 46, o: 0.10, dur: 36, delay: -12, italic: false },
  { ch: 'i', left: '87%', size: 34, o: 0.13, dur: 27, delay: -19, italic: true },
  { ch: 't', left: '10%', size: 24, o: 0.12, dur: 34, delay: -28, italic: true },
  { ch: 'r', left: '70%', size: 22, o: 0.11, dur: 30, delay: -6, italic: false },
];
// Sizes 22–110px, opacity ceiling 0.20, durations 26–48s, spread across the full width.
// The big glyphs run faint; the small ones carry the higher opacity so nothing shouts.
const DESKTOP_LETTERS = [
  { ch: 'S', left: '4%', size: 104, o: 0.07, dur: 44, delay: -6, italic: false },
  { ch: 'c', left: '13%', size: 30, o: 0.16, dur: 29, delay: -18, italic: true },
  { ch: 'r', left: '21%', size: 64, o: 0.10, dur: 37, delay: -3, italic: false },
  { ch: 'i', left: '29%', size: 24, o: 0.18, dur: 27, delay: -24, italic: true },
  { ch: 'b', left: '37%', size: 88, o: 0.08, dur: 46, delay: -11, italic: false },
  { ch: 'l', left: '45%', size: 34, o: 0.15, dur: 31, delay: -20, italic: true },
  { ch: 'i', left: '53%', size: 52, o: 0.12, dur: 34, delay: -2, italic: false },
  { ch: 'n', left: '60%', size: 110, o: 0.06, dur: 48, delay: -14, italic: false },
  { ch: 'g', left: '68%', size: 28, o: 0.20, dur: 26, delay: -27, italic: true },
  { ch: 's', left: '75%', size: 70, o: 0.09, dur: 40, delay: -8, italic: false },
  { ch: 'O', left: '83%', size: 46, o: 0.13, dur: 33, delay: -16, italic: false },
  { ch: 'a', left: '91%', size: 22, o: 0.19, dur: 28, delay: -22, italic: true },
  { ch: 'e', left: '9%', size: 40, o: 0.14, dur: 36, delay: -30, italic: true },
  { ch: 't', left: '48%', size: 26, o: 0.17, dur: 30, delay: -5, italic: true },
  { ch: 'v', left: '65%', size: 58, o: 0.11, dur: 42, delay: -25, italic: false },
  { ch: 'k', left: '88%', size: 36, o: 0.15, dur: 32, delay: -13, italic: true },
];

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The cover wall (the hero, item 1). The build-time script cuts up to 12 darkened WebP tiles;
// here we lay a mosaic that must fill the tallest viewport we support (portrait tablet, 6
// columns) with room to drift, so we cycle those tiles across a fixed cell count. 48 = 6
// columns × 8 rows covers portrait tablet and overflows every phone/desktop, all clipped by
// the wall's overflow:hidden. Reused src ⇒ the browser fetches each unique tile once and
// paints the rest from cache; the DOM cost of the extra <img> nodes is negligible.
const WALL_TILES = 48;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// ── The island keeps time (item 6) ──────────────────────────────────────────────
// A tint on the radial glow keyed to the VISITOR'S local hour, not London's — a warmth
// that follows the reader's own sky, not a theme swap. Deepest at night, cooler at dawn,
// amber-touched at dusk.
function glowForHour(h) {
  if (h >= 5 && h < 11) return { glow: '#2a1a6e', amber: false }; // 05–11 cooler blue-violet
  if (h >= 11 && h < 17) return { glow: '#1c0f38', amber: false }; // 11–17 current violet
  if (h >= 17 && h < 21) return { glow: '#301642', amber: true }; // 17–21 warmer dusk + amber
  return { glow: '#100722', amber: false }; // 21–05 deepest night
}

// The hour on the Square's own clock (Europe/London), regardless of where the visitor is —
// this drives the "open tonight" line. 24 normalises to 0 so midnight closes the window.
function londonHour() {
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(new Date())
    );
    return h === 24 ? 0 : h;
  } catch {
    return -1;
  }
}

function Modal({ id, titleId, title, onClose, closeLabel = 'RETURN TO THE ISLAND', children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  // Where focus came from, so it can be handed back when the dialog closes.
  const restoreRef = useRef(null);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    closeRef.current?.focus();
    const el = restoreRef.current;
    return () => {
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: cycle within the panel rather than escaping to the page behind.
      const items = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!items || !items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="cs-gw-backdrop"
      id={id}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* The modal panel adopts the canonical glass (cs-gw-glass), frosting the scrim behind it. */}
      <div className="cs-gw-modal cs-gw-glass" ref={panelRef}>
        <h2 className="cs-gw-modal-title" id={titleId}>{title}</h2>
        <div className="cs-gw-rule" />
        {children}
        <button className="cs-gw-modal-close" type="button" onClick={onClose} ref={closeRef}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}

export default function Gateway({ storyCount = 0, whispers = [], whisperSeed = 0, wall = [] }) {
  const router = useRouter();
  const [modal, setModal] = useState(null); // 'store' | 'universe' | null
  const [exiting, setExiting] = useState(false);
  const [pressed, setPressed] = useState(false); // the Library door yielding under the tap
  const timer = useRef(null);
  const pushTimer = useRef(null);

  // ── Item 4: the countdown. Server renders LAUNCH_TEXT (SEO / no-JS); the client swaps in
  //    the live days once it knows the date. Init matches the server string so hydration is
  //    clean; the effect updates only after mount.
  const [opensLabel, setOpensLabel] = useState(LAUNCH_TEXT);

  // ── Item 6: the tint + the London evening line. Defaults match a no-JS render (current
  //    violet, no amber, closed) so nothing shifts before the clock is read.
  const [glow, setGlow] = useState(null);
  const [amber, setAmber] = useState(false);
  const [squareOpen, setSquareOpen] = useState(false);

  // ── Item 3: the whisper. Two crossfading layers, aIdx/bIdx the quote each holds, `active`
  //    which one is lit. Both open on the build-time pick so the first (crawlable) frame is
  //    real and hydration-stable.
  const len = whispers.length;
  const start = len ? ((whisperSeed % len) + len) % len : 0;
  const [aIdx, setAIdx] = useState(start);
  const [bIdx, setBIdx] = useState(start);
  const [active, setActive] = useState('a');

  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(pushTimer.current);
  }, []);

  useEffect(() => {
    if (!AUTO_ROUTE) return;
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    // ?gateway=1 is the escape hatch: always show the gateway, and forget the stored choice.
    if (params.get('gateway') === '1') {
      try { localStorage.removeItem(CHOICE_KEY); } catch {}
      return;
    }
    let choice = null;
    try { choice = localStorage.getItem(CHOICE_KEY); } catch {}
    if (choice === 'library') router.replace(LIBRARY);
  }, [router]);

  // The clock. Reads the visitor's local hour (tint) and London's hour (Square line) on
  // mount, then re-checks each minute so an hour ticking over while the page is open eases
  // across imperceptibly. Also refreshes the countdown, in case the page is left open past
  // a London midnight.
  useEffect(() => {
    const tick = () => {
      const local = new Date().getHours();
      const { glow: g, amber: a } = glowForHour(local);
      setGlow(g);
      setAmber(a);
      const lh = londonHour();
      setSquareOpen(lh >= 20 && lh < 24);

      const n = daysUntilLaunch();
      if (n === null) setOpensLabel(LAUNCH_TEXT);
      else if (n <= 0) setOpensLabel(LAUNCH_TEXT); // launch-day handling comes later
      else if (n === 1) setOpensLabel('Opens tomorrow');
      else setOpensLabel(`Opens in ${n} days`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  // The whisper rotation: every 7s, bring the next quote up on the dark layer and cross the
  // light over to it (600ms, via CSS). Paused while the tab is hidden, and skipped entirely
  // under reduced motion (one static quote — the build-time pick) or with 0–1 quotes.
  useEffect(() => {
    if (len < 2 || prefersReducedMotion()) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setActive((cur) => {
        const showing = cur === 'a' ? aIdx : bIdx;
        const next = (showing + 1) % len;
        if (cur === 'a') { setBIdx(next); return 'b'; }
        setAIdx(next);
        return 'a';
      });
    }, 7000);
    return () => clearInterval(id);
  }, [len, aIdx, bIdx]);

  const rememberLibrary = useCallback(() => {
    try { localStorage.setItem(CHOICE_KEY, 'library'); } catch {}
  }, []);

  // Walking into the door: the tapped door yields (press, 0.985), then swells and brightens
  // (chosen, 1.02) while everything else falls away, a veil closes over the room, and a
  // hairline of light appears under it. The Book Store door should call this too once it
  // becomes real navigation at launch — pass its own href and it inherits the whole exit.
  const walkThrough = useCallback((e, href) => {
    rememberLibrary();
    // Reduced motion: no choreography, and no arrival flag, so the far side loads plainly.
    if (prefersReducedMotion()) return;
    e.preventDefault();
    if (exiting || pressed) return;
    // Press first (0.985), then hand off to the exit (which takes the door to 1.02).
    setPressed(true);
    timer.current = setTimeout(() => {
      setPressed(false);
      setExiting(true);
      pushTimer.current = setTimeout(() => {
        try { sessionStorage.setItem(ARRIVING_KEY, '1'); } catch {}
        router.push(href);
      }, PUSH_AT);
    }, PRESS_MS);
  }, [exiting, pressed, rememberLibrary, router]);

  const closeModal = useCallback(() => setModal(null), []);

  // The two quotes currently mounted, and which layer each sits on.
  const whisperA = len ? whispers[aIdx] : null;
  const whisperB = len ? whispers[bIdx] : null;

  // The mosaic cells: cycle the baked tiles across the fixed cell count so the wall fills the
  // viewport regardless of how few covers the build produced. Empty when there are no tiles —
  // the radial-gradient background then shows through, exactly as before the wall existed.
  const wallCells = wall.length
    ? Array.from({ length: WALL_TILES }, (_, i) => wall[i % wall.length])
    : [];

  return (
    <div className={`cs-gw${exiting ? ' is-exiting' : ''}`} style={glow ? { '--gw-glow': glow } : undefined}>
      <style>{`
        /* The glow colour is animatable so the island's hour-tint (item 6) eases rather than
           snaps. Where @property is unsupported the tint simply cuts over — rare, since it
           only changes on an hour boundary while the page is open. */
        @property --gw-glow { syntax:'<color>'; inherits:false; initial-value:#1c0f38; }

        .cs-gw {
          --gw-night:#0b0716; --gw-deep:#080610; --gw-gold:#c9a84c;
          --gw-gold-bright:#e2c876; --gw-cream:#f5f0e8; --gw-veil:#050309;
          --gw-glow:#1c0f38;
          --gw-serif:'Cormorant Garamond',Georgia,serif;
          --gw-display:'Cinzel',Georgia,serif;
          /* Sized in vmin so the glow scales with the viewport instead of hugging a
             phone-width column. The centre stop is a variable so the hour tints it. */
          background:radial-gradient(120vmin 80vmin at 50% -6vmin,
            var(--gw-glow) 0%, var(--gw-night) 55%, var(--gw-deep) 100%);
          min-height:100vh; position:relative; overflow:hidden;
          display:flex; justify-content:center; font-family:var(--gw-serif);
          transition:--gw-glow 3000ms linear;
        }
        .cs-gw *,.cs-gw *::before,.cs-gw *::after { box-sizing:border-box; margin:0; padding:0; }
        .cs-gw.is-exiting { pointer-events:none; }

        /* ── Canonical glass ─────────────────────────────────────────────────────
           Adopted verbatim from the source of truth founded in the Voices commit
           (app/voices/[slug]/page-client.js, ".cs-vp-chip"): same fill, blur, saturate,
           border, inset highlights, and @supports solid fallback. The only gateway-specific
           value is the gradient ANGLE (160°, per the life-pass spec) vs the chip's 180°.
           Do not fork the colour/blur/border values — change them at the canonical site. */
        .cs-gw-glass {
          background:linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
          -webkit-backdrop-filter:blur(14px) saturate(1.35);
          backdrop-filter:blur(14px) saturate(1.35);
          border:1px solid rgba(201,168,76,.35);
          box-shadow:inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25);
        }
        @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
          .cs-gw-glass { background:rgba(11,7,22,.88); }
        }

        /* ── The cover wall (item 1) ─────────────────────────────────────────────
           The hero: a mosaic of build-baked cover tiles, the lowest layer, glimpsed in the
           dark beneath the scrim. Fixed and clipped; sized taller than the viewport (and
           anchored above its top) so the slow drift never bares an edge. */
        .cs-gw-wall {
          position:fixed; inset:-60px 0 auto 0; height:calc(100vh + 200px);
          overflow:hidden; z-index:0; pointer-events:none;
        }
        .cs-gw-wall-grid {
          display:grid; grid-template-columns:repeat(4, 1fr); width:100%;
          /* Felt, not seen: a few dozen px over ~70s, easing at each end. */
          animation:cs-gw-wall-drift 70s ease-in-out infinite alternate;
          will-change:transform;
        }
        @media (min-width:768px) { .cs-gw-wall-grid { grid-template-columns:repeat(6, 1fr); } }
        .cs-gw-wall-tile {
          display:block; width:100%; aspect-ratio:2 / 3; object-fit:cover;
          /* Shelves in the dark, not a gallery. */
          filter:brightness(0.35) saturate(0.85);
        }
        @keyframes cs-gw-wall-drift { from { transform:translateY(0); } to { transform:translateY(-44px); } }
        @media (prefers-reduced-motion: reduce) { .cs-gw-wall-grid { animation:none; } }

        /* The scrim: radial glow (hour-tinted via --gw-glow) over a vertical floor of the
           existing bg colours, darkest at top around the header, so every text layer keeps at
           least its former contrast over the wall. Sits above the wall, below the letters. */
        .cs-gw-scrim {
          position:fixed; inset:0; z-index:1; pointer-events:none;
          background:
            radial-gradient(120vmin 82vmin at 50% -6vmin,
              color-mix(in srgb, var(--gw-glow) 78%, transparent) 0%, transparent 60%),
            linear-gradient(180deg,
              rgba(8,6,16,.92) 0%, rgba(8,6,16,.7) 22%, rgba(11,7,22,.58) 48%,
              rgba(8,6,16,.7) 76%, rgba(5,3,9,.9) 100%);
          transition:--gw-glow 3000ms linear;
        }
        /* Where color-mix is unsupported, fall back to a plain dark floor (no glimpsed glow,
           but full contrast) rather than an unparsed — and therefore ignored — background. */
        @supports not (background: color-mix(in srgb, red 50%, transparent)) {
          .cs-gw-scrim {
            background:
              radial-gradient(120vmin 82vmin at 50% -6vmin, var(--gw-glow) 0%, transparent 60%),
              linear-gradient(180deg,
                rgba(8,6,16,.94) 0%, rgba(8,6,16,.72) 22%, rgba(11,7,22,.6) 48%,
                rgba(8,6,16,.72) 76%, rgba(5,3,9,.92) 100%);
          }
        }

        /* The dusk amber cast (item 6): a faint warm wash over the glow, behind everything
           else, that fades in only in the 17–21 window. Above the scrim so the warmth reads. */
        .cs-gw-dusk {
          position:fixed; inset:0; z-index:1; pointer-events:none; opacity:0;
          background:radial-gradient(120vmin 80vmin at 50% -6vmin,
            rgba(201,120,60,.10) 0%, transparent 60%);
          transition:opacity 3000ms linear;
        }
        .cs-gw-dusk.is-on { opacity:1; }

        /* Letters drift across the whole viewport at every size, not just the column. Layer
           order bottom→top: wall (0) → scrim/dusk (1) → letters (2) → panel/doors (3). The
           doors' glass (in the panel) therefore refracts BOTH the drifting glyphs AND the
           cover wall behind them through its backdrop-blur. */
        .cs-gw-letters { position:fixed; inset:0; overflow:hidden; pointer-events:none; z-index:2; }
        .cs-gw-panel {
          width:100%; max-width:420px; min-height:100vh; position:relative; z-index:3;
          display:flex; flex-direction:column; justify-content:center;
          padding:44px 22px 30px; text-align:center;
        }
        .cs-gw-fl {
          position:absolute; font-family:var(--gw-serif); color:var(--gw-gold);
          user-select:none; pointer-events:none; bottom:-140px;
          animation:cs-gw-drift linear infinite;
        }
        /* Only one field is live per breakpoint; the other is removed from paint entirely. */
        .cs-gw-fl--desk { display:none; }
        @media (min-width:768px) {
          .cs-gw-fl--mob { display:none; }
          .cs-gw-fl--desk { display:block; }
        }
        @keyframes cs-gw-drift {
          0% { transform:translateY(0) rotate(-6deg); opacity:0; }
          10% { opacity:var(--o); }
          85% { opacity:var(--o); }
          100% { transform:translateY(calc(-100vh - 180px)) rotate(8deg); opacity:0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cs-gw-fl { animation:none; opacity:calc(var(--o) * .8); bottom:auto; }
          /* Static scatter across four bands rather than a rising drift. */
          .cs-gw-fl:nth-of-type(4n+1) { top:10%; }
          .cs-gw-fl:nth-of-type(4n+2) { top:34%; }
          .cs-gw-fl:nth-of-type(4n+3) { top:58%; }
          .cs-gw-fl:nth-of-type(4n)   { top:80%; }
        }
        .cs-gw-content { position:relative; z-index:2; }
        .cs-gw-logo {
          width:58px; height:auto; margin:0 auto 16px; display:block;
          /* drop-shadow follows the artwork's alpha; box-shadow would draw a rectangle. */
          filter:drop-shadow(0 6px 18px rgba(0,0,0,0.5));
        }
        .cs-gw-wordmark {
          font-family:var(--gw-display); font-size:14px; letter-spacing:.32em;
          color:var(--gw-cream); margin-bottom:7px;
        }
        .cs-gw-tagline { font-style:italic; font-size:18px; color:var(--gw-gold); margin-bottom:13px; }

        /* Item 2 — the epigraph. The rotating whisper, moved out of the Library door to sit
           beneath the tagline as the foyer's inscription: italic Cormorant, centred, capped
           at three lines with a gold attribution. Two crossfading layers share one box whose
           height is reserved for three lines + attribution, so rotation never shifts layout. */
        .cs-gw-epigraph { position:relative; min-height:98px; max-width:360px; margin:0 auto 28px; }
        .cs-gw-epigraph-layer { position:absolute; inset:0; opacity:0; transition:opacity 600ms ease; }
        .cs-gw-epigraph-layer.is-lit { opacity:1; }
        .cs-gw-epigraph-quote {
          font-family:var(--gw-serif); font-style:italic; font-size:17px; line-height:1.5;
          color:rgba(245,240,232,.82);
          display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;
        }
        .cs-gw-epigraph-attr {
          display:block; margin-top:6px; font-family:var(--gw-serif); font-style:italic;
          font-size:13.5px; color:var(--gw-gold);
        }

        /* ── The doors (item 3): compressed to essence, buttons again ───────────────
           Mobile: two full-width horizontal bands, stacked — glyph left, text right, one
           meta line each. Desktop (≥768px, below): side-by-side cards, height-capped,
           centred. No subtitle (it lives in the SEO prose) and no watermark. */
        .cs-gw-doors { display:flex; flex-direction:column; gap:11px; margin-bottom:15px; }
        .cs-gw-door {
          border-radius:15px; color:inherit; text-decoration:none; cursor:pointer;
          font-family:inherit; position:relative; overflow:hidden;
          display:flex; align-items:center; gap:16px; text-align:left;
          min-height:148px; padding:18px 20px;
          transition:border-color .2s, transform .2s;
        }
        .cs-gw-door:hover,.cs-gw-door:focus-visible { border-color:var(--gw-gold); transform:translateY(-2px); }
        .cs-gw-door:focus-visible,.cs-gw-pill:focus-visible,.cs-gw-small a:focus-visible,
        .cs-gw-small button:focus-visible,.cs-gw-modal-close:focus-visible,
        .cs-gw-arm-link:focus-visible {
          outline:2px solid var(--gw-gold-bright); outline-offset:3px;
        }
        .cs-gw-door-glyph { flex:none; font-size:32px; line-height:1; color:var(--gw-gold); }
        .cs-gw-door-text { display:flex; flex-direction:column; gap:5px; min-width:0; }
        .cs-gw-door-title {
          font-family:var(--gw-display); font-weight:600; font-size:13px; letter-spacing:.12em;
          color:var(--gw-cream); line-height:1.5;
        }
        .cs-gw-door-meta { font-style:italic; font-size:14.5px; color:rgba(245,240,232,.72); }
        .cs-gw-door-meta.cs-gw-opens { color:var(--gw-gold-bright); }
        /* Item 6 — the Square's evening pulse, inside the Library band beneath its meta line. */
        .cs-gw-door-square {
          font-family:var(--gw-display); font-size:9.5px; letter-spacing:.2em; text-transform:uppercase;
          color:var(--gw-gold); animation:cs-gw-square-pulse 2.5s ease-in-out infinite;
        }
        @keyframes cs-gw-square-pulse { 0%,100% { opacity:.7; } 50% { opacity:1; } }
        @media (prefers-reduced-motion: reduce) { .cs-gw-door-square { animation:none; opacity:1; } }

        .cs-gw-pill {
          display:block; width:100%; border-radius:999px; padding:13px; cursor:pointer;
          text-decoration:none; margin-bottom:24px; transition:border-color .2s;
        }
        .cs-gw-pill:hover,.cs-gw-pill:focus-visible { border-color:var(--gw-gold-bright); }
        .cs-gw-pill span {
          font-family:var(--gw-display); font-size:12.5px; letter-spacing:.24em; color:var(--gw-gold);
        }
        .cs-gw-small { display:flex; gap:26px; justify-content:center; margin-bottom:30px; }
        .cs-gw-small a,.cs-gw-small button {
          font-family:var(--gw-serif); font-style:italic; font-size:16px;
          color:rgba(245,240,232,.85); text-decoration:none;
          border:none; background:none; cursor:pointer; padding:0 0 2px;
          border-bottom:1px solid rgba(201,168,76,.5);
        }
        .cs-gw-small a:hover,.cs-gw-small button:hover { color:var(--gw-cream); border-color:var(--gw-gold); }
        .cs-gw-foot {
          font-family:var(--gw-display); font-size:9.5px; letter-spacing:.22em; color:rgba(245,240,232,.38);
        }
        .cs-gw-seo { margin-top:26px; }
        .cs-gw-seo p {
          font-family:var(--gw-serif); font-size:13px; line-height:1.65;
          color:rgba(245,240,232,.5); margin-bottom:12px;
        }
        /* Clear the cookie banner on phones so the first impression isn't obscured. */
        @media (max-width:480px) { .cs-gw-seo { padding-bottom:72px; } }

        /* ── Exit choreography ─────────────────────────────────────────────── */
        .is-exiting .cs-gw-fade { opacity:0; transition:opacity 350ms ease; }
        /* Press then chosen: 0.985 under the finger, 1.02 as the door takes command. */
        .cs-gw-door.is-pressed { transform:scale(${PRESS_SCALE}); transition:transform ${PRESS_MS}ms ease; }
        .cs-gw-door.is-entering {
          border-color:var(--gw-gold-bright); transform:scale(${CHOSEN_SCALE}); transform-origin:center;
          transition:transform 500ms ease-out, border-color 500ms ease-out;
        }
        .cs-gw-veil {
          /* Above everything, including the cookie banner (z 9999) — otherwise the banner
             stays crisp while the room falls away, and the exit reads as a bug. */
          position:fixed; inset:0; background:var(--gw-veil); z-index:10000; opacity:0;
          display:flex; align-items:center; justify-content:center;
          animation:cs-gw-veil-in ${VEIL_FADE}ms ease ${VEIL_AT}ms forwards;
        }
        @keyframes cs-gw-veil-in { to { opacity:1; } }
        /* The light under the door. */
        .cs-gw-hairline {
          width:0; height:1px; background:var(--gw-gold);
          animation:cs-gw-hairline-in 400ms ease ${VEIL_AT}ms forwards;
        }
        @keyframes cs-gw-hairline-in { to { width:120px; } }

        /* ── Modals ────────────────────────────────────────────────────────── */
        .cs-gw-backdrop {
          position:fixed; inset:0; background:rgba(4,3,9,.78); backdrop-filter:blur(3px);
          display:flex; align-items:center; justify-content:center; z-index:10; padding:24px;
        }
        .cs-gw-modal {
          width:100%; max-width:340px; border-radius:18px; padding:30px 24px 26px;
          text-align:center; position:relative; font-family:var(--gw-serif);
        }
        .cs-gw-rule { width:60px; height:1px; background:var(--gw-gold); margin:14px auto; }
        .cs-gw-modal-title {
          font-family:var(--gw-display); font-size:15px; letter-spacing:.2em;
          color:var(--gw-cream); font-weight:600;
        }
        .cs-gw-modal p { font-size:16.5px; color:rgba(245,240,232,.85); line-height:1.55; }
        .cs-gw-modal p em { color:var(--gw-gold-bright); }
        .cs-gw-modal-fine {
          font-style:italic; font-size:14.5px; margin-top:12px; color:rgba(245,240,232,.6);
        }
        .cs-gw-modal-close {
          margin-top:20px; background:none; border:1px solid rgba(201,168,76,.5);
          border-radius:999px; padding:8px 22px; font-family:var(--gw-display);
          font-size:11px; letter-spacing:.18em; color:var(--gw-gold); cursor:pointer;
        }
        .cs-gw-modal-close:hover { background:rgba(201,168,76,.08); }
        .cs-gw-arm {
          display:flex; align-items:center; gap:13px; text-align:left; padding:13px 10px;
          border-bottom:1px solid rgba(201,168,76,.16); text-decoration:none; color:inherit;
        }
        .cs-gw-arm:last-of-type { border-bottom:none; }
        .cs-gw-arm-glyph { font-size:20px; color:var(--gw-gold); width:26px; text-align:center; flex:none; }
        .cs-gw-arm h3 {
          font-family:var(--gw-display); font-size:12.5px; letter-spacing:.1em;
          color:var(--gw-cream); margin-bottom:2px; font-weight:600;
        }
        .cs-gw-arm p { font-style:italic; font-size:13.5px; color:rgba(245,240,232,.65); line-height:1.4; }
        .cs-gw-arm-link { display:flex; }
        .cs-gw-arm-link:hover h3 { color:var(--gw-gold-bright); }
        .cs-gw-arm-btn {
          width:100%; background:none; border-left:none; border-right:none; border-top:none;
          font-family:var(--gw-serif); cursor:pointer;
        }
        .cs-gw-arm-btn:focus-visible { outline:2px solid var(--gw-gold-bright); outline-offset:-2px; }

        /* ── The foyer ─────────────────────────────────────────────────────────
           Tablet takes the desktop composition, tighter; ≥900px opens up fully. */
        @media (min-width:768px) {
          .cs-gw-panel { max-width:600px; padding:56px 32px 40px; }
          .cs-gw-logo { width:72px; margin-bottom:18px; }
          .cs-gw-wordmark { font-size:15.5px; letter-spacing:.33em; }
          .cs-gw-tagline { font-size:20px; margin-bottom:14px; }
          .cs-gw-epigraph { min-height:100px; max-width:460px; margin-bottom:32px; }
          .cs-gw-epigraph-quote { font-size:18px; }
          .cs-gw-epigraph-attr { font-size:14px; }
          /* Doors turn from stacked bands into side-by-side cards, height-capped, centred. */
          .cs-gw-doors { flex-direction:row; gap:16px; margin-bottom:18px; }
          .cs-gw-door {
            flex:1; flex-direction:column; text-align:center; align-items:center; justify-content:center;
            gap:10px; min-height:0; max-height:200px; padding:30px 20px; border-radius:17px;
          }
          .cs-gw-door-text { align-items:center; gap:6px; }
          .cs-gw-door-glyph { font-size:34px; }
          .cs-gw-door-title { font-size:14px; }
          .cs-gw-door-meta { font-size:15.5px; }
          .cs-gw-pill { padding:15px; margin-bottom:28px; }
          .cs-gw-pill span { font-size:13px; }
          .cs-gw-small { gap:32px; font-size:17px; margin-bottom:34px; }
          .cs-gw-seo { max-width:560px; margin-left:auto; margin-right:auto; }
          .cs-gw-modal { max-width:400px; }
        }
        @media (min-width:900px) {
          .cs-gw-panel { max-width:720px; padding:60px 40px 46px; }
          .cs-gw-logo { width:84px; margin-bottom:20px; }
          .cs-gw-wordmark { font-size:17px; letter-spacing:.34em; margin-bottom:9px; }
          .cs-gw-tagline { font-size:22px; margin-bottom:16px; }
          .cs-gw-epigraph { min-height:104px; max-width:520px; margin-bottom:36px; }
          .cs-gw-epigraph-quote { font-size:19px; }
          .cs-gw-doors { gap:20px; margin-bottom:20px; }
          .cs-gw-door { max-height:200px; padding:34px 24px; border-radius:18px; gap:12px; }
          .cs-gw-door-glyph { font-size:38px; }
          .cs-gw-door-title { font-size:15px; }
          .cs-gw-door-meta { font-size:16.5px; }
          .cs-gw-pill { padding:16px; margin-bottom:30px; }
          .cs-gw-pill span { font-size:13.5px; letter-spacing:.26em; }
          .cs-gw-small { gap:38px; font-size:18px; margin-bottom:38px; }
          .cs-gw-foot { font-size:10.5px; }
          .cs-gw-seo { margin-top:32px; }
          .cs-gw-seo p { font-size:14px; }
        }
      `}</style>

      {/* Item 1 — the cover wall + its scrim. The lowest layers; rendered only when the build
          produced tiles, so an empty wall falls back to the plain radial-gradient background
          (and the scrim, which would otherwise just dim it, is skipped with it). The tiles are
          lazy + low-priority so text and glass paint first on Fast 3G. */}
      {wallCells.length > 0 && (
        <>
          <div className="cs-gw-wall" aria-hidden="true">
            <div className="cs-gw-wall-grid">
              {wallCells.map((t, i) => (
                <img
                  key={i}
                  className="cs-gw-wall-tile"
                  src={t.src}
                  alt=""
                  width={t.w}
                  height={t.h}
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                />
              ))}
            </div>
          </div>
          <div className="cs-gw-scrim" aria-hidden="true" />
        </>
      )}

      <div className={`cs-gw-dusk${amber ? ' is-on' : ''}`} aria-hidden="true" />

      <div className="cs-gw-letters cs-gw-fade" aria-hidden="true">
        {MOBILE_LETTERS.map((l, i) => (
          <span
            key={`m${i}`}
            className="cs-gw-fl cs-gw-fl--mob"
            style={{
              left: l.left,
              fontSize: l.size,
              fontStyle: l.italic ? 'italic' : 'normal',
              '--o': l.o,
              animationDuration: `${l.dur}s`,
              animationDelay: `${l.delay}s`,
            }}
          >
            {l.ch}
          </span>
        ))}
        {DESKTOP_LETTERS.map((l, i) => (
          <span
            key={`d${i}`}
            className="cs-gw-fl cs-gw-fl--desk"
            style={{
              left: l.left,
              fontSize: l.size,
              fontStyle: l.italic ? 'italic' : 'normal',
              '--o': l.o,
              animationDuration: `${l.dur}s`,
              animationDelay: `${l.delay}s`,
            }}
          >
            {l.ch}
          </span>
        ))}
      </div>

      <div className="cs-gw-panel">
        <div className="cs-gw-content">
          <img className="cs-gw-logo cs-gw-fade" src="/cs-logo-512-v3.png" alt="" width="512" height="548" />
          <div className="cs-gw-wordmark cs-gw-fade">CALVARY SCRIBBLINGS</div>
          <h1 className="cs-gw-tagline cs-gw-fade">Welcome to the Story Island</h1>

          {/* Item 2 — the epigraph: the rotating whisper, now the foyer's inscription. */}
          {len > 0 && (
            <div className="cs-gw-epigraph cs-gw-fade">
              <div className={`cs-gw-epigraph-layer${active === 'a' ? ' is-lit' : ''}`} aria-hidden={active !== 'a'}>
                <span className="cs-gw-epigraph-quote">{whisperA.quote}</span>
                <span className="cs-gw-epigraph-attr">— {whisperA.title}</span>
              </div>
              <div className={`cs-gw-epigraph-layer${active === 'b' ? ' is-lit' : ''}`} aria-hidden={active !== 'b'}>
                <span className="cs-gw-epigraph-quote">{whisperB.quote}</span>
                <span className="cs-gw-epigraph-attr">— {whisperB.title}</span>
              </div>
            </div>
          )}

          <div className="cs-gw-doors">
            <Link
              className={`cs-gw-door cs-gw-glass${pressed ? ' is-pressed' : ''}${exiting ? ' is-entering' : ''}`}
              href={LIBRARY}
              onClick={(e) => walkThrough(e, LIBRARY)}
            >
              {/* ⁂ renders as stacked asterisks on iOS — retired from the gateway for ✦; it stays
                  in the Voices works list where it renders in context. */}
              <span className="cs-gw-door-glyph" aria-hidden="true">✦</span>
              <span className="cs-gw-door-text">
                <span className="cs-gw-door-title">PUBLIC LIBRARY &amp; OPEN PAGES</span>
                <span className="cs-gw-door-meta">
                  {storyCount > 0 ? `${storyCount} stories · always open` : 'Always open'}
                </span>
                {squareOpen && (
                  <span className="cs-gw-door-square">The Square is open tonight ✦</span>
                )}
              </span>
            </Link>

            <button className="cs-gw-door cs-gw-glass cs-gw-fade" type="button" onClick={() => setModal('store')}>
              <span className="cs-gw-door-glyph" aria-hidden="true">❦</span>
              <span className="cs-gw-door-text">
                <span className="cs-gw-door-title">THE BOOK STORE</span>
                <span className="cs-gw-door-meta cs-gw-opens">{opensLabel}</span>
              </span>
            </button>
          </div>

          <Link className="cs-gw-pill cs-gw-glass cs-gw-fade" href="/ai-policy">
            <span>✦&nbsp;&nbsp;OUR AI POLICY&nbsp;&nbsp;✦</span>
          </Link>

          <div className="cs-gw-small cs-gw-fade">
            <Link href="/voices">Voices of the Island</Link>
            <button type="button" onClick={() => setModal('universe')}>The Calvary Universe</button>
          </div>

          <div className="cs-gw-foot cs-gw-fade">A CALVARY MEDIA UK PUBLICATION</div>

          {/* Real, visible, crawlable prose. The doors and the pill are the navigation —
              deliberately no category link row here. */}
          <div className="cs-gw-seo cs-gw-fade">
            <p>
              Calvary Scribblings publishes original fiction, poetry and essays from a new
              generation of writers. The Public Library is open to everyone — flash fiction,
              short stories, poetry and news, free to read. {BOOKSTORE_OPENS}
            </p>
          </div>
        </div>
      </div>

      {exiting && (
        <div className="cs-gw-veil" aria-hidden="true">
          <div className="cs-gw-hairline" />
        </div>
      )}

      {modal === 'store' && (
        <Modal id="cs-gw-store" titleId="cs-gw-store-title" title="THE BOOK STORE" onClose={closeModal}>
          <p>
            The shelves are being built and the ink is drying.<br />
            <em>The Book Store opens its doors on {LAUNCH_DATE_LABEL}.</em>
          </p>
          <p className="cs-gw-modal-fine">
            Your favourite books, from your favourite authors — human-made, cover to cover.
          </p>
        </Modal>
      )}

      {modal === 'universe' && (
        <Modal id="cs-gw-universe" titleId="cs-gw-universe-title" title="THE CALVARY UNIVERSE" onClose={closeModal} closeLabel="CLOSE">
          {/* You are already here — this row just dismisses the dialog. */}
          <button className="cs-gw-arm cs-gw-arm-link cs-gw-arm-btn" type="button" onClick={closeModal}>
            <div className="cs-gw-arm-glyph" aria-hidden="true">❦</div>
            <div>
              <h3>CALVARY SCRIBBLINGS</h3>
              <p>The Story Island — literary publishing</p>
            </div>
          </button>
          <a className="cs-gw-arm cs-gw-arm-link" href="https://calvaryfilms.co.uk" target="_blank" rel="noopener noreferrer">
            <div className="cs-gw-arm-glyph" aria-hidden="true">✧</div>
            <div>
              <h3>CALVARY FILMS</h3>
              <p>Stories for the screen</p>
            </div>
          </a>
          <div className="cs-gw-arm">
            <div className="cs-gw-arm-glyph" aria-hidden="true">♪</div>
            <div>
              <h3>CALVARY RADIO</h3>
              <p>The island, on air</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
