'use client';
// The four-tab spine of the web platform: HOME · SEARCH · SQUARE · MY LIBRARY.
//
// Two renderings of the same four destinations:
//   <TabBar />   — mobile (<768px) fixed bottom bar, the round's centerpiece.
//   <TabLinks /> — desktop (≥768px) inline row, folded into whatever top chrome a page
//                  already has (Navbar, or a page's own slim sticky nav).
// Both are inert at the other breakpoint, so a surface renders BOTH and each shows up at
// the width it belongs to. Attachment is opt-in per page (the codebase convention — the
// root layout renders no chrome), so the gateway, the reader and /bookstore/** are excluded
// BY CONSTRUCTION rather than by a pathname denylist that could rot.
//
// ── Two things the first shipped bar got wrong, and what replaced them ──────────────────
//
// 1. IT BORROWED ITS GROUND FROM THE PAGE. The canonical glass (Gateway.js ".cs-gw-glass")
//    is a translucent CREAM-over-VIOLET fill that only reads as an object when a night
//    canvas sits behind it. Over /search's light canvas the bar dissolved. A `surface="light"`
//    prop patched the one page we knew about, which is the wrong shape of fix — it makes
//    every future light surface a bug waiting to be filed.
//    The bar is now SELF-GROUNDED: it carries its own opaque-enough night gradient and owes
//    the page behind it nothing. The blur stays live underneath (it still refracts what
//    scrolls past, which is the point of glass), but legibility no longer depends on it.
//    This is a deliberate DEPARTURE from the canonical block, not a drift from it — the
//    canonical values still govern enclosed glass (doors, chips, the /my-library pills).
//
// 2. IT DREW ITS ICONS WITH UNICODE. ✦ ⌕ ❖ ❦ are typographic ornaments on a desktop font
//    stack, but iOS Safari has no thin glyph for several of them and substitutes from Apple
//    Color Emoji — the bar came out wearing chunky dingbats at emoji weight, nothing like
//    the Cormorant hairline register the rest of the site is set in. Every icon is now an
//    inline stroke SVG (22×22 viewBox, stroke-width 1.4, round caps, currentColor), so the
//    weight is OURS and font substitution is structurally impossible.
//    Three of the four keep their character (star, magnifier, and the ❖ Square promoted into
//    a lantern that carries the opening hours). The fourth, ❦, could not be redrawn at 22px
//    without reading as a heart — see BookIcon for why, and for what replaced it.
//
// The bar's top edge is a hairline gold GRADIENT rule, not the canonical solid
// 1px rgba(201,168,76,.35) border — that border belongs to enclosed glass and reads as a
// hard seam on a full-bleed bar.
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/* ── the icon set ─────────────────────────────────────────────────────────────────────────
   All four share one register: 22×22 box, stroke 1.4, round caps and joins, no fill unless
   a state asks for one, and enough interior air that they stay open at 22px. The paths are
   hand-plotted rather than lifted from an icon library on purpose — Material/Feather/Lucide
   all sit at a heavier optical weight than the site's type, and the mismatch shows when an
   icon sits 4px above a Cinzel label.

   Colour comes from `currentColor` in every case, so active/inactive is one `color` change
   on the anchor. The two exceptions — HOME's active fill and the lit lantern flame — pull
   the shared gold gradient below, and are switched by CSS, not by props. */

// Referenced by <TabIconDefs />, which every mounting component renders. A page carrying
// both the bar and the desktop row emits it twice; duplicate IDs resolve to the first and
// the two are byte-identical, so this is inert duplication rather than a conflict (same
// bargain as the duplicated <style> block below).
const GOLD_GRADIENT_ID = 'cs-tab-gold';

function TabIconDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id={GOLD_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2e0ae" stopOpacity="0.62" />
          <stop offset="1" stopColor="#c9a84c" stopOpacity="0.9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Shared <svg> chrome. `size` is the only thing that differs between the bar (22) and the
// desktop row (14); the stroke stays 1.4 in USER units, so the 14px rendering thins in
// proportion — which is what keeps the small one from looking like a bolder weight.
function Icon({ size, className, children }) {
  return (
    <svg
      viewBox="0 0 22 22"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* HOME — the house's ✦ drawn properly: a four-point star with the vertical points carried
   longer than the horizontal ones (19.4 units tall, 15.6 wide) and the waists between points
   pulled hard in toward the centre so the arms taper to needles.
   That concavity is the whole difference between a star and a rhombus, and it is the one
   number here worth understanding: each quadrant is a quadratic whose control point sits at
   (11 ± 0.8, 11 ∓ 0.8) — 1.1 units off centre. A first pass used ±1.4/2.6 and the result read
   as a bevelled diamond, because a control point that far out barely bends the chord. */
function StarIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      <path
        className="cs-ico-star"
        d="M11 1.3 Q11.8 10.2 18.8 11 Q11.8 11.8 11 20.7 Q10.2 11.8 3.2 11 Q10.2 10.2 11 1.3 Z"
      />
    </Icon>
  );
}

/* SEARCH — the one glyph that was already right (⌕ has a thin stroke on every stack we hit),
   so this keeps its character exactly: a light circle and a short handle held at 45°, the
   handle springing from the circle's edge rather than overlapping it. */
function SearchIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      <circle cx="9.5" cy="9.5" r="6.1" />
      <path d="M13.9 13.9 L18.6 18.6" />
    </Icon>
  );
}

/* SQUARE — a lantern, and the lantern IS the status.
   Between 20:00 and 24:00 London the flame fills gold and gains a soft 2px glow; the rest of
   the day it is stroke-only and unlit. The old detached green pulse dot is gone — green is
   off-palette, and a 4px circle floating clear of the glyph read as a rendering fault rather
   than an affordance.
   Built as FIVE separate strokes — bail, top plate, two flaring housing sides, base plate —
   rather than one closed body outline. That matters: the first pass drew a single
   rounded-shoulder body and it read as a BOTTLE, with the flame inside it as a drop of
   liquid. What makes a lantern legible at 22px is the two horizontal plates being visibly
   WIDER (9.2 units) than the glass between them (8.0), so the silhouette steps in and back
   out. The housing sides are left open at both ends; the plates close them. */
function LanternIcon({ size, className, lit }) {
  return (
    <Icon size={size} className={`${className}${lit ? ' is-lit' : ''}`}>
      {/* bail */}
      <path d="M9.1 4.2 Q9.1 1.8 11 1.8 Q12.9 1.8 12.9 4.2" />
      {/* top plate */}
      <path d="M6.4 5.4 H15.6" />
      {/* housing — left side, then right */}
      <path d="M8.2 5.4 C7.3 7.3 7 8.7 7 10.4 V16.6" />
      <path d="M15 16.6 V10.4 C15 8.7 14.7 7.3 13.8 5.4" />
      {/* base plate */}
      <path d="M6.4 16.6 H15.6" />
      {/* Flame, at 1.15 rather than the set's 1.4. It is only 3.4 units across — at 1.4 the
          two sides of the outline meet and the unlit state fills in solid, which reads as
          permanently lit and destroys the whole status signal. */}
      <path
        className="cs-ico-flame"
        strokeWidth="1.15"
        d="M11 9.4 C12.3 10.9 12.7 11.7 12.7 12.6 C12.7 13.8 12 14.6 11 14.6 C10 14.6 9.3 13.8 9.3 12.6 C9.3 11.7 9.7 10.9 11 9.4 Z"
      />
    </Icon>
  );
}

