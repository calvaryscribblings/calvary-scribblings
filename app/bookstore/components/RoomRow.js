'use client';
// ONE ROW, TWO ROOMS — Desiderata's list and Search's TITLES group. W22 §5, §6.
//
// The book is the shop's own small book: BoundBook, at the row's width, registered in
// BOOK_SURFACES as 'room'. No third rendering of a cover exists anywhere, and none is made
// here. Its tap turns the book and back, the shop's one grammar; the TITLE is the link.
//
// Desiderata adds BUY · price (the existing BuyButton, the checkout already proven — ruling 79–81:
// no basket before a real two-book purchase works on both rails) and the filled disc. Search
// shows the row bare, with its matches lit in gold.

import Link from 'next/link';
import BoundBook, { BOUND_BOOK_CSS } from './BoundBook';
import BuyButton from './BuyButton';
import { DesiderataMark } from './Desiderata';
import { formatCatalogueNumber } from './fields';
import { highlightParts } from '../../lib/searchIndex';

/** Text with the query's matches in gold. No query, no spans. */
export function Lit({ text, query }) {
  if (!query) return text;
  return highlightParts(text, query).map((p, i) => (p.hit ? <span key={i} className="rm-hit">{p.text}</span> : p.text));
}

export function RoomRow({ title, genre, query = '', shop = false }) {
  const cat = formatCatalogueNumber(title.catalogueNumber);
  return (
    <div className={`rr-row${shop ? ' rr-shop' : ''}`} data-testid="room-row" data-title-id={title.id}>
      <div className="rr-book">
        <BoundBook title={title} variant="shelf" width="var(--rr-book)" hoverable={false} />
      </div>
      <div className="rr-text">
        <div className="rr-kicker"><Lit text={genre} query={query} />{cat ? ` · ${cat}` : ''}</div>
        <Link className="rr-title" href={`/bookstore/${title.slug}`}><Lit text={title.title} query={query} /></Link>
        <div className="rr-author"><Lit text={title.author} query={query} /></div>
      </div>
      {shop && (
        <div className="rr-actions">
          <span className="rr-buy-slot"><BuyButton title={title} className="rr-buy" /></span>
          <DesiderataMark title={title} size="room" marked />
        </div>
      )}
    </div>
  );
}

// ── THE ROW'S NUMBERS — the canvas's, 641px and up, then the app's at 640 and below ────────
// ⚠ Template literal: no backticks in these comments.
export const ROOM_ROW_CSS = `
  ${BOUND_BOOK_CSS}
  .rm-hit{color:#c9a44c}
  .rr-row{--rr-book:64px;display:grid;grid-template-columns:var(--rr-book) minmax(0,1fr) auto;grid-template-areas:"book text actions";
    column-gap:28px;align-items:center;min-height:128px;border-bottom:1px solid rgba(201,164,76,.1)}
  .rr-book{grid-area:book;display:flex;justify-content:center}
  .rr-text{grid-area:text;display:flex;flex-direction:column;gap:5px;min-width:0}
  .rr-kicker{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,164,76,.6)}
  .rr-title{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:22px;line-height:26px;color:rgba(240,234,216,.92);text-decoration:none}
  .rr-title:hover{text-decoration:underline;text-decoration-color:rgba(201,164,76,.45);text-underline-offset:3px}
  .rr-author{font-style:italic;font-size:16px;line-height:20px;color:rgba(240,234,216,.5)}
  .rr-actions{grid-area:actions;display:flex;align-items:center;gap:16px}
  .rr-buy-slot{display:flex;flex-direction:column;align-items:flex-end}
  /* BUY: the existing BuyButton in the room's class — the book page's .bd-cta face at .64rem and
     .16em, padded 12px 20px, at least 128px wide so every row's button is the same width. The
     livery is .bd-buy's, stated again because the book page's stylesheet is not on this page. */
  .rr-buy{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:128px;
    font-family:'Cinzel',serif;font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;font-weight:600;line-height:1.5;
    padding:12px 20px;border:1px solid transparent;border-radius:3px;cursor:pointer;font-style:normal;
    background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;transition:filter .25s,opacity .25s}
  .rr-buy:hover{filter:brightness(1.08)}
  .rr-buy:disabled{cursor:progress;opacity:.6;filter:none}
  .rr-buy[data-unavailable]{cursor:not-allowed;opacity:.55;background:none;border-color:rgba(201,164,76,.28);color:rgba(240,234,216,.55)}
  /* The disc, 16px after BUY. On the canvas the disc's button is a 44px box with the 28px disc
     centred in it and a -8px right margin, "so the disc's edge meets the column's edge" — the
     same box here, so the canvas's 16px and -8px mean what they meant there. */
  .rr-actions .ds-room{width:44px;height:44px;justify-content:center;align-items:center;margin-right:-8px}
  .rr-actions .ds-room::before{width:44px;height:44px}
  @media(max-width:640px){
    .rr-row{--rr-book:56px;grid-template-columns:var(--rr-book) minmax(0,1fr);grid-template-areas:"book text" "book actions";
      column-gap:18px;min-height:112px;padding-block:14px;align-content:center}
    .rr-text{gap:4px}
    .rr-kicker{font-size:7.5px;line-height:10px;letter-spacing:1.8px}
    .rr-title{font-size:20px;line-height:23px}
    .rr-author{font-size:15px;line-height:18px}
    /* CHOSEN: the app shows no BUY, so the canvas has no phone row. BUY and the disc move under
       the author line, left-aligned with the text, 16px apart as DRAWN — so here the disc is its
       28px face, with the 44px target around it as a pseudo-element. The 12px above the pair
       and the 14px of row padding are chosen too. */
    .rr-actions{justify-content:flex-start;margin-top:12px}
    .rr-buy-slot{align-items:flex-start}
    .rr-actions .ds-room{width:auto;height:auto;margin:0}
  }
`;
