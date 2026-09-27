'use client';
// THE READERS LINE, THE +, AND THE GLYPHS OF THE SHOP'S ROOMS — W22.
//
// Ikenna's rulings of 27 Sept 2026 (74–81, 88), drawn from the canvas "Book Store rooms":
//
//   · under every book on the shelf, the count and then the + (ShelfReadersRow)
//   · the same + on the book's page, after its readership line (PageMark)
//   · the filled disc in Desiderata's own rows
//   · the two circles at the right of the shop's bar — Search and Desiderata
//
// The state machine is app/lib/bookstore/desiderata.js; the live list is desiderataStore.js.
// This file draws. Every number below is the canvas's, and where one was CHOSEN rather than
// derived it says so. ⚠ The CSS is a template literal: no backticks inside its comments.

import { createContext, useContext, useEffect, useState } from 'react';
import AuthModal from '../../components/AuthModal';
import { readershipShort } from '../../lib/bookstore/readership';
import { markState, drawsMark, isOnSale, markLabel } from '../../lib/bookstore/desiderata';
import {
  useDesiderata, addToDesiderata, removeFromDesiderata, rememberPendingAdd,
} from '../../lib/bookstore/desiderataStore';

// ── THE RECORD ─────────────────────────────────────────────────────────────────────────────
export const READERS_UNIT = {
  ruledBy: 'Ikenna', on: '2026-09-27', canvas: 'Book Store rooms',
  // The shelf.
  ringPx: 20, plusPx: 9, plusStroke: 1.4, tickStroke: 1.7,
  ringBorder: 'rgba(201,164,76,.55)',
  bookToRingPx: 10,          // from the book's DRAWN bottom edge to the ring's top
  countToRingPx: 8,          // from the count's last letter to the ring's edge
  hitPx: 44,
  // The book's page.
  pageRingPx: 28, pagePlusPx: 12, pagePlusStroke: 1.25, pageTickStroke: 1.5,
  pageLetterToRingPx: 11.5,
  // CHOSEN, not on the canvas: the air between a count that has taken its own line and the ring.
  stackGapPx: 4,
  // The perspective overhang. BoundBook turns the board -9deg under a 1600px perspective with
  // its origin at 42% of the height, so the near bottom corner comes forward by (w/2)sin9deg and
  // is drawn LOWER than the box by 0.58 * 1.5w * z / (1600 - z). That is w-squared, which calc()
  // cannot multiply, so it is fitted linearly over the widths a shelf book takes (80-200px):
  // 1.2037cqw - 0.7932px, within 0.10px of exact everywhere in that range.
  overhangCqw: 1.2037, overhangPx: -0.7932,
};

// WHERE A UNIT STACKS. "If a unit is wider than its column, the count takes its own line above
// the ring." The decision is made per COLUMN WIDTH (a container query), not per book, because
// the row's height must be the same for every book in a row. The width is the widest label the
// shelf will print for a long while — "999 READERS" at the phone's 6.4px/1.2px, measured 56.20px
// in the browser — less its trailing 1.2px of tracking, plus the 8px and the 20px ring: 83.0px.
// A 390 phone's column is 106px and a 360's is 96, so neither stacks; a 320's is 82.67, so it
// does. A four-digit count ("1,204 READERS", 88.4px) would overflow a 321-337px phone's column
// — recorded as open in the W22 report, not engineered for today.
export const READERS_STACK_BELOW_PX = 83;

// The capitals' centre sits .05em ABOVE the centre of a Cinzel line box: ascent .976, cap
// height .704, content box 1.348 (measured in the browser, W22): .5lh - (.976 - .352 - .674)em.
// So a line box's caps centre is at .5lh - .05em from its top, at any line-height.
const CINZEL_CAPS_LIFT_EM = 0.05;
// Half of Cinzel's cap height (.704em): the capitals' centre, measured up from the baseline.
const CINZEL_CAP_HALF_EM = 0.352;

// ── GLYPHS ─────────────────────────────────────────────────────────────────────────────────
const stroke = (w) => ({ fill: 'none', stroke: 'currentColor', strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round' });

export function Magnifier({ size, width }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...stroke(width)}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.1 15.1 L20.2 20.2" />
    </svg>
  );
}

