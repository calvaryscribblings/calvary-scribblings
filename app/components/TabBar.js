'use client';
// The five-tab spine of the web platform: Home · Search · Square · Book Store · My Library.
//
// Two renderings of the same five destinations:
//   <TabBar />   — mobile (<768px) fixed bottom bar.
//   <TabLinks /> — desktop (≥768px) inline row, folded into whatever top chrome a page
//                  already has (Navbar, or a page's own slim sticky nav).
// Both are inert at the other breakpoint, so a surface renders BOTH and each shows up at
// the width it belongs to. Attachment is opt-in per page (the codebase convention — the
// root layout renders no chrome), so the gateway and the reader are excluded BY CONSTRUCTION
// rather than by a pathname denylist that could rot. /bookstore/** was excluded the same way
// until it became a tab of its own; it now mounts the bar in every state — storefront, title
// page and not-found alike.
//
// ── v3: this bar is a REPLICA, not an interpretation ────────────────────────────────────
//
// Two earlier passes dressed the bar in the site's ornamental register — gold hairlines,
// Cinzel micro-caps, a lantern that carried the Square's opening hours, a gold status dot.
// Both were rejected. The direction is now literal: the web bar copies the Story Island
// app's tab bar, so a reader crossing between the two meets the same object.
//
// What that means concretely, and what NOT to reintroduce:
//   · NO GOLD anywhere in this bar. Ground is a near-solid dark neutral (rgba(10,9,14,.97))
//     with a 1px rgba(255,255,255,.06) top border. The self-grounding principle from v2 is
//     kept — the bar owes the page behind it nothing, which is what lets it hold over
//     /search's light canvas — but the night-violet gradient and gold rule are gone.
//   · NO CINZEL. Labels are the system-ui sans stack, sentence case, 11px/500.
//   · NO STATUS INDICATOR on The Square. The app carries none, so neither does this. The
//     hours helpers stay exported below because the navbar's drawer still reads them.
//   · Active state is the app's pill, not a dot: a rounded rect behind the icon, violet
//     fill and border, icon and label going #a78bfa.
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/* ── the icon set ─────────────────────────────────────────────────────────────────────────
   One register across all five, matching the app's: 24×24 box, stroke 1.5, round caps and
   joins, no fill, currentColor throughout — so active/inactive is a single `color` change on
   the anchor and nothing needs a prop.

   The v2 set is retired except for the magnifier, which was the one glyph both rejections
   left standing; it is restroked from 1.4 to 1.5 and rescaled into the 24 box for set
   consistency, but its geometry is unchanged. */

// Shared <svg> chrome. `size` is the only thing that differs between the bar (24) and the
// desktop row (16); the stroke stays 1.5 in USER units, so the 16px rendering thins in
// proportion — which is what keeps the small one from looking like a bolder weight.
function Icon({ size, className, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* HOME — the app's icon: a 2×2 grid of four rounded squares. 8×8 each, radius 2, 2px gutter,
   which totals 18 and centres at x/y = 3. */
function GridIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </Icon>
  );
}

/* SEARCH — carried over from v2 unchanged in character: a light circle and a short handle at
   45°, the handle springing from the circle's edge rather than overlapping it. The spring
   point is exact — 10.5 + 6.5/√2 = 15.1 on both axes. */
function SearchIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.1 15.1 L20.2 20.2" />
    </Icon>
  );
}

/* THE SQUARE — the app's icon: a single thin diamond, i.e. a square rotated 45°, with the
   four points softened to ~1.5 radius.
   Drawn as an explicit path rather than <rect transform="rotate(45)"> because a rotated rect
   with rx renders its corner arcs in the ROTATED frame, and the resulting glyph reads a hair
   heavier on the two horizontal points than the vertical ones at 24px. Here each vertex backs
   off 1.06 units along both incident edges (= 1.5 × cos45) and closes with one quadratic, so
   all four points are identical.
   No lantern, no lit state, no status dot — see the header note. */
function DiamondIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      <path d="M13.06 4.56 L19.44 10.94 Q20.5 12 19.44 13.06 L13.06 19.44 Q12 20.5 10.94 19.44 L4.56 13.06 Q3.5 12 4.56 10.94 L10.94 4.56 Q12 3.5 13.06 4.56 Z" />
    </Icon>
  );
}