/* MY LIBRARY — an open book with a ribbon marker. THIS IS THE FALLBACK, not the ❦ fleuron
   the brief asked for first, and the reason is worth recording so nobody re-litigates it.
   The fleuron WAS drawn as a path (Aldus-leaf heart, midrib, curling stem) and photographed
   at 22px alongside three variants. It failed, in two ways that no amount of nudging fixed:
     · The two marks that make an Aldus leaf an Aldus leaf rather than a heart — the midrib
       and the stem curl — are collinear at the bottom of the shape. At 22px with a 1.4
       stroke they merge into one vertical bar through the middle, and the glyph reads as a
       lowercase phi. Dropping the midrib fixes the merge and leaves a plain heart.
     · A plain heart in a MY LIBRARY tab is not neutral — it reads "favourites", and the site
       already spends the heart on liking a story. Wrong word, in the one place a tab bar
       cannot afford one.
   The book is the same stroke language (1.4, round caps, currentColor), reads instantly at
   both 22px and the desktop row's 14px, and says "library" without borrowing another
   affordance's meaning. The ❦ survives everywhere it was already working — the gateway's
   Library door and its arm still carry it at 32px and 20px, where it is glorious. */
function BookIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      {/* two facing pages */}
      <path d="M11 6.6 C9.3 5.3 7.3 4.7 4.6 4.7 V15.7 C7.3 15.7 9.3 16.3 11 17.6 C12.7 16.3 14.7 15.7 17.4 15.7 V4.7 C14.7 4.7 12.7 5.3 11 6.6 Z" />
      {/* spine */}
      <path d="M11 6.6 V17.6" />
      {/* ribbon marker, notched at the tail */}
      <path d="M14.3 5 V10.4 L15.6 9.2 L16.9 10.4 V4.8" />
    </Icon>
  );
}

export const TABS = [
  { key: 'home',    href: '/public-library', Icon: StarIcon,    label: 'HOME' },
  { key: 'search',  href: '/search',         Icon: SearchIcon,  label: 'SEARCH' },
  { key: 'square',  href: '/square',         Icon: LanternIcon, label: 'SQUARE' },
  { key: 'library', href: '/my-library',     Icon: BookIcon,    label: 'MY LIBRARY' },
];

// The category pages are children of HOME — landing on /flash should still light HOME, not
// leave the bar with nothing active.
const HOME_ROUTES = ['/public-library', '/flash', '/short', '/serial', '/poetry', '/news', '/inspiring'];

export function activeTabFor(pathname) {
  if (!pathname) return null;
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/search') return 'search';
  if (p === '/square' || p.startsWith('/square/')) return 'square';
  if (p === '/my-library' || p.startsWith('/my-library/')) return 'library';
  if (HOME_ROUTES.includes(p)) return 'home';
  return null;
}

// The Square's doors open 20:00–24:00 LONDON, which is what the Square itself and the gateway
// both read (app/square/page.js:35, app/components/Gateway.js londonHour). Exported so the
// navbar's drawer reads the same clock as the tab beside it.
export function isSquareOpenLondon() {
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(new Date())
    );
    return (h === 24 ? 0 : h) >= 20;
  } catch {
    return false;
  }
}

export function useSquareOpen() {
  // Server render is always "closed" so the markup matches on hydration; the first effect
  // tick corrects it. A lantern that lights a frame late is cheaper than a hydration
  // mismatch — and unlike the dot it replaced, nothing moves when it does.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const tick = () => setOpen(isSquareOpenLondon());
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);
  return open;
}

const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const GOLD = '#e2c876';