export function Ribbon({ size, width }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...stroke(width)}>
      <path d="M6.5 3.75 H17.5 Q18.25 3.75 18.25 4.5 V20.25 L12 16.1 L5.75 20.25 V4.5 Q5.75 3.75 6.5 3.75 Z" />
    </svg>
  );
}

function Plus({ size, width }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false" {...stroke(width)}>
      <path d="M6 1.25 V10.75 M1.25 6 H10.75" />
    </svg>
  );
}

function Tick({ size, width }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false" {...stroke(width)}>
      <path d="M2.8 6.3 L5 8.4 L9.2 3.8" />
    </svg>
  );
}

// ── THE + ──────────────────────────────────────────────────────────────────────────────────
//
// One button, three sizes. `inert` is the CMS preview: it draws, and does nothing.
export function DesiderataMark({ title, size = 'shelf', marked, inert = false, className = '' }) {
  const d = useDesiderata({ enabled: !inert });
  const [showAuth, setShowAuth] = useState(false);
  const big = size !== 'shelf';
  const glyph = marked
    ? <Tick size={big ? READERS_UNIT.pagePlusPx : READERS_UNIT.plusPx} width={big ? READERS_UNIT.pageTickStroke : READERS_UNIT.tickStroke} />
    : <Plus size={big ? READERS_UNIT.pagePlusPx : READERS_UNIT.plusPx} width={big ? READERS_UNIT.pagePlusStroke : READERS_UNIT.plusStroke} />;

  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (inert) return;
    if (!d.user) { rememberPendingAdd(title.id); setShowAuth(true); return; }
    if (d.status !== 'ready') return;
    if (marked) removeFromDesiderata(title.id);
    else addToDesiderata(title.id);
  };

  return (
    <>
      <button
        type="button"
        className={`ds-mark ds-${size}${marked ? ' is-marked' : ''} ${className}`}
        aria-label={markLabel(title.title, !!marked)}
        aria-pressed={!!marked}
        onClick={onClick}
        tabIndex={inert ? -1 : undefined}
        aria-hidden={inert || undefined}
        data-inert={inert || undefined}
        data-testid="desiderata-mark"
      >
        <span className="ds-mark-face">{glyph}</span>
      </button>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}

// ── THE SHELF'S READERS ROW ────────────────────────────────────────────────────────────────
//
// The storefront provides the counts. With NO provider — the CMS's placed-context preview —
// the row still draws, the + alone and inert, so the curator sees the shelf's true geometry.
export const ShelfReadersContext = createContext({ preview: true, counts: {}, countsReady: true });

export function ShelfReadersRow({ title }) {
  const ctx = useContext(ShelfReadersContext);
  const preview = !!ctx.preview;
  const d = useDesiderata({ enabled: !preview });
  const listsIn = preview || d.status === 'ready' || d.status === 'signed-out';
  // DRAWS ONCE: when the counts, and the reader's lists if signed in, are all in. Until then the
  // row holds its height and draws nothing, so nothing on the shelf moves when it arrives.
  const ready = ctx.countsReady && listsIn;
  // ⚠ THE FADE IS FOR A LATE ARRIVAL ONLY — the brief's "fades in with no movement" meets R27's
  // ruling that the shelf arrives finished. "Late" means after the row has been PAINTED, not
  // after it mounted: counts that land a microtask after mount still draw on the shelf's first
  // frame, and a fade there is exactly what R27 cut. So the row notes when it has been on screen
  // (two animation frames), and the unit fixes its mode ONCE, the render it first draws in: on
  // the first frame (the counts beat the paint, or a genre-tab switch remounted the entry) it is
  // simply there; only after that does it fade in. Fixed once, so it can never start a fade
  // later. tests/bookstore/shelf-arrival.spec.mjs holds the R27 half.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setPainted(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, []);
  const [unitMode, setUnitMode] = useState(null); // null until the unit first draws
  if (ready && unitMode === null) setUnitMode(painted ? 'late' : 'now');
  const count = preview ? 0 : (ctx.counts[title.id] || 0);
  const label = readershipShort(count);
  const state = markState({
    owns: !preview && d.status === 'ready' && d.owned.has(title.id),
    onSale: isOnSale(title),
    marked: !preview && d.status === 'ready' && title.id in d.entries,
  });
  const mark = drawsMark(state);
  return (
    <div className="rd-row" data-testid="readers-row" data-state={ready ? state : 'waiting'}>
      {ready && (label || mark) && (
        <div className={`rd-unit${label ? '' : ' rd-alone'}${unitMode === 'late' ? ' rd-late' : ''}`} data-testid="readers-unit">
          {label && <span className="rd-count" data-testid="readers-count">{label}</span>}
          {mark && <DesiderataMark title={title} size="shelf" marked={state === 'marked'} inert={preview} />}
        </div>
      )}
    </div>
  );
}