/* MY LIBRARY — the 📚 arrangement redrawn in the set's stroke language: three slim upright
   spines and a fourth leaning against the group at 15°.
   The lean is what makes this read as BOOKS rather than as bars. Three equal uprights on a
   common baseline is a bar chart; a volume tipped against them is a shelf, and nothing else.
   Two supporting decisions, both load-bearing at 24px:
     · The spines carry different widths (3.5 / 3.3 / 3.5) and staggered tops on one shared
       baseline at y=20.4. Varied width is a book cue and is NOT a bar-chart cue — bars are
       uniform in width and vary only in height, so varying width breaks the read that
       varying height alone would reinforce.
     · The gutters are 2.0 units. This number was measured, not chosen: at stroke 1.5 the
       strokes claim 0.75 either side, so a gutter leaves (g − 1.5) of daylight. A first pass
       used 1.6 and photographing it at TRUE 1x (not zoomed) showed 0.1 of a pixel at each
       seam — the three spines fused into a picket block. 2.0 leaves 0.5 and they separate.
       Verify this icon at 1x specifically; every problem it has is invisible at 3x.
   The leaner's top-left corner sits 0.75 to the RIGHT of the third spine's right edge, which
   is half a stroke — so the two strokes overlap by 0.75 and read as firm contact. The same
   first pass had them 0.09 apart, i.e. overlapping by 1.4, and the leaner drove a visible X
   through the third spine instead of resting on it. Contact at the top, ~2.4 of clear floor
   at the foot: that pair IS the lean. Without the floor gap it is a fourth upright drawn
   crooked; without the contact it is a separate object falling over on its own. */
function BooksIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      <rect x="1.7" y="6.2" width="3.5" height="14.2" rx="1" />
      <rect x="7.2" y="5.4" width="3.3" height="15" rx="1" />
      <rect x="12.5" y="6.6" width="3.5" height="13.8" rx="1" />
      {/* rotated about its own foot (19.75, 20.4) so the bottom-left corner stays on the
          baseline the three uprights share — a leaning book pivots on that corner */}
      <rect x="19.75" y="8.8" width="2.9" height="11.6" rx="1" transform="rotate(-15 19.75 20.4)" />
    </Icon>
  );
}

/* BOOK STORE — an open book: two upright panels either side of a centre gutter, the gutter
   being the spine. This is the APP'S mark, adopted for parity; a reader crossing between the
   two platforms meets the same object, which is the whole point of the v3 note at the top.
   It replaces a shopfront (canopy over a facade) that lived here from c134b64 to this commit.

   ADOPTING IT MEANT OVERRULING THE SET'S OWN COLLISION RULE, so the rule is restated rather
   than deleted. The retired shopfront's comment argued that the set already owns "books"
   (BooksIcon) and a second book glyph beside it would read as two variants of one destination.
   That argument was and is correct in general — and the app itself never has to face it,
   because the app's bar carries no My Library tab. Ours does, and Book Store sits directly
   beside it. Parity won, but only after the pair was photographed at TRUE 1x at 24, 16 and
   14px, touching, which is a harder adjacency than the bar's 78px cells ever impose.

   WHAT KEEPS THE TWO APART IS WIDTH, NOT COUNT. An 8.4-unit panel is an ENCLOSED AREA; a
   3.3-unit spine is a STROKE. At 14px BooksIcon's four uprights pack into a hatched block and
   its leaner's 15 degree tilt has all but gone, while this reads as two open windows. Two
   panels versus four bars would NOT have been enough on its own — count is the first thing
   the eye loses at 14px. If this glyph is ever narrowed toward BooksIcon's stroke widths, the
   pair collapses into siblings and the shopfront's warning comes true.

   THE GUTTER IS 2.0, WHICH IS THE FILE'S MEASURED MINIMUM, NOT A GUESS. BooksIcon records it
   directly above: at stroke 1.5 the strokes claim 0.75 either side, so a gutter leaves
   (g − 1.5) of daylight; 1.6 was tried there and photographed at TRUE 1x showed 0.1 of a pixel
   at each seam, fusing three spines into a picket block. 2.0 leaves 0.5 and they separate.
   Verified here at 14px, where 0.5 units is only 0.29px — it holds, but there is nothing left
   to give. 2.6 and 3.2 were photographed alongside and are the fallbacks if a future size
   pushes this under; they cost app fidelity, since the app's own gutter is a hairline (~0.6
   units) it can afford because it fills its panels and we stroke ours.

   THE BASELINE IS y=20.4 — BooksIcon's baseline, for the same reason the shopfront used it:
   the two sit adjacent in the bar, and a shared floor is what stops the pair reading as two
   icons hung at two heights.

   NOT PARITY IN TREATMENT, and this is deliberate rather than overlooked. The app FILLS its
   two panels solid; every glyph in this set is fill="none" with a 1.5 stroke. Filling this one
   alone would make it the only solid mark in the bar and would shout beside four outlines.
   The geometry is the app's; the treatment is the set's.
   Decide any change to this at TRUE 1x; every problem it has is invisible at 3x. */