export const TAB_CSS = `
  /* ── mobile bottom bar ───────────────────────────────────────────────── */
  /* Self-grounded: the gradient is opaque enough to carry the bar over ANY canvas, and the
     blur underneath is now enrichment rather than load-bearing. Verified over
     /public-library (night) and /search (light) — the same object on both. */
  .cs-tabbar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; display: flex;
    height: calc(64px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: linear-gradient(180deg, rgba(16,10,32,.90), rgba(11,7,22,.96));
    -webkit-backdrop-filter: blur(14px) saturate(1.35);
    backdrop-filter: blur(14px) saturate(1.35);
  }
  @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
    /* No blur to darken what's behind, so the fill takes the last of the way to solid. */
    .cs-tabbar { background: rgba(11,7,22,.97); }
  }
  /* Top edge, in two 1px rows: the gold hairline, then the highlight that gives the glass
     its thickness. Two pseudo-elements rather than one rule plus an inset box-shadow —
     an inset shadow paints the same row the ::before covers, so it would be invisible. */
  .cs-tabbar::before, .cs-tabbar::after {
    content: ""; position: absolute; left: 0; right: 0; height: 1px; pointer-events: none;
  }
  .cs-tabbar::before {
    top: 0; background: linear-gradient(90deg, transparent, rgba(201,168,76,.55), transparent);
  }
  .cs-tabbar::after { top: 1px; background: rgba(245,240,232,.06); }
  /* Reserves the bar's height in flow so a page footer is never sat on. Static, so it
     costs no layout shift — it is present from first paint. */
  .cs-tabbar-spacer { height: calc(64px + env(safe-area-inset-bottom)); }

  /* The vertical gaps are set as margins, NOT as a flex gap shorthand. A gap applies between
     every pair of children, so it would stack with the dot's own offset and the dot would sit
     4+3=7px under the label instead of the 3 it wants. Margins keep each gap independent.
     (Careful with backticks anywhere in this block — it is a JS template literal.) */
  .cs-tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-decoration: none; -webkit-tap-highlight-color: transparent;
    color: rgba(245,240,232,.5);
    transition: color .18s ease, transform .09s ease;
  }
  .cs-tab:active { transform: scale(.985); }
  .cs-tab-ico { display: block; }
  /* Letter-spacing hangs a trailing gap off the last character, which drags centred text
     visually left by half of it. Half an em back the other way squares it up. */
  .cs-tab-l {
    font-family: ${CINZEL}; font-size: 7px; letter-spacing: .18em; line-height: 1;
    margin: 4px 0 0 .18em; color: inherit;
  }
  /* Always in the layout, transparent until active — the dot appearing must not shift the
     label. 3px beneath it, docked to the label rather than floating off the bar's floor. */
  .cs-tab-dot {
    width: 3px; height: 3px; margin-top: 3px; border-radius: 50%;
    background: transparent; transition: background .18s ease;
  }
  .cs-tab.is-active { color: ${GOLD}; }
  .cs-tab.is-active .cs-tab-dot { background: ${GOLD}; }
  .cs-tab:focus-visible { outline: 1px solid rgba(226,200,118,.9); outline-offset: -4px; border-radius: 8px; }

  /* ── the two icon states that aren't just a colour ───────────────────── */
  /* HOME fills when active. The gradient runs under the stroke, so the star keeps its drawn
     edge and gains a body rather than turning into a solid blob.
     fill-opacity trims it to ~64% of the gradient's own alpha, which is what "subtle" costs:
     at full strength the star reads as a solid gold lozenge and the drawn edge disappears
     into it. One gradient serves both this and the lit flame, which wants full strength —
     the difference is here, not in a second def. */
  .cs-tab.is-active .cs-ico-star, .cs-dtab.is-active .cs-ico-star {
    fill: url(#${GOLD_GRADIENT_ID}); fill-opacity: .64;
  }
  /* The lantern's flame carries the Square's hours. Independent of active state — the Square
     is open at 8pm whether or not you are standing in it. */
  .cs-ico-flame { transition: fill .3s ease, stroke .3s ease; }
  .is-lit .cs-ico-flame {
    fill: url(#${GOLD_GRADIENT_ID}); stroke: ${GOLD};
    filter: drop-shadow(0 0 2px rgba(226,200,118,.75));
  }

  /* ── desktop inline row ──────────────────────────────────────────────── */
  .cs-dtabs { display: none; align-items: center; gap: 24px; }
  .cs-dtab {
    display: flex; align-items: center; gap: 7px; white-space: nowrap; text-decoration: none;
    font-family: ${CINZEL}; font-size: 9.5px; letter-spacing: .2em;
    color: rgba(245,240,232,.45); padding-bottom: 5px;
    border-bottom: 1px solid transparent;
    transition: color .2s ease, border-color .2s ease;
  }
  .cs-dtab:hover { color: rgba(245,240,232,.78); }
  /* The icon runs gold-at-half rather than inheriting the label's cream, which is the
     relationship the row had when it was Unicode. It does NOT inherit the label's color —
     the label lightening on hover shouldn't drag the icon with it. */
  .cs-dtab-ico { flex: none; color: rgba(201,168,76,.55); transition: color .2s ease; }
  .cs-dtab.is-active { color: #f5f0e8; border-bottom-color: #c9a84c; }
  .cs-dtab.is-active .cs-dtab-ico { color: ${GOLD}; }
  .cs-dtab:focus-visible { outline: 1px solid rgba(226,200,118,.9); outline-offset: 4px; border-radius: 3px; }

  @media (min-width: 768px) {
    .cs-tabbar, .cs-tabbar-spacer { display: none; }
    .cs-dtabs { display: flex; }
  }
  /* The row has to share a 768px-wide bar with a wordmark, an avatar and a hamburger in the
     tablet band, so it tightens twice on the way down rather than pushing anything off-edge. */
  @media (max-width: 1100px) { .cs-dtabs { gap: 15px; } }
  @media (max-width: 940px) {
    .cs-dtabs { gap: 11px; }
    .cs-dtab { font-size: 8.5px; letter-spacing: .13em; gap: 5px; }
    .cs-dtab-ico { width: 13px; height: 13px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cs-tab, .cs-tab-dot, .cs-dtab, .cs-dtab-ico, .cs-ico-flame { transition: none; }
    .cs-tab:active { transform: none; }
    /* The glow is a static filter, never animated — so the lit lantern is unchanged here,
       it simply stops crossfading into lit. */
  }
`;