// ── THE BOOK PAGE'S + ──────────────────────────────────────────────────────────────────────
//
// After the readership line, on the same line — and the line's TEXT does not move: the line
// itself is still rendered by page-detail.js, unconditionally, and this only hangs the ring off
// its box. With no line (`alone`), the ring stands by itself with its drawn left edge on the
// credits' left edge, where the line would have begun. Owned, or not on sale: nothing.
export function PageMark({ title, alone = false }) {
  const d = useDesiderata();
  const listsIn = d.status === 'ready' || d.status === 'signed-out';
  const state = markState({
    owns: d.status === 'ready' && d.owned.has(title.id),
    onSale: isOnSale(title),
    marked: d.status === 'ready' && title.id in d.entries,
  });
  if (!listsIn || !drawsMark(state)) return null;
  const slot = (
    <span className={`bd-mark-slot${alone ? ' is-alone' : ''}`}>
      <DesiderataMark title={title} size="page" marked={state === 'marked'} />
    </span>
  );
  if (!alone) return slot;
  return (
    <div className="bd-readership" data-testid="readership-mark-alone">
      <span className="bd-readership-text is-empty">{'\u200b'}{slot}</span>
    </div>
  );
}

// ── THE STYLESHEET ─────────────────────────────────────────────────────────────────────────
const U = READERS_UNIT;
export const DESIDERATA_CSS = `
  /* The + itself. The drawn face is the button; the 44px hit area is a pseudo-element around
     it, so the target grows and the drawing does not move. */
  .ds-mark{position:relative;display:inline-flex;flex:none;padding:0;margin:0;border:0;background:none;
    font:inherit;color:#c9a44c;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .ds-mark::before{content:'';position:absolute;left:50%;top:50%;width:${U.hitPx}px;height:${U.hitPx}px;
    transform:translate(-50%,-50%)}
  .ds-mark-face{display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-radius:50%;
    border:1px solid ${U.ringBorder};transition:background-color .18s,border-color .18s,color .18s}
  .ds-mark.is-marked .ds-mark-face{background:#c9a44c;border-color:#c9a44c;color:var(--ds-ground,#070707)}
  .ds-mark:focus-visible{outline:none}
  .ds-mark:focus-visible .ds-mark-face{outline:2px solid #c9a44c;outline-offset:3px}
  .ds-mark[data-inert]{cursor:default;pointer-events:none}
  .ds-shelf .ds-mark-face{width:${U.ringPx}px;height:${U.ringPx}px}
  .ds-page .ds-mark-face,.ds-room .ds-mark-face{width:${U.pageRingPx}px;height:${U.pageRingPx}px}
  @media(hover:hover){.ds-mark:not(.is-marked):hover .ds-mark-face{border-color:#c9a44c;background:rgba(201,164,76,.08)}}

  /* ── THE SHELF'S ROW ─────────────────────────────────────────────────────────────────────
     Between the book and the genre line, on every catalogue shelf and curated table. It is
     ALWAYS there at a fixed height, drawn or not, so the genre lines stay level across a row
     and nothing moves when the unit arrives.

     ${U.bookToRingPx}px from the book's DRAWN bottom edge to the ring's top: the box's bottom plus the
     perspective overhang (see READERS_UNIT). The 1.1rem of air the book used to carry now sits
     under the ring. */
  .shelf-entry{container-type:inline-size}
  .shelf-entry .shelf-book-wrap{margin-bottom:0}
  .rd-row{position:relative;width:100%;height:${U.ringPx}px;display:flex;justify-content:center;align-items:flex-start;
    margin:calc(${U.bookToRingPx}px + max(0px, ${U.overhangCqw}cqw ${U.overhangPx < 0 ? '-' : '+'} ${Math.abs(U.overhangPx)}px)) 0 1.1rem}
  .rd-unit{display:flex;align-items:flex-start}
  .rd-unit.rd-late{animation:rd-in .32s ease-out both}
  @keyframes rd-in{from{opacity:0}to{opacity:1}}
  @media(prefers-reduced-motion:reduce){.rd-unit.rd-late{animation:none}}
  /* The count. Its line box is the ring's height, so the two share a centre — then LOWERED by
     the .05em by which a Cinzel line's capitals sit above its centre. The trailing letter-spacing is
     handed back, so the 8px is measured from the last letter and the unit is centred on its
     letters rather than on a space nobody can see. */
  .rd-count{display:block;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;text-transform:uppercase;
    color:rgba(201,164,76,.7);line-height:${U.ringPx}px;white-space:nowrap;position:relative;top:${CINZEL_CAPS_LIFT_EM}em;
    margin-right:calc(${U.countToRingPx}px - .2em)}
  @media(max-width:640px){
    /* The app's shelf, number for number: Cinzel 6.4px, 1.2px tracking. */
    .rd-count{font-size:6.4px;letter-spacing:1.2px;margin-right:calc(${U.countToRingPx}px - 1.2px)}
  }
  /* A unit wider than its column: the count takes its own line above the ring, both centred.
     A container query, not a per-book decision, so every book in a row makes the same choice
     and the genre lines stay level. The threshold is READERS_STACK_BELOW_PX. */
  @container (max-width:${READERS_STACK_BELOW_PX - 0.02}px){
    .rd-row{height:calc(${U.ringPx}px + ${U.stackGapPx}px + 1.5 * 6.4px)}
    .rd-unit{flex-direction:column;align-items:center;gap:${U.stackGapPx}px}
    .rd-count{line-height:1.5;top:0;margin-right:-1.2px}
  }

  /* ── THE BOOK PAGE ───────────────────────────────────────────────────────────────────────
     The readership line keeps its type, its 1.6rem and its place to the pixel. Its text is now
     an inline-block, and the ring hangs off the text's own BASELINE: the slot is a zero-size
     inline-block that follows the last letter, and a zero-size inline-block's bottom IS the
     baseline, so it adds nothing to the line box. The ring is placed from there — its centre
     half a cap-height (.352em, Cinzel's .704 / 2) above the baseline, which is where the
     capitals' centre is in every engine, whatever it does with half-leading. (Predicting the
     baseline from the line-height instead was 0.5-0.8px out in Chromium, which floors the
     half-leading; the ink probe in tests/bookstore/rooms.spec.mjs found it.)
     Horizontally: ${U.pageLetterToRingPx}px after the last letter — the slot starts after the last
     letter's advance and its trailing .24em of tracking, so that tracking is handed back. */
  .bd-readership{font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.24em;text-transform:uppercase;
    color:rgba(201,164,76,.55);margin-top:1.6rem}
  .bd-readership-text{display:inline-block}
  .bd-mark-slot{display:inline-block;width:0;height:0;vertical-align:baseline;position:relative;letter-spacing:0}
  .bd-mark-slot > .ds-mark{position:absolute;left:calc(${U.pageLetterToRingPx}px - .24em);bottom:calc(${CINZEL_CAP_HALF_EM}em - ${U.pageRingPx / 2}px)}
  .bd-mark-slot.is-alone > .ds-mark{left:0}
  /* Alone, the line is a zero-width space that only lends the slot a baseline; no tracking on it,
     so the ring's drawn left edge is the credits' left edge. */
  .bd-readership-text.is-empty{letter-spacing:0}
`;
