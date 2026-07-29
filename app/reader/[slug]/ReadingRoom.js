'use client';
// ─────────────────────────────────────────────────────────────────────────────
// THE READING ROOM — the ONE reader surface (R7.1).
//
// Both doors open onto this component:
//   register 'story' → app/reader/[slug]/page-reader.js  (cms_stories, free)
//   register 'book'  → app/reader/[slug]/book-reader.js  (bookstore sample + purchased)
//
// It owns everything that is the same on every register: the iframe and the SINGLE
// src builder, the paper map, the top chrome, the footer + gold thread, the Contents /
// Search / Typesetter panels, the ribbon tab, the full postMessage bridge to
// public/reading-room.html, and the chrome vanish mechanics.
//
// It owns NO product policy. Read counters, streaks, quizzes, comments, entitlement and
// purchase state all live in the two adapters. What a register gets is decided by props,
// never by a branch on `register` inside a feature — the only thing `register` itself
// changes is which defaults an adapter passes in.
//
// R7.1 kills, by construction:
//   • the second src builder + duplicate paper map that lived in book-reader.js
//   • the hardcoded #1a0f0a night bar on the bookstore paths — chrome colour now derives
//     from the active paper on every register (the pr:976-979 pattern)
//   • the two frame geometries — the ribbon lane + thread inset is now the one geometry
//
// WALLS (R7.0 §7) that this file is responsible for. Each is annotated at its site:
//   §7.5  origin-locked postMessage in both directions
//   §7.7  the iframe box IS the paginator's layout box — nothing overlays or insets it
//   §7.10 iframe stability: src built ONCE from initial prefs; live changes by message
//   §7.11 frame()/shell() are not components — here: nothing that wraps the iframe is
//         declared inside the render body
//   §7.12 prefs captured once into a ref; `prefs` state never reaches the src
//   §7.14 the ready-gated goTo queue is the host's; we only post into it
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

// Dynamic, exactly as the reader route has always done it: firebase/database must not
// land in this route's initial chunk. getApps() shares the singleton, so no double-init.
async function getDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const app = getApps().length ? getApps()[0] : initializeApp(FB);
  const { getDatabase } = await import('firebase/database');
  return getDatabase(app);
}

// A local copy of ConversationKit's formatter, used only for the ribbon timestamps.
// Importing it would pull the comment-thread presentation module into the PURCHASED-BOOK
// bundle, which is a coupling worth more than nine duplicated lines.
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── The paper map. ONE copy, for every register. ──────────────────────────────
export const PAPERS = {
  vellum: { label: 'Vellum', bg: '#f2ecd9', fg: '#2b2418' },
  ivory: { label: 'Ivory', bg: '#faf7f0', fg: '#1f1c16' },
  dusk: { label: 'Dusk', bg: '#211d16', fg: '#ddd2b8' },
  ink: { label: 'Ink', bg: '#0a0a0a', fg: '#d9d2bf' },
};
const PAPER_ORDER = ['vellum', 'ivory', 'dusk', 'ink'];
const FACES = {
  cormorant: { label: 'Cormorant', css: "'Cormorant Garamond', Georgia, serif" },
  literata: { label: 'Literata', css: "'Literata', Georgia, serif" },
  inter: { label: 'Inter', css: "'Inter', system-ui, sans-serif" },
};
const FACE_ORDER = ['cormorant', 'literata', 'inter'];
const SIZE_MIN = 70, SIZE_MAX = 180, SIZE_STEP = 10;
const LEAD_MIN = 1.3, LEAD_MAX = 2.2, LEAD_STEP = 0.08;
const DEFAULT_PREFS = { paper: 'vellum', face: 'cormorant', sizePct: 100, leading: 1.6, flow: 'paginated' };
const PREFS_KEY = 'readingRoom.prefs';
const CHROME_IDLE_MS = 3500;

export function loadPrefs() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {} }
function clampLeading(v) { return Math.min(LEAD_MAX, Math.max(LEAD_MIN, Math.round(v * 100) / 100)); }
function stylesMsg(p) {
  const paper = PAPERS[p.paper] || PAPERS.vellum;
  return { type: 'applyStyles', bg: paper.bg, fg: paper.fg, face: p.face, sizePct: p.sizePct, leading: p.leading, justify: true };
}

// ── THE src builder. There is exactly one. ────────────────────────────────────
// R7.0 §9 recorded two of these — page-reader.js:438 and book-reader.js:36 — with their
// own copies of the paper map, so a typography fix could land on one path and miss the
// other. Everything now goes through here.
export function readingRoomSrc(epubUrl, p) {
  const paper = PAPERS[p.paper] || PAPERS.vellum;
  const qs = new URLSearchParams({
    url: epubUrl, bg: paper.bg, fg: paper.fg, face: p.face,
    size: String(p.sizePct), leading: String(p.leading), flow: p.flow,
  });
  return '/reading-room.html?' + qs.toString();
}

// ── THE RIBBON PRINCIPLE (R7.2) ───────────────────────────────────────────────
// The tab is not a button that adds things — it IS the current page's bookmark state.
// Deciding whether a stored ribbon belongs to the page in front of the reader is a
// fraction-proximity test, because a CFI cannot be compared for "same page": pagination
// depends on the reader's type size, leading, flow and screen, so the same CFI lands on a
// different page for a different reader — and for the same reader after a Typesetter tap.
//
// THE RULE. pageSpan is the host's minStep: the smallest forward fraction step it has
// observed, i.e. one page as a fraction of the whole book. A ribbon is on the current page
// when |ribbon.fraction − currentFraction| < pageSpan / 2. Half a page either side of the
// reader's position is exactly the span the current page occupies, so the neighbouring
// pages — a full pageSpan away — can never match, and no page can match two ribbons.
// Before the first forward turn pageSpan is 0, so a floor of 0.2% of the book stands in;
// on a 300-page book that is well under one page, which errs toward "no ribbon here" —
// the safe direction, since the cost is a duplicate the dedupe still catches on write.
//
// Legacy records (R4a-era, cfi + label only) carry no fraction and therefore never match.
// They render in the Contents list and jump correctly; they simply cannot light the tab.
const RIBBON_MIN_SPAN = 0.002;
export function ribbonEpsilonFor(pageSpan) {
  return Math.max(typeof pageSpan === 'number' ? pageSpan : 0, RIBBON_MIN_SPAN) / 2;
}
export function findRibbonOnPage(list, fraction, pageSpan) {
  if (!Array.isArray(list) || typeof fraction !== 'number') return null;
  const eps = ribbonEpsilonFor(pageSpan);
  let best = null;
  let bestD = Infinity;
  for (const r of list) {
    if (!r || typeof r.fraction !== 'number') continue;
    const d = Math.abs(r.fraction - fraction);
    if (d < eps && d < bestD) { best = r; bestD = d; }
  }
  return best;
}