// Rendered once per mounting component. Two identical <style> blocks (and two identical
// gradient defs) on a page that carries both renderings is inert duplication.
function TabStyles() {
  return (
    <>
      <style>{TAB_CSS}</style>
      <TabIconDefs />
    </>
  );
}

/** Desktop (≥768px) inline tab row — drops into a page's existing top chrome. */
export function TabLinks({ active }) {
  const pathname = usePathname();
  const current = active ?? activeTabFor(pathname);
  const squareOpen = useSquareOpen();
  return (
    <>
      <TabStyles />
      <nav className="cs-dtabs" aria-label="Primary">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={t.href}
            className={`cs-dtab${current === t.key ? ' is-active' : ''}`}
            aria-current={current === t.key ? 'page' : undefined}
          >
            <t.Icon size={14} className="cs-dtab-ico" lit={t.key === 'square' && squareOpen} />
            {t.label}
          </a>
        ))}
      </nav>
    </>
  );
}

/** Mobile (<768px) fixed bottom bar, plus the in-flow spacer that reserves its height. */
export default function TabBar({ active }) {
  const pathname = usePathname();
  const current = active ?? activeTabFor(pathname);
  const squareOpen = useSquareOpen();
  return (
    <>
      <TabStyles />
      <div className="cs-tabbar-spacer" aria-hidden="true" />
      <nav className="cs-tabbar" aria-label="Primary">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={t.href}
            className={`cs-tab${current === t.key ? ' is-active' : ''}`}
            aria-current={current === t.key ? 'page' : undefined}
          >
            <t.Icon size={22} className="cs-tab-ico" lit={t.key === 'square' && squareOpen} />
            <span className="cs-tab-l">{t.label}</span>
            <span className="cs-tab-dot" aria-hidden="true" />
          </a>
        ))}
      </nav>
    </>
  );
}
