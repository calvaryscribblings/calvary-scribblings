'use client';
// The four-tab spine of the web platform: ✦ HOME · ⌕ SEARCH · ❖ SQUARE · ❦ MY LIBRARY.
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
// Glass grammar is adopted from the canonical block — app/components/Gateway.js ".cs-gw-glass",
// itself adopted from app/voices/[slug]/page-client.js ".cs-vp-chip": same gradient fill, the
// same blur(14px) saturate(1.35), the same inset highlights, the same @supports solid fallback.
// Do not fork those values here — change them at the canonical site and mirror.
//
// The one deliberate departure: the bar's edge is the hairline gold GRADIENT rule along its top
// (per spec), not the canonical solid 1px rgba(201,168,76,.35) border. That border belongs to
// enclosed glass (doors, chips, pills) and reads as a hard seam on a full-bleed bar; the pills
// on /my-library do carry it verbatim.
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export const TABS = [
  { key: 'home',    href: '/public-library', glyph: '✦', label: 'HOME' },
  { key: 'search',  href: '/search',         glyph: '⌕', label: 'SEARCH' },
  { key: 'square',  href: '/square',         glyph: '❖', label: 'SQUARE' },
  { key: 'library', href: '/my-library',     glyph: '❦', label: 'MY LIBRARY' },
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
  // tick corrects it. A dot that appears a frame late is cheaper than a hydration mismatch.
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

export const TAB_CSS = `
  /* ── mobile bottom bar ───────────────────────────────────────────────── */
  .cs-tabbar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; display: flex;
    height: calc(66px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
    -webkit-backdrop-filter: blur(14px) saturate(1.35);
    backdrop-filter: blur(14px) saturate(1.35);
    box-shadow: inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25);
  }
  @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
    .cs-tabbar { background: rgba(11,7,22,.88); }
  }
  /* surface="light" — for the rare page on a light canvas (the bookstore's pre-launch 404 is
     the only one today). The canonical glass is a translucent fill designed for the night
     canvas; over #faf6ee the cream glyphs and labels wash out entirely. A dark base under the
     same gradient restores contrast without forking the grammar — over a dark page it would be
     indistinguishable. Two classes, so it beats the shorthand above on specificity. */
  .cs-tabbar.cs-tabbar-onlight { background-color: rgba(11,7,22,.94); }
  /* The hairline: a gold gradient rule along the top edge, fading at both ends. */
  .cs-tabbar::before {
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(201,168,76,.45), transparent);
  }
  /* Reserves the bar's height in flow so a page footer is never sat on. Static, so it
     costs no layout shift — it is present from first paint. */
  .cs-tabbar-spacer { height: calc(66px + env(safe-area-inset-bottom)); }

  .cs-tab {
    flex: 1; display: grid; place-items: center; gap: 3px; padding-top: 11px;
    text-decoration: none; -webkit-tap-highlight-color: transparent;
    transition: transform .09s ease;
  }
  .cs-tab:active { transform: scale(.985); }
  .cs-tab-g { font-size: 15px; line-height: 1; color: rgba(245,240,232,.42); }
  .cs-tab-l { font-family: ${CINZEL}; font-size: 7.5px; letter-spacing: .14em; color: rgba(245,240,232,.42); }
  .cs-tab-dot { width: 3px; height: 3px; border-radius: 50%; background: transparent; }
  .cs-tab.is-active .cs-tab-g, .cs-tab.is-active .cs-tab-l { color: #e2c876; }
  .cs-tab.is-active .cs-tab-dot { background: #c9a84c; }
  .cs-tab:focus-visible { outline: 1px solid rgba(226,200,118,.9); outline-offset: -4px; border-radius: 8px; }
  /* The Square's live pulse, kept from the navbar affordance it replaces. */
  .cs-tab-live { position: relative; }
  .cs-tab-live::after {
    content: ""; position: absolute; top: -2px; right: -7px; width: 4px; height: 4px;
    border-radius: 50%; background: #1d9e75; animation: cs-tab-pulse 2s infinite;
  }
  @keyframes cs-tab-pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }

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
  .cs-dtab-g { font-size: 11px; color: rgba(201,168,76,.55); transition: color .2s ease; }
  .cs-dtab.is-active { color: #f5f0e8; border-bottom-color: #c9a84c; }
  .cs-dtab.is-active .cs-dtab-g { color: #e2c876; }
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
    .cs-dtab-g { font-size: 10px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cs-tab, .cs-dtab, .cs-dtab-g { transition: none; }
    .cs-tab:active { transform: none; }
    .cs-tab-live::after { animation: none; }
  }
`;

// Rendered once per mounting component. Two identical <style> blocks on a page that carries
// both renderings is inert duplication, not a conflict.
function TabStyles() {
  return <style>{TAB_CSS}</style>;
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
            <span className={`cs-dtab-g${t.key === 'square' && squareOpen ? ' cs-tab-live' : ''}`} aria-hidden="true">{t.glyph}</span>
            {t.label}
          </a>
        ))}
      </nav>
    </>
  );
}

/**
 * Mobile (<768px) fixed bottom bar, plus the in-flow spacer that reserves its height.
 * `surface="light"` opts into the dark base needed on a light-canvas page.
 */
export default function TabBar({ active, surface }) {
  const pathname = usePathname();
  const current = active ?? activeTabFor(pathname);
  const squareOpen = useSquareOpen();
  return (
    <>
      <TabStyles />
      <div className="cs-tabbar-spacer" aria-hidden="true" />
      <nav className={`cs-tabbar${surface === 'light' ? ' cs-tabbar-onlight' : ''}`} aria-label="Primary">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={t.href}
            className={`cs-tab${current === t.key ? ' is-active' : ''}`}
            aria-current={current === t.key ? 'page' : undefined}
          >
            <span className={`cs-tab-g${t.key === 'square' && squareOpen ? ' cs-tab-live' : ''}`} aria-hidden="true">{t.glyph}</span>
            <span className="cs-tab-l">{t.label}</span>
            <span className="cs-tab-dot" aria-hidden="true" />
          </a>
        ))}
      </nav>
    </>
  );
}