// ── Typesetter ────────────────────────────────────────────────────────────────
function TypesetterPanel({ prefs, onPaper, onFace, onSize, onLeading, onFlow, onClose }) {
  return (
    <div className="rr-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rr-sheet" role="dialog" aria-label="The Typesetter">
        <div className="rr-grab" />
        <div className="rr-sheet-title">&#10086; The Typesetter</div>

        <div className="rr-row-label">Paper</div>
        <div className="rr-swatches">
          {PAPER_ORDER.map((k) => (
            <button key={k} className={'rr-swatch' + (prefs.paper === k ? ' active' : '')} onClick={() => onPaper(k)} aria-label={PAPERS[k].label}>
              <span className="rr-swatch-page" style={{ background: PAPERS[k].bg, color: PAPERS[k].fg }}>Aa</span>
              <span className="rr-swatch-name">{PAPERS[k].label}</span>
            </button>
          ))}
        </div>

        <div className="rr-row-label">Typeface</div>
        <div className="rr-faces">
          {FACE_ORDER.map((k) => (
            <button key={k} className={'rr-face' + (prefs.face === k ? ' active' : '')} onClick={() => onFace(k)} style={{ fontFamily: FACES[k].css }}>{FACES[k].label}</button>
          ))}
        </div>

        <div className="rr-stepper-row">
          <span className="rr-row-label">Size</span>
          <div className="rr-stepper">
            <button className="rr-step" onClick={() => onSize(-SIZE_STEP)} disabled={prefs.sizePct <= SIZE_MIN} aria-label="Smaller">&minus;</button>
            <span className="rr-step-val">{prefs.sizePct}%</span>
            <button className="rr-step" onClick={() => onSize(SIZE_STEP)} disabled={prefs.sizePct >= SIZE_MAX} aria-label="Larger">+</button>
          </div>
        </div>

        <div className="rr-stepper-row">
          <span className="rr-row-label">Leading</span>
          <div className="rr-stepper">
            <button className="rr-step" onClick={() => onLeading(-LEAD_STEP)} disabled={prefs.leading <= LEAD_MIN} aria-label="Tighter">&minus;</button>
            <span className="rr-step-val">{prefs.leading.toFixed(2)}</span>
            <button className="rr-step" onClick={() => onLeading(LEAD_STEP)} disabled={prefs.leading >= LEAD_MAX} aria-label="Looser">+</button>
          </div>
        </div>

        <div className="rr-stepper-row">
          <span className="rr-row-label">Flow</span>
          <div className="rr-toggle">
            <button className={'rr-toggle-opt' + (prefs.flow === 'paginated' ? ' active' : '')} onClick={() => onFlow('paginated')}>Pages</button>
            <button className={'rr-toggle-opt' + (prefs.flow === 'scrolled' ? ' active' : '')} onClick={() => onFlow('scrolled')}>Scroll</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Contents + Ribbons ────────────────────────────────────────────────────────
function ContentsPanel({ toc, chapterHref, ribbons, showRibbons, currentRibbonId, pageOf, onJump, onRemoveRibbon, onClose }) {
  return (
    <div className="rr-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rr-sheet rr-sheet-tall" role="dialog" aria-label="Contents">
        <div className="rr-grab" />
        <div className="rr-sheet-title">&#10086; Contents</div>
        <div className="rr-scroll">
          {toc.length === 0
            ? <div className="rr-empty">No chapters listed for this book.</div>
            : toc.map((c, i) => (
              <button key={i} className={'rr-toc-item' + (c.href && c.href === chapterHref ? ' current' : '')} style={{ paddingInlineStart: `${1 + c.level * 1.1}rem` }} onClick={() => c.href && onJump(c.href)} disabled={!c.href}>{c.label}</button>
            ))}

          {showRibbons && ribbons.length > 0 && (
            <>
              <div className="rr-section-label">Ribbons</div>
              {ribbons.map((r) => {
                const page = pageOf ? pageOf(r.fraction) : null;
                // Chapter · page, falling back to a percentage when the book has not yet
                // told us its page span, and to neither when it is a legacy record.
                const where = [
                  r.label || null,
                  page ? `Page ${page}` : (typeof r.fraction === 'number' ? `${Math.round(r.fraction * 100)}%` : null),
                ].filter(Boolean).join(' · ');
                return (
                  <div key={r.id} className={'rr-ribbon-row' + (r.id === currentRibbonId ? ' current' : '')}>
                    <button className="rr-ribbon-jump" onClick={() => onJump(r.cfi)}>
                      <span className="rr-ribbon-dot" />
                      <span className="rr-ribbon-copy">
                        {r.excerpt
                          ? <span className="rr-ribbon-excerpt">&ldquo;{r.excerpt}&rdquo;</span>
                          : <span className="rr-ribbon-excerpt rr-ribbon-excerpt-bare">{r.label || 'A marked page'}</span>}
                        <span className="rr-ribbon-where">{where}{where ? ' · ' : ''}{timeAgo(r.createdAt)}</span>
                      </span>
                    </button>
                    <button className="rr-ribbon-x" onClick={() => onRemoveRibbon(r)} aria-label="Remove ribbon">&times;</button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Search ────────────────────────────────────────────────────────────────────
function SearchPanel({ query, setQuery, results, truncated, searching, onPick, onClose }) {
  return (
    <div className="rr-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rr-sheet rr-sheet-tall" role="dialog" aria-label="Search">
        <div className="rr-grab" />
        <div className="rr-search-head">
          <input
            className="rr-search-input" autoFocus value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this book…" enterKeyHint="search"
          />
          <button className="rr-search-close" onClick={onClose} aria-label="Close search">&times;</button>
        </div>
        <div className="rr-scroll">
          {searching && <div className="rr-empty">Searching…</div>}
          {!searching && query.trim() && results.length === 0 && <div className="rr-empty">No matches.</div>}
          {results.map((r, i) => (
            <button key={i} className="rr-result" onClick={() => onPick(r)}>
              {r.chapterLabel && <span className="rr-result-chapter">{r.chapterLabel}</span>}
              <span className="rr-result-excerpt">{r.pre}<mark>{r.match}</mark>{r.post}</span>
            </button>
          ))}
          {truncated && <div className="rr-empty">Showing the first 50 matches — refine your search.</div>}
        </div>
      </div>
    </div>
  );
}

// ── The room's stylesheet. Shared by every register; nothing register-specific here. ──
const ROOM_CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeOpacity{from{opacity:0}to{opacity:1}}
  @keyframes blink{0%,100%{opacity:0.35}50%{opacity:0.9}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes ribbonDrop{0%{transform:translateY(-40px)}60%{transform:translateY(6px)}100%{transform:translateY(0)}}
  @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
  @keyframes toastOut{from{opacity:1}to{opacity:0;transform:translateX(-50%) translateY(-8px)}}

  /* R4a.2 fault A: 100vw is the LAYOUT viewport on iOS and ignores the safe area, so it
     overflowed the visual viewport and shifted the surface. inset-based sizing tracks the
     real box. --rr-lane reserves the ribbon's gutter (fault C) — it is painted with
     --rr-bg, so the surface still reads as full-bleed paper.
     R7.1: the lane is reserved on EVERY register, including samples where the tab is
     withheld. A gutter that changed width by register would repaginate the same book
     differently on each door, which is the one thing the single geometry exists to stop. */
  /* R4a.3: the safe-area insets are named ONCE here and referenced everywhere else. */
  .rr-root{--rr-accent:#c9a44c;--rr-lane:30px;
    --rr-sat:env(safe-area-inset-top);--rr-sab:env(safe-area-inset-bottom);
    --rr-sal:env(safe-area-inset-left);--rr-sar:env(safe-area-inset-right);--rr-thread-h:3px;
    position:fixed;top:0;left:0;right:0;height:100dvh;overflow:hidden;background:var(--rr-bg);color:var(--rr-fg)}
  .rr-root[data-theme="vellum"]{--rr-bg:#f2ecd9;--rr-fg:#2b2418;--rr-chrome:rgba(242,236,217,.9);--rr-line:rgba(43,36,24,.14);--rr-soft:rgba(43,36,24,.55)}
  .rr-root[data-theme="ivory"]{--rr-bg:#faf7f0;--rr-fg:#1f1c16;--rr-chrome:rgba(250,247,240,.9);--rr-line:rgba(31,28,22,.13);--rr-soft:rgba(31,28,22,.55)}
  .rr-root[data-theme="dusk"]{--rr-bg:#211d16;--rr-fg:#ddd2b8;--rr-chrome:rgba(33,29,22,.9);--rr-line:rgba(221,210,184,.16);--rr-soft:rgba(221,210,184,.55)}
  .rr-root[data-theme="ink"]{--rr-bg:#0a0a0a;--rr-fg:#d9d2bf;--rr-chrome:rgba(10,10,10,.92);--rr-line:rgba(217,210,191,.14);--rr-soft:rgba(217,210,191,.5)}

  /* R4a.2 fault B: env() resolves to 0 inside a nested browsing context, so the iframe can
     never protect itself from the notch — the PARENT must inset it. The inset lives on a
     WRAPPER, not the iframe: an absolutely-positioned replaced element with width:auto
     falls back to its intrinsic 300px instead of stretching to left/right.
     WALL §7.7: the wrapper's box IS the paginator's layout box — foliate sizes its columns
     from the iframe it lives in, so nothing may overlay or inset it further, or page
     extremities land in hidden pixels. The gold thread's 3px is reserved here, not painted
     over the page. Chrome and panels are position:fixed siblings, never ancestors. */
  .rr-frame-wrap{position:fixed;background:var(--rr-bg);
    top:var(--rr-sat);left:var(--rr-sal);right:calc(var(--rr-lane) + var(--rr-sar));
    height:calc(100dvh - var(--rr-sat) - var(--rr-sab) - var(--rr-thread-h))}
  .rr-frame{display:block;border:none;width:100%;height:100%;background:var(--rr-bg)}

  /* R7.1: .rr-top is a column so an optional banner (the sample's CTA) rides WITH the bar
     and hides with it. .rr-top-row carries the flex layout the bar has always had. */
  .rr-top{position:fixed;top:0;left:0;right:0;z-index:40;padding:8px 12px;
    padding-top:max(8px,var(--rr-sat));background:var(--rr-chrome);backdrop-filter:blur(10px);
    border-bottom:1px solid var(--rr-line);transition:transform .35s cubic-bezier(.2,.7,.2,1)}
  .rr-top.hidden{transform:translateY(-110%)}
  .rr-top-row{display:flex;align-items:center;gap:8px}
  .rr-back{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;font-family:'Cinzel',serif;font-size:.6rem;
    letter-spacing:.14em;text-transform:uppercase;color:var(--rr-soft);text-decoration:none;white-space:nowrap}
  .rr-back:hover{color:var(--rr-accent)}
  .rr-titleblock{flex:1;text-align:center;min-width:0}
  .rr-book-title{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--rr-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rr-chapter{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:.72rem;color:var(--rr-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
  .rr-tools{display:flex;align-items:center;gap:2px;flex-shrink:0}
  .rr-tool{min-width:44px;min-height:44px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;
    background:none;border:none;cursor:pointer;font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.1em;
    text-transform:uppercase;color:var(--rr-soft)}
  .rr-tool:hover{color:var(--rr-accent)}

  /* The banner sits flush to the bar's edges — the negative margins cancel .rr-top's own
     padding rather than nesting a second inset inside it. */
  .rr-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;
    margin:8px -12px -8px;padding:7px 12px;background:rgba(201,164,76,.09);border-top:1px solid var(--rr-line)}
  .rr-banner-label{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.22em;text-transform:uppercase;color:var(--rr-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rr-banner-cta{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.14em;text-transform:uppercase;color:var(--rr-accent);text-decoration:none;white-space:nowrap;font-weight:600;flex-shrink:0}
  .rr-banner-cta:hover{color:var(--rr-fg)}

  .rr-bot{position:fixed;bottom:0;left:0;right:0;z-index:40;display:flex;align-items:center;justify-content:center;
    min-height:44px;padding-bottom:max(0px,var(--rr-sab));background:var(--rr-chrome);backdrop-filter:blur(10px);
    border-top:1px solid var(--rr-line);transition:transform .35s cubic-bezier(.2,.7,.2,1)}
  .rr-bot.hidden{transform:translateY(110%)}
  .rr-botinfo{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:var(--rr-soft);white-space:nowrap;pointer-events:none;padding:0 12px}

  /* R4a.2 fault B (bottom): lift the thread clear of the home indicator. */
  .rr-thread{position:fixed;bottom:var(--rr-sab);left:0;right:0;height:var(--rr-thread-h);z-index:50;background:rgba(201,164,76,.1);pointer-events:none}
  .rr-thread-fill{height:100%;background:var(--rr-accent);box-shadow:0 0 8px rgba(201,164,76,.7);transition:width .45s ease}

  /* R4a.2 fault C: anchored into the reserved --rr-lane gutter and below the safe area.
     24px tab in a 30px lane with a 3px edge gap => it can never reach the text column. */
  .rr-ribbon-tab{position:fixed;top:calc(var(--rr-sat) + 6px);right:max(3px,var(--rr-sar));z-index:38;width:24px;min-height:44px;border:none;cursor:pointer;padding:0;
    background:linear-gradient(180deg,#e8c877,#a8842f);box-shadow:0 3px 8px rgba(0,0,0,.4);
    display:flex;align-items:flex-start;justify-content:center;padding-top:8px;color:#3a2c0a}
  .rr-ribbon-tab::after{content:'';position:absolute;left:0;right:0;bottom:-8px;height:9px;background:linear-gradient(180deg,#c9a44c,#a8842f);clip-path:polygon(0 0,100% 0,100% 100%,50% 55%,0 100%)}
  .rr-ribbon-tab.dropping{animation:ribbonDrop .65s cubic-bezier(.2,.8,.2,1)}
  .rr-ribbon-count{font-family:'Cinzel',serif;font-size:.5rem;font-weight:600}
  /* R7.2 — the tab carries the page's state. FILLED (solid silk) means a ribbon sits on
     this page and tapping lifts it; EMPTY (a ghost of the same shape) means tapping drops
     one. Same silhouette in both states, so it reads as one object changing, not two
     controls swapping places. */
  .rr-ribbon-tab.empty{background:linear-gradient(180deg,rgba(232,200,119,.26),rgba(168,132,47,.26));
    box-shadow:0 2px 6px rgba(0,0,0,.28);color:rgba(58,44,10,.55)}
  .rr-ribbon-tab.empty::after{background:linear-gradient(180deg,rgba(201,164,76,.26),rgba(168,132,47,.26))}
  .rr-ribbon-tab.filled{box-shadow:0 3px 10px rgba(0,0,0,.45),0 0 0 1px rgba(255,244,208,.35)}
  .rr-ribbon-tab:active{transform:translateY(1px)}

  .rr-sheet-backdrop{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
  .rr-sheet{width:100%;max-width:560px;max-height:82dvh;background:var(--rr-bg);color:var(--rr-fg);border:1px solid var(--rr-line);
    border-radius:18px 18px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));animation:sheetUp .32s cubic-bezier(.2,.7,.2,1);display:flex;flex-direction:column}
  .rr-sheet-tall{height:78dvh}
  .rr-grab{width:38px;height:4px;border-radius:999px;background:var(--rr-soft);opacity:.5;margin:2px auto 14px}
  .rr-sheet-title{font-family:'Cinzel',serif;font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:var(--rr-accent);text-align:center;margin-bottom:1.4rem}
  .rr-row-label{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.2em;text-transform:uppercase;color:var(--rr-soft);margin:0 0 .7rem}
  .rr-swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem;margin-bottom:1.4rem}
  .rr-swatch{background:none;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:.4rem;padding:0}
  .rr-swatch-page{width:100%;aspect-ratio:3/4;min-height:44px;border-radius:4px;display:flex;align-items:center;justify-content:center;
    font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;box-shadow:0 4px 12px rgba(0,0,0,.3);border:2px solid transparent}
  .rr-swatch.active .rr-swatch-page{border-color:var(--rr-accent)}
  .rr-swatch-name{font-family:'Cinzel',serif;font-size:.48rem;letter-spacing:.1em;text-transform:uppercase;color:var(--rr-soft)}
  .rr-faces{display:flex;gap:.6rem;margin-bottom:1.4rem;flex-wrap:wrap}
  .rr-face{flex:1;min-height:44px;min-width:90px;border:1px solid var(--rr-line);border-radius:8px;background:none;color:var(--rr-fg);cursor:pointer;font-size:1rem;padding:.4rem}
  .rr-face.active{border-color:var(--rr-accent);color:var(--rr-accent)}
  .rr-stepper-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;gap:1rem}
  .rr-stepper,.rr-toggle{display:flex;align-items:center;gap:2px;border:1px solid var(--rr-line);border-radius:10px;overflow:hidden}
  .rr-step{min-width:44px;min-height:44px;background:none;border:none;color:var(--rr-fg);font-size:1.2rem;cursor:pointer}
  .rr-step:disabled{opacity:.3;cursor:not-allowed}
  .rr-step-val{min-width:56px;text-align:center;font-family:'Cinzel',serif;font-size:.66rem;letter-spacing:.06em;color:var(--rr-fg)}
  .rr-toggle-opt{min-height:44px;padding:0 1.1rem;background:none;border:none;cursor:pointer;font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;color:var(--rr-soft)}
  .rr-toggle-opt.active{background:var(--rr-accent);color:var(--rr-bg)}

  .rr-scroll{overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch}
  .rr-toc-item{display:block;width:100%;text-align:start;min-height:44px;background:none;border:none;border-bottom:1px solid var(--rr-line);
    cursor:pointer;color:var(--rr-fg);font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;padding:.6rem 1rem}
  .rr-toc-item.current{color:var(--rr-accent)}
  .rr-toc-item:disabled{opacity:.5;cursor:default}
  .rr-section-label{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.2em;text-transform:uppercase;color:var(--rr-accent);margin:1.4rem 0 .5rem}
  .rr-ribbon-row{display:flex;align-items:center;gap:.5rem;border-bottom:1px solid var(--rr-line)}
  .rr-ribbon-row.current .rr-ribbon-dot{box-shadow:0 0 0 3px rgba(201,164,76,.22)}
  .rr-ribbon-jump{flex:1;display:flex;align-items:flex-start;gap:.7rem;min-height:44px;background:none;border:none;cursor:pointer;text-align:start;color:var(--rr-fg);padding:.7rem 0}
  .rr-ribbon-dot{width:8px;height:16px;background:var(--rr-accent);border-radius:1px;flex-shrink:0;margin-top:3px}
  .rr-ribbon-copy{min-width:0}
  .rr-ribbon-excerpt{display:block;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:.95rem;line-height:1.45;color:var(--rr-fg)}
  .rr-ribbon-excerpt-bare{font-style:normal;color:var(--rr-soft)}
  .rr-ribbon-where{display:block;margin-top:3px;font-family:'Cinzel',serif;font-size:.48rem;letter-spacing:.16em;text-transform:uppercase;color:var(--rr-soft)}
  .rr-ribbon-x{min-width:44px;min-height:44px;background:none;border:none;color:var(--rr-soft);font-size:1.2rem;cursor:pointer}
  .rr-empty{padding:2rem 1rem;text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;color:var(--rr-soft)}

  .rr-search-head{display:flex;align-items:center;gap:.5rem;margin-bottom:1rem}
  .rr-search-input{flex:1;min-height:44px;background:none;border:1px solid var(--rr-line);border-radius:10px;padding:0 1rem;color:var(--rr-fg);font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;outline:none}
  .rr-search-close{min-width:44px;min-height:44px;background:none;border:none;color:var(--rr-soft);font-size:1.4rem;cursor:pointer}
  .rr-result{display:block;width:100%;text-align:start;background:none;border:none;border-bottom:1px solid var(--rr-line);cursor:pointer;padding:.75rem 1rem}
  .rr-result-chapter{display:block;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:var(--rr-soft);margin-bottom:.3rem}
  .rr-result-excerpt{display:block;font-family:'Cormorant Garamond',Georgia,serif;font-size:.92rem;line-height:1.5;color:var(--rr-fg)}
  .rr-result-excerpt mark{background:none;color:var(--rr-accent);font-weight:600}

  .rr-cover{position:fixed;inset:0;background:linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px;text-align:center;z-index:80;cursor:pointer;animation:fadeUp .7s ease forwards}
  .rr-cover::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 65% at 50% 38%,rgba(107,47,173,.28) 0%,transparent 68%)}
  /* R4a.4 — bound-book treatment for the splash cover. Deliberately NOT BoundBook: that
     component is fixed-geometry and crops with object-fit:cover, whereas story covers come
     from the CMS at arbitrary ratios. The spine gradient stops and the fore-edge stripe are
     copied verbatim from BOUND_BOOK_CSS so the two read as the same object. */
  .rr-cbind{position:relative;display:inline-block;z-index:1;margin-bottom:14px;
    transform:rotate(-1.4deg);transform-origin:50% 60%}
  .rr-cimg{display:block;width:auto;height:auto;max-width:min(320px,75vw);max-height:60dvh;object-fit:contain;
    border-radius:2px 5px 5px 2px;box-shadow:0 12px 48px rgba(0,0,0,.75),0 0 0 1px rgba(201,164,76,.2)}
  .rr-cbind::before{content:'';position:absolute;top:0;bottom:0;left:0;width:11px;z-index:2;pointer-events:none;
    border-radius:2px 0 0 2px;
    background:linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.2) 34%,rgba(255,255,255,.09) 50%,rgba(0,0,0,.22) 66%,rgba(0,0,0,.34) 100%)}
  .rr-cbind::after{content:'';position:absolute;top:2.5%;bottom:2.5%;right:-9px;width:10px;pointer-events:none;
    border-radius:0 2px 2px 0;
    background:repeating-linear-gradient(90deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);
    box-shadow:1px 2px 6px rgba(0,0,0,.5)}
  .rr-corn{font-size:.55rem;letter-spacing:.4em;color:rgba(201,164,76,.3);margin-bottom:10px;position:relative;z-index:1}
  .rr-ctitle{font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(1rem,2.5vw,1.5rem);font-weight:300;color:#f5efe0;line-height:1.2;margin-bottom:6px;position:relative;z-index:1;font-style:italic}
  .rr-cauthor{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.24em;color:rgba(201,164,76,.65);text-transform:uppercase;position:relative;z-index:1}
  .rr-cabout{position:relative;z-index:1;margin-top:16px;width:100%;max-width:440px;display:flex;justify-content:center}
  .rr-ccta{position:absolute;bottom:calc(22px + env(safe-area-inset-bottom));font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;color:rgba(201,164,76,.4);text-transform:uppercase;animation:blink 2.2s ease-in-out infinite}

  /* The ending. An OVERLAY at z-70 — it covers the chrome (z-40/50) and the frame without
     unmounting either, so returning to the book keeps the reader's place (R7.0 §8.6). */
  .rr-end-wrap{position:fixed;inset:0;overflow-y:auto;background:#0a0a0a;animation:fadeOpacity .5s ease forwards;z-index:70}
  .rr-end{display:flex;flex-direction:column;align-items:center;padding:calc(48px + env(safe-area-inset-top)) 24px 32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)}
  .rr-eorn{font-size:.9rem;color:#c9a44c;letter-spacing:.5em;margin-bottom:18px}
  .rr-erule{width:60px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 18px}
  .rr-etitle{font-family:Cormorant Garamond,Georgia,serif;font-size:1.35rem;font-style:italic;color:#f5efe0;margin-bottom:6px}
  .rr-eauth{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.2em;color:rgba(201,164,76,.55);text-transform:uppercase;margin-bottom:24px}
  .rr-ebtn{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;padding:10px 26px;background:none;border:1px solid rgba(107,47,173,.35);color:#c9a84c;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:all .2s;margin:4px}
  .rr-ebtn:hover{background:rgba(107,47,173,.12);border-color:#c9a84c}

  /* The colophon — the bookstore ending. A printer's last page, not a call to action. */
  .rr-colo{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:calc(56px + env(safe-area-inset-top)) 28px calc(44px + env(safe-area-inset-bottom));text-align:center}
  .rr-colo-fleuron{font-size:1.05rem;color:#c9a44c;letter-spacing:.45em;margin-bottom:28px}
  .rr-colo-title{font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(1.3rem,4vw,1.7rem);font-weight:300;font-style:italic;color:#f5efe0;line-height:1.25;max-width:460px}
  .rr-colo-rule{width:54px;height:1px;background:rgba(201,164,76,.32);margin:22px auto}
  .rr-colo-cat{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.28em;text-transform:uppercase;color:rgba(201,164,76,.62);line-height:2.1}
  .rr-colo-note{font-family:Cormorant Garamond,Georgia,serif;font-style:italic;font-size:1rem;color:rgba(240,234,216,.5);line-height:1.75;max-width:330px;margin:28px 0 34px}

  .rr-early{position:fixed;bottom:calc(52px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);
    background:#6b2fad;border:none;border-radius:999px;padding:10px 24px;display:flex;align-items:center;gap:8px;
    font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.18em;text-transform:uppercase;color:#f5f0e8;cursor:pointer;
    z-index:45;box-shadow:0 4px 24px rgba(107,47,173,0.5)}

  .rr-resume-toast{position:fixed;bottom:calc(52px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:#6b2fad;border:1px solid rgba(201,164,76,0.3);border-radius:999px;padding:9px 20px;font-family:Cormorant Garamond,Georgia,serif;font-size:.82rem;font-style:italic;color:#f0ead8;white-space:nowrap;z-index:55;pointer-events:none}
  .rr-resume-toast.in{animation:toastIn .4s ease forwards}
  .rr-resume-toast.out{animation:toastOut .4s ease forwards}

  .rr-noepub{position:fixed;inset:0;background:#f6f0e2;display:flex;align-items:center;justify-content:center;font-family:Cormorant Garamond,Georgia,serif;font-style:italic;color:#888;font-size:1rem}
  .rr-booting{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--rr-bg)}
  .rr-spin{width:34px;height:34px;border:2px solid rgba(201,164,76,.2);border-top-color:#c9a44c;border-radius:50%;animation:spin .9s linear infinite}

  @media (prefers-reduced-motion: reduce){
    .rr-top,.rr-bot,.rr-thread-fill,.rr-sheet,.rr-cover,.rr-end-wrap{transition:none !important;animation:none !important}
    .rr-ribbon-tab.dropping{animation:none}
    .rr-cbind{transform:none}
  }
`;

/**
 * @param {object}   p
 * @param {'story'|'book'} p.register  Which door the reader came through. Affects nothing
 *                                     on its own — it is recorded for logs and for the
 *                                     adapters' own defaults.
 * @param {boolean}  p.sample          Bookstore sample. Withholds ribbons (bare-slug
 *                                     collision with the purchased copy — R7.0 §8.11).
 * @param {string|null} p.epubSource   Resolved EPUB URL. Changing it rebuilds the frame;
 *                                     that is the purchased path's one re-mint retry.
 * @param {object}   p.meta            { slug, title, author }
 * @param {object}   p.escape          { href, label } — the top-bar back control.
 * @param {object|null} p.user         Firebase user, for ribbons and progress.
 * @param {boolean}  p.ribbons         Enable the ribbon tab + the Contents ribbon list.
 * @param {{path:(uid:string)=>string}|null} p.progress  Where this register's reading
 *                                     position lives. Absent ⇒ no read and no write.
 * @param {React.ReactNode} p.coverSplash   Splash contents; also gates the first paint.
 * @param {React.ReactNode} p.banner        Pinned under the bar, rides with the chrome.
 * @param {React.ReactNode} p.earlyEnding   Contents of the pre-end pill (shown past 90%).
 * @param {(ctx:{close:()=>void})=>React.ReactNode} p.renderEnding  The ending overlay.
 * @param {(info:object)=>void} p.onRelocate
 * @param {()=>void} p.onEnded
 * @param {(message:string)=>void} p.onError       Host could not open the file.
 * @param {()=>void} p.onRequireAuth               Ribbon tapped while signed out.
 */
export default function ReadingRoom({
  register = 'story',
  sample = false,
  epubSource,
  meta,
  escape,
  user = null,
  ribbons: ribbonsEnabled = false,
  progress = null,
  coverSplash = null,
  banner = null,
  earlyEnding = null,
  renderEnding = null,
  onRelocate,
  onEnded,
  onError,
  onRequireAuth,
}) {
  const slug = meta?.slug;

  // A sample and its purchased copy share a bare slug, so a ribbon written from one would
  // surface in the other (R7.0 §8.11). Enforced HERE rather than left to adapter
  // discipline — it gates the subscription as well as the tab, so a sample never so much
  // as reads the owned copy's ribbons. Namespacing lands in R7.2.
  const ribbonsOn = ribbonsEnabled && !sample;

  // R7.2 — progress is a NODE, not a flag: { path: (uid) => string }. One mechanism, two
  // destinations. The story register keeps users/{uid}/readerProgress/{slug}; a purchased
  // book goes to bookstore_reading_progress/{uid}/{titleId}, which is owner-only. Samples
  // pass nothing and neither read nor write. Held in a ref because an adapter's object
  // literal is a new identity on every render and must not churn the effects.
  const progressEnabled = typeof progress?.path === 'function';
  const progressRef = useRef(progress);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  // Chrome state
  const [chromeVisible, setChromeVisible] = useState(true);
  const [panel, setPanel] = useState('none'); // 'none' | 'type' | 'toc' | 'search'
  const [reduced, setReduced] = useState(false);

  // WALL §7.12 — prefs captured ONCE into a ref. `prefs` state drives the panel and the
  // chrome theme; it must never reach the iframe src, or a Typesetter tap reloads the book.
  const prefsInit = useRef(null);
  if (!prefsInit.current) prefsInit.current = loadPrefs();
  const [prefs, setPrefs] = useState(prefsInit.current);
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);

  // Location / progress
  const [fraction, setFraction] = useState(0);
  const [chapterLabel, setChapterLabel] = useState('');
  const [chapterHref, setChapterHref] = useState('');
  const [botInfo, setBotInfo] = useState({ cur: null, total: null, pct: 0, minLeft: null });
  const [toc, setToc] = useState([]);
  const [ribbons, setRibbons] = useState([]);
  const [ribbonDropping, setRibbonDropping] = useState(false);
  const [pct, setPct] = useState(0);
  // One page as a fraction of the whole book, learned by the host from the smallest
  // observed forward step. 0 until the first forward turn.
  const [pageSpan, setPageSpan] = useState(0);

  // Gates and overlays
  const [coverPending, setCoverPending] = useState(!!coverSplash);
  const [ended, setEnded] = useState(false);
  const [readerReady, setReaderReady] = useState(!progressEnabled);
  const [resumeToast, setResumeToast] = useState(false);
  const [toastFading, setToastFading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searching, setSearching] = useState(false);

  const iframeRef = useRef(null);
  const progressSaveTimer = useRef(null);
  const currentCFI = useRef('');
  const currentFraction = useRef(0);
  const restoreTargetRef = useRef(null);   // CFI to restore on ready
  const restoreFractionRef = useRef(null); // fraction fallback (old shape)
  const idleTimer = useRef(null);
  const panelRef = useRef('none');
  useEffect(() => { panelRef.current = panel; }, [panel]);
  // Read by the relocate handler, which must not re-bind on every visibility change.
  const chromeVisibleRef = useRef(true);
  useEffect(() => { chromeVisibleRef.current = chromeVisible; }, [chromeVisible]);
  const saveRibbonRef = useRef(null);
  const searchIdRef = useRef(0);
  const searchDebounce = useRef(null);

  // Parent callbacks behind a ref: an adapter passing an inline arrow must not re-register
  // the window message listener on every render.
  const cbRef = useRef({});
  useEffect(() => {
    cbRef.current = { onRelocate, onEnded, onError, onRequireAuth };
  }, [onRelocate, onEnded, onError, onRequireAuth]);

  useEffect(() => { setReduced(!!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)); }, []);

  // WALL §7.5 — origin-locked outbound.
  const postToFrame = useCallback((msg) => {
    try { iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin); } catch {}
  }, []);

  // ── Restore lookup (progress registers only) ─────────────────────────────────
  // Reads the CFI progress once and queues the restore target for the ready event.
  // Fallback chain: {cfi} → goTo(cfi); {fraction} (old shape) or bare number →
  // goToFraction once. Ready-gated in the host, so there is no restore race.
  useEffect(() => {
    if (!progressEnabled) { setReaderReady(true); return undefined; }
    if (!slug) return undefined;
    const timeout = setTimeout(() => setReaderReady(true), 3000);
    (async () => {
      try {
        const { initializeApp, getApps } = await import('firebase/app');
        const app = getApps().length ? getApps()[0] : initializeApp(FB);
        const { getAuth, onAuthStateChanged } = await import('firebase/auth');
        const auth = getAuth(app);
        const unsub = onAuthStateChanged(auth, async (u) => {
          clearTimeout(timeout);
          if (!u) { setReaderReady(true); return; } unsub();
          try {
            const db = await getDB();
            const { ref, get } = await import('firebase/database');
            const path = progressRef.current?.path?.(u.uid);
            if (!path) { setReaderReady(true); return; }
            const snap = await get(ref(db, path));
            if (snap.exists()) {
              const v = snap.val();
              if (typeof v === 'number') { restoreFractionRef.current = v; }
              else if (v && typeof v.cfi === 'string' && v.cfi) { restoreTargetRef.current = v.cfi; }
              else if (v && typeof v.fraction === 'number') { restoreFractionRef.current = v.fraction; }
              if (restoreTargetRef.current || restoreFractionRef.current) setResumeToast(true);
            }
          } catch (e) {}
          setReaderReady(true);
        });
      } catch (e) { setReaderReady(true); }
    })();
    return () => clearTimeout(timeout);
  }, [slug, progressEnabled]);

  // The toast's life starts when the reader can actually SEE it. The lookup resolves while
  // the cover splash is still up, so timing it from there spent the whole 3.8s behind the
  // cover and a returning reader was never told their place had been kept.
  useEffect(() => {
    if (!resumeToast || coverPending) return undefined;
    const fade = setTimeout(() => setToastFading(true), 3200);
    const gone = setTimeout(() => setResumeToast(false), 3800);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, [resumeToast, coverPending]);

  // ── Ribbons: live subscription per user per book ─────────────────────────────
  useEffect(() => {
    if (!ribbonsOn || !user || !slug) { setRibbons([]); return undefined; }
    let unsub;
    (async () => {
      try {
        const db = await getDB();
        const { ref, onValue } = await import('firebase/database');
        unsub = onValue(ref(db, `readerBookmarks/${user.uid}/${slug}`), (snap) => {
          const out = [];
          if (snap.exists()) snap.forEach((c) => { out.push({ id: c.key, ...(c.val() || {}) }); return false; });
          out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          setRibbons(out);
        });
      } catch (e) {}
    })();
    return () => { if (unsub) unsub(); };
  }, [ribbonsOn, user?.uid, slug]);

  // ── Auto-save the position (debounced ~2s). Shape: { cfi?, fraction, updatedAt }. ──
  // The destination is the register's own node: stories keep users/{uid}/readerProgress,
  // purchased books go to the owner-only bookstore_reading_progress. Samples pass no node
  // and this effect never runs for them.
  useEffect(() => {
    if (!progressEnabled || !user) return undefined;
    if (!pct || pct < 1) return undefined;
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(async () => {
      try {
        const db = await getDB();
        const { ref, set } = await import('firebase/database');
        const path = progressRef.current?.path?.(user.uid);
        if (!path) return;
        // The bookstore node is shape-validated (fraction + updatedAt required, $other
        // closed), so cfi is omitted rather than written as null when there isn't one.
        const record = { fraction: currentFraction.current || pct / 100, updatedAt: Date.now() };
        if (currentCFI.current) record.cfi = currentCFI.current;
        await set(ref(db, path), record);
      } catch (e) { console.warn('[reader] progress save failed:', e); }
    }, 2000);
    return () => { if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current); };
  }, [pct, progressEnabled, user?.uid, slug]);

  // ── Chrome vanishing behaviour — carried over AS-IS (R7.2 owns any change) ───
  const bumpIdle = useCallback(() => {
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (panelRef.current !== 'none') return; // never auto-hide with a panel open
    idleTimer.current = setTimeout(() => { if (panelRef.current === 'none') setChromeVisible(false); }, CHROME_IDLE_MS);
  }, []);
  const toggleChrome = useCallback(() => {
    if (panelRef.current !== 'none') return;
    setChromeVisible((v) => {
      const nv = !v;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (nv) idleTimer.current = setTimeout(() => { if (panelRef.current === 'none') setChromeVisible(false); }, CHROME_IDLE_MS);
      return nv;
    });
  }, []);
  const openPanel = useCallback((name) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setChromeVisible(true);
    setPanel(name);
  }, []);
  const closePanel = useCallback(() => {
    setPanel('none');
    postToFrame({ type: 'clearSearch' });
    bumpIdle();
  }, [postToFrame, bumpIdle]);

  // Escape closes whatever sheet is open. R7.0 §4 recorded that the panels could only be
  // dismissed by their backdrop; a keyboard reader had no way out. Focus is in the parent
  // document whenever a sheet is up (the reader just used a chrome control), so a
  // parent-level listener is sufficient — the iframe cannot be reached behind a backdrop.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (panelRef.current === 'none') return;
      e.preventDefault();
      closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel]);

  // Kick off the idle countdown once reading begins.
  useEffect(() => {
    if (!coverPending && !ended) bumpIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [coverPending, ended, bumpIdle]);

  // ── The postMessage bridge. WALL §7.5 — origin-locked inbound. ───────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data || {};
      if (d.type === 'ready') {
        setToc(Array.isArray(d.toc) ? d.toc : []);
        postToFrame(stylesMsg(prefsRef.current));
        postToFrame({ type: 'setFlow', flow: prefsRef.current.flow });
        // WALL §7.14 — the host queues these when it is not ready yet; we never gate here.
        if (restoreTargetRef.current) postToFrame({ type: 'goTo', cfi: restoreTargetRef.current });
        else if (restoreFractionRef.current != null) postToFrame({ type: 'goToFraction', fraction: restoreFractionRef.current });
      } else if (d.type === 'relocate') {
        currentCFI.current = d.cfi || currentCFI.current;
        currentFraction.current = typeof d.fraction === 'number' ? d.fraction : currentFraction.current;
        setFraction(currentFraction.current);
        setPct(currentFraction.current * 100);
        setChapterLabel(d.chapterLabel || '');
        if (d.chapterHref) setChapterHref(d.chapterHref);
        setBotInfo({ cur: d.pageCurrent, total: d.pageTotal, pct: d.pct, minLeft: d.minLeft });
        if (typeof d.pageSpan === 'number' && d.pageSpan > 0) setPageSpan(d.pageSpan);
        // R7.2 (recon §8.5): turning pages IS activity. The 3.5s countdown restarts on
        // every relocate while the chrome is up, so chrome stays for as long as the reader
        // is moving and hides only on true idleness. When the chrome is already hidden a
        // page turn must NOT summon it — hence the guard rather than an unconditional bump.
        if (chromeVisibleRef.current) bumpIdle();
        cbRef.current.onRelocate?.({
          cfi: d.cfi, fraction: currentFraction.current, pct: d.pct,
          pageCurrent: d.pageCurrent, pageTotal: d.pageTotal,
          minLeft: d.minLeft, chapterLabel: d.chapterLabel || null,
        });
      } else if (d.type === 'ended') {
        setEnded(true);
        cbRef.current.onEnded?.();
      } else if (d.type === 'toggleChrome') {
        toggleChrome();
      } else if (d.type === 'bookmarkCFI') {
        saveRibbonRef.current?.(d);
      } else if (d.type === 'error') {
        cbRef.current.onError?.(d.message || null);
      } else if (d.type === 'searchResults' && d.id === searchIdRef.current) {
        setSearchResults(Array.isArray(d.results) ? d.results : []);
        setSearchTruncated(!!d.truncated);
        setSearching(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postToFrame, toggleChrome, bumpIdle]);

  // ── Typesetter handlers ───────────────────────────────────────────────────────
  // WALL §7.10 — every change travels by message. Nothing here touches the src.
  const applyPrefs = useCallback((patch, kind) => {
    setPrefs((p) => {
      const np = { ...p, ...patch };
      savePrefs(np);
      if (kind === 'flow') postToFrame({ type: 'setFlow', flow: np.flow });
      else postToFrame(stylesMsg(np));
      return np;
    });
  }, [postToFrame]);
  const onPaper = (k) => applyPrefs({ paper: k });
  const onFace = (k) => applyPrefs({ face: k });
  const onSize = (delta) => applyPrefs({ sizePct: Math.min(SIZE_MAX, Math.max(SIZE_MIN, prefsRef.current.sizePct + delta)) });
  const onLeading = (delta) => applyPrefs({ leading: clampLeading(prefsRef.current.leading + delta) });
  const onFlow = (flow) => applyPrefs({ flow }, 'flow');

  // ── Ribbons: the tab IS the current page's state ─────────────────────────────
  const currentRibbon = useMemo(
    () => findRibbonOnPage(ribbons, fraction, pageSpan),
    [ribbons, fraction, pageSpan],
  );

  const removeRibbonById = useCallback(async (id) => {
    if (!user || !id) return;
    try {
      const db = await getDB();
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, `readerBookmarks/${user.uid}/${slug}/${id}`));
    } catch (e) { console.warn('[reader] ribbon remove failed', e); }
  }, [user, slug]);

  // The host's answer to requestBookmark. It, not the parent, is the authority on where
  // the reader actually is and what the page says, so the dedupe re-runs against the
  // fraction that comes back rather than the one in state.
  const saveRibbon = useCallback(async (payload) => {
    if (!user) { cbRef.current.onRequireAuth?.(); return; }
    const cfi = payload?.cfi || currentCFI.current;
    if (!cfi) return;
    const f = typeof payload?.fraction === 'number' ? payload.fraction : currentFraction.current;
    const already = findRibbonOnPage(ribbons, f, pageSpan);
    if (already) { await removeRibbonById(already.id); return; } // never two on one page
    if (!reduced) { setRibbonDropping(true); setTimeout(() => setRibbonDropping(false), 650); }
    try {
      const db = await getDB();
      const { ref, push } = await import('firebase/database');
      await push(ref(db, `readerBookmarks/${user.uid}/${slug}`), {
        cfi,
        fraction: f,
        label: payload?.chapterLabel || chapterLabel || null,
        excerpt: payload?.excerpt || '',
        createdAt: Date.now(),
      });
    } catch (e) { console.warn('[reader] ribbon save failed', e); }
  }, [user, slug, chapterLabel, reduced, ribbons, pageSpan, removeRibbonById]);
  useEffect(() => { saveRibbonRef.current = saveRibbon; }, [saveRibbon]);

  // One tap, two meanings, no dialog either way — the mock's contract. Dropping asks the
  // host for the page's CFI, fraction and opening words; the write lands in saveRibbon.
  const onRibbonTap = useCallback(() => {
    if (!user) { cbRef.current.onRequireAuth?.(); return; }
    if (currentRibbon) { removeRibbonById(currentRibbon.id); return; }
    postToFrame({ type: 'requestBookmark' });
  }, [user, currentRibbon, removeRibbonById, postToFrame]);

  // The Contents list keeps its confirm: removing from a list is a different act from
  // un-marking the page you are looking at.
  const removeRibbonFromList = useCallback(async (r) => {
    if (!user) return;
    if (!window.confirm('Remove this ribbon?')) return;
    await removeRibbonById(r.id);
  }, [user, removeRibbonById]);

  const jumpTo = useCallback((cfiOrHref) => {
    postToFrame({ type: 'goTo', cfi: cfiOrHref });
    closePanel();
  }, [postToFrame, closePanel]);

  // ── Search (debounced) ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (panel !== 'search') return undefined;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearchTruncated(false); setSearching(false); return undefined; }
    setSearching(true);
    searchDebounce.current = setTimeout(() => {
      const id = ++searchIdRef.current;
      postToFrame({ type: 'search', id, query: q });
    }, 320);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchQuery, panel, postToFrame]);

  const pickResult = useCallback((r) => {
    postToFrame({ type: 'goTo', cfi: r.cfi });
    closePanel();
  }, [postToFrame, closePanel]);

  // WALL §7.10/§7.12 — the src is built from the CAPTURED prefs and the source URL only.
  // useMemo, not render-time computation, so a re-render can never hand the iframe a new
  // string identity. epubSource changing is the purchased path's re-mint, and is meant to
  // rebuild the frame; nothing else can.
  const iframeSrc = useMemo(
    () => (epubSource ? readingRoomSrc(epubSource, prefsInit.current) : null),
    [epubSource],
  );

  const chromeOff = coverPending || ended || !chromeVisible;
  const showFurniture = !coverPending && !ended;
  const mountFrame = !coverPending && readerReady && !!iframeSrc;

  // Page number for a stored fraction, by the same arithmetic the host uses for the footer
  // (reading-room.html computePages), so a ribbon's page and the footer's page agree.
  const pageOf = (f) => {
    if (!(pageSpan > 0) || typeof f !== 'number') return null;
    const total = botInfo.total || Math.max(1, Math.round(1 / pageSpan));
    return Math.min(total, Math.max(1, Math.round(f / pageSpan) + 1));
  };

  const botText = (() => {
    const parts = [];
    if (botInfo.cur && botInfo.total) parts.push(`Page ${botInfo.cur} of ${botInfo.total}`);
    parts.push(`${botInfo.pct || 0}%`);
    if (typeof botInfo.minLeft === 'number') parts.push(`${botInfo.minLeft} min left in chapter`);
    return parts.join(' · ');
  })();

  return (
    <>
      <style>{ROOM_CSS}</style>

      <div className="rr-root" data-theme={prefs.paper} data-register={register}>
        {/* THE FRAME. Mounted once and never unmounted by chrome, panel or ending state —
            the ending is an overlay, the panels are siblings. The only thing that rebuilds
            it is a new epubSource (the purchased path's single re-mint). */}
        {mountFrame ? (
          <div className="rr-frame-wrap">
            <iframe
              ref={iframeRef}
              className="rr-frame"
              src={iframeSrc}
              title={meta?.title || 'Reading Room'}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        ) : coverPending ? null : iframeSrc ? (
          <div className="rr-booting"><div className="rr-spin" /></div>
        ) : (
          <div className="rr-noepub">No EPUB file available for this book.</div>
        )}

        <header className={'rr-top' + (chromeOff ? ' hidden' : '')}>
          <div className="rr-top-row">
            <a href={escape?.href || '/'} className="rr-back">{escape?.label || '← Library'}</a>
            <div className="rr-titleblock">
              <div className="rr-book-title">{meta?.title}</div>
              {chapterLabel && <div className="rr-chapter">{chapterLabel}</div>}
            </div>
            <div className="rr-tools">
              <button className="rr-tool" onClick={() => openPanel('toc')}>Contents</button>
              <button className="rr-tool" onClick={() => openPanel('search')}>Search</button>
              <button className="rr-tool" onClick={() => openPanel('type')} aria-label="Typesetter">Aa</button>
            </div>
          </div>
          {banner}
        </header>

        {showFurniture && ribbonsOn && (
          <button
            className={'rr-ribbon-tab' + (currentRibbon ? ' filled' : ' empty') + (ribbonDropping ? ' dropping' : '')}
            onClick={onRibbonTap}
            aria-pressed={!!currentRibbon}
            aria-label={currentRibbon ? 'Remove the ribbon on this page' : 'Drop a ribbon on this page'}
            title={currentRibbon ? 'Remove this ribbon' : 'Drop a ribbon'}
            style={{ height: 48 }}
          >
            {ribbons.length > 0 && <span className="rr-ribbon-count">{ribbons.length}</span>}
          </button>
        )}

        <footer className={'rr-bot' + (chromeOff ? ' hidden' : '')}>
          <div className="rr-botinfo">{botText}</div>
        </footer>

        {showFurniture && (
          <div className="rr-thread"><div className="rr-thread-fill" style={{ width: (fraction * 100) + '%' }} /></div>
        )}

        {panel === 'type' && (
          <TypesetterPanel prefs={prefs} onPaper={onPaper} onFace={onFace} onSize={onSize} onLeading={onLeading} onFlow={onFlow} onClose={closePanel} />
        )}
        {panel === 'toc' && (
          <ContentsPanel
            toc={toc} chapterHref={chapterHref} ribbons={ribbons} showRibbons={ribbonsOn}
            currentRibbonId={currentRibbon?.id || null} pageOf={pageOf}
            onJump={jumpTo} onRemoveRibbon={removeRibbonFromList} onClose={closePanel}
          />
        )}
        {panel === 'search' && (
          <SearchPanel query={searchQuery} setQuery={setSearchQuery} results={searchResults} truncated={searchTruncated} searching={searching} onPick={pickResult} onClose={closePanel} />
        )}

        {showFurniture && resumeToast && (
          <div className={'rr-resume-toast ' + (toastFading ? 'out' : 'in')}>Continue where you left off 🏝️</div>
        )}

        {showFurniture && earlyEnding && renderEnding && pct > 90 && (
          <button type="button" className="rr-early" onClick={() => setEnded(true)}>{earlyEnding}</button>
        )}

        {/* Cover splash. A one-way gate: once opened it never returns, so the frame it
            gates can only ever mount, never unmount. */}
        {coverPending && (
          <div className="rr-cover" onClick={() => setCoverPending(false)}>{coverSplash}</div>
        )}

        {ended && renderEnding && (
          <div className="rr-end-wrap">{renderEnding({ close: () => setEnded(false) })}</div>
        )}
      </div>
    </>
  );
}