function OpenBookIcon({ size, className }) {
  return (
    <Icon size={size} className={className}>
      {/* left panel 2.6→11.0, gutter 11.0→13.0, right panel 13.0→21.4; both 4.6→20.4 */}
      <rect x="2.6" y="4.6" width="8.4" height="15.8" rx="2" />
      <rect x="13" y="4.6" width="8.4" height="15.8" rx="2" />
    </Icon>
  );
}

// Order matches the app's bar exactly: Home · Search · Square · Book Store · My Library.
// Store sits between Square and Library because that is where the app puts it, not because
// anything here needs it there.
//
// LABELS ARE THE APP'S LABELS. "Square", not "The Square" — the tab is a destination name in
// an 11px cell, and the app drops the article there while the Square's own page keeps its full
// name in its headline. The place is still The Square everywhere it is spoken about; this is
// the one register where it is not.
export const TABS = [
  { key: 'home',    href: '/public-library', Icon: GridIcon,     label: 'Home' },
  { key: 'search',  href: '/search',         Icon: SearchIcon,   label: 'Search' },
  { key: 'square',  href: '/square',         Icon: DiamondIcon,  label: 'Square' },
  { key: 'store',   href: '/bookstore',      Icon: OpenBookIcon, label: 'Book Store' },
  { key: 'library', href: '/my-library',     Icon: BooksIcon,    label: 'My Library' },
];

// The category pages are children of HOME — landing on /flash should still light Home, not
// leave the bar with nothing active.
const HOME_ROUTES = ['/public-library', '/flash', '/short', '/serial', '/poetry', '/news', '/inspiring'];

export function activeTabFor(pathname) {
  if (!pathname) return null;
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/search') return 'search';
  if (p === '/square' || p.startsWith('/square/')) return 'square';
  // Every title page is a child of the storefront, so /bookstore/basil lights Book Store —
  // and so does /bookstore/<nonsense>, which renders not-found.js with the bar still on it.
  if (p === '/bookstore' || p.startsWith('/bookstore/')) return 'store';
  if (p === '/my-library' || p.startsWith('/my-library/')) return 'library';
  if (HOME_ROUTES.includes(p)) return 'home';
  return null;
}

// The Square's doors open 20:00–24:00 LONDON, which is what the Square itself and the gateway
// both read (app/square/page.js, app/components/Gateway.js londonHour). The TAB no longer
// shows this — the app's bar carries no status on that tab, so neither does ours — but the
// navbar's drawer still renders an open/closed row and imports from here so both readings of
// the clock stay in one place.
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
  // tick corrects it.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const tick = () => setOpen(isSquareOpenLondon());
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);
  return open;
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const VIOLET = '#a78bfa';
const PILL_FILL = 'rgba(91,43,160,.35)';
const PILL_EDGE = 'rgba(139,92,246,.45)';
const DIM = 'rgba(245,240,232,.55)';

export const TAB_CSS = `
  /* ── mobile bottom bar ───────────────────────────────────────────────── */
  /* Self-grounded, but NEUTRAL: near-solid dark, no gradient, no gold. At .97 alpha the fill
     carries the bar over any canvas on its own — verified over /public-library (night) and
     /search (light). The blur is enrichment only; nothing about legibility depends on it. */
  .cs-tabbar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; display: flex;
    height: calc(64px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: rgba(10,9,14,.97);
    border-top: 1px solid rgba(255,255,255,.06);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    backdrop-filter: blur(14px) saturate(1.2);
  }
  @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
    .cs-tabbar { background: rgba(10,9,14,.99); }
  }
  /* Reserves the bar's height in flow so a page footer is never sat on. Static, so it
     costs no layout shift — it is present from first paint. The extra 1px matches the
     border-top, which sits outside the 64px box. */
  .cs-tabbar-spacer { height: calc(65px + env(safe-area-inset-bottom)); }

  .cs-tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-decoration: none; -webkit-tap-highlight-color: transparent;
    color: ${DIM};
    transition: color .18s ease;
  }
  /* The pill is ALWAYS in the layout at full size with a transparent 1px border, and only its
     paint changes on activation. Sizing or bordering it only when active would shift the icon
     and the label by a pixel every time the route changes. */
  .cs-tab-pill {
    display: flex; align-items: center; justify-content: center;
    width: 44px; height: 30px; border-radius: 10px;
    background: transparent; border: 1px solid transparent;
    transition: background .18s ease, border-color .18s ease, transform .09s ease;
  }
  .cs-tab:active .cs-tab-pill { transform: scale(.97); }
  .cs-tab-ico { display: block; }
  .cs-tab-l {
    font-family: ${SANS}; font-size: 11px; font-weight: 500; letter-spacing: .01em;
    line-height: 1; margin-top: 3px; color: inherit;
  }
  .cs-tab.is-active { color: ${VIOLET}; }
  .cs-tab.is-active .cs-tab-pill { background: ${PILL_FILL}; border-color: ${PILL_EDGE}; }
  .cs-tab:focus-visible { outline: 1px solid ${PILL_EDGE}; outline-offset: -4px; border-radius: 8px; }

  /* ── desktop inline row ──────────────────────────────────────────────── */
  /* Same icons, same labels, same pill — laid out horizontally and shrunk to sit inside the
     navbar's 68px band. The pill wraps icon AND label here rather than the icon alone, because
     a 44×30 icon-only pill with the label beside it would read as a badge stuck to the text;
     wrapping both is what the row's horizontal arrangement asks for and lands at ~28px tall,
     which the navbar clears comfortably. (A 2px violet underline was the alternative — it fits
     too, but it re-imports the "tab underline" idiom the app's bar doesn't use.) */
  /* NOTE: no backticks anywhere in this block — it is a JS template literal.
     Every desktop rule is scoped ".cs-dtabs a.cs-dtab" rather than the bare ".cs-dtab".
     This is not tidiness — the row is dropped into chrome it does not own, and the Navbar
     styles its own contents with ".cs-desktop-links a { font-size: .82rem; color: … }"
     (Navbar.js). That descendant selector outranks a lone class, so an unscoped ".cs-dtab"
     silently lost its size and its inactive colour while ".cs-dtab.is-active" won — the row
     came out at 13.12px with white-75 inactive labels and only the active one obeying spec.
     Scoping puts the row above any single-class-plus-element host rule, so it renders the
     same in the Navbar, in a page's own sticky nav, and anywhere it lands next. */
  .cs-dtabs { display: none; align-items: center; gap: 6px; }
  .cs-dtabs a.cs-dtab {
    display: flex; align-items: center; gap: 7px; white-space: nowrap; text-decoration: none;
    font-family: ${SANS}; font-size: 12px; font-weight: 500; letter-spacing: .01em; line-height: 1;
    color: ${DIM}; padding: 5px 10px; border-radius: 8px;
    background: transparent; border: 1px solid transparent;
    transition: color .2s ease, background .2s ease, border-color .2s ease;
  }
  .cs-dtabs a.cs-dtab:hover { color: rgba(245,240,232,.85); }
  /* The icon inherits the label's colour here — one violet, one dim, no second relationship
     to keep in sync. */
  .cs-dtabs .cs-dtab-ico { flex: none; }
  .cs-dtabs a.cs-dtab.is-active { color: ${VIOLET}; background: ${PILL_FILL}; border-color: ${PILL_EDGE}; }
  .cs-dtabs a.cs-dtab:focus-visible { outline: 1px solid ${PILL_EDGE}; outline-offset: 2px; }

  @media (min-width: 768px) {
    .cs-tabbar, .cs-tabbar-spacer { display: none; }
    .cs-dtabs { display: flex; }
  }
  /* The row has to share a 768px-wide bar with a wordmark, an avatar and a hamburger in the
     tablet band, so it tightens twice on the way down rather than pushing anything off-edge. */
  @media (max-width: 1100px) { .cs-dtabs { gap: 2px; } .cs-dtabs a.cs-dtab { padding: 5px 8px; gap: 6px; } }
  @media (max-width: 940px) {
    .cs-dtabs { gap: 0; }
    .cs-dtabs a.cs-dtab { font-size: 11px; padding: 5px 6px; gap: 5px; }
    .cs-dtabs .cs-dtab-ico { width: 14px; height: 14px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cs-tab, .cs-tab-pill, .cs-dtabs a.cs-dtab { transition: none; }
    .cs-tab:active .cs-tab-pill { transform: none; }
  }
`;

// Rendered once per mounting component. Two identical <style> blocks on a page that carries
// both renderings is inert duplication.
function TabStyles() {
  return <style>{TAB_CSS}</style>;
}

/** Desktop (≥768px) inline tab row — drops into a page's existing top chrome. */
export function TabLinks({ active }) {
  const pathname = usePathname();
  const current = active ?? activeTabFor(pathname);
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
            <t.Icon size={16} className="cs-dtab-ico" />
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
            <span className="cs-tab-pill">
              <t.Icon size={24} className="cs-tab-ico" />
            </span>
            <span className="cs-tab-l">{t.label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
