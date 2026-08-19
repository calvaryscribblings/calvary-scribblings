'use client';
// THE CURATED SECTION — the shop's own furniture, drawn once for two screens.
//
// ── ONE COMPONENT, TWO CONSUMERS, AND THAT IS THE POINT ──────────────────────────────────
//
// app/bookstore/page.js renders this over the live claims. app/admin/bookstore's Sections
// panel renders THE SAME COMPONENT over the claims currently being edited. A preview drawn
// by a second component would be a mock-up of the shop, and the first time the two drifted
// the curator would be arranging a shelf that does not exist. There is nothing to drift.
//
// ── THE GRAMMAR DOES NOT VARY. THE GEOMETRY DOES ─────────────────────────────────────────
//
// Every section is the same three things in the same order:
//
//   1. a HEAD — rule · fleuron · gold Cinzel small-caps · fleuron · rule. Byte-for-byte the
//      `.section-head` the Fiction and Non-Fiction heads have used since R4b, because a new
//      kind of section is still a section and the shop only has one way of saying so.
//   2. an optional CURATOR'S LINE — italic Cormorant, muted, centred under the head. The
//      curator's own sentence, in the voice the shelf cards and the curation band already
//      speak in.
//   3. the CLAIM — a CASE when the section features one book, a SHELF when it lists several.
//
// ── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────────────────────
//
// No badge. No chip. No pill. No "recommended", "trending", "because you read", "picked for
// you", no count of anything. Ikenna's ruling was Masobe's merchandising in this shop's
// grammar and NEVER its chrome, and the tell for chrome is that it sounds like a machine
// said it. A claim here is a sentence a person wrote and a book they chose.
//
// ⚠ AND NO MONEY. Not one price, not one buy button, not the word purchase — see THE MONEY
// WALL at the foot of this file. tests/bookstore/sections.test.mjs greps this file for it.

import BoundBook from './BoundBook';
import { resolveOpeningLine, formatCatalogueNumber } from './fields';

// ── The rank mark ────────────────────────────────────────────────────────────────────────
//
// A ranked Top of the Shelf numbers its books ROMAN, in Cinzel, in the same divider slot the
// catalogue mark ("CS 003") occupies on an ordinary shelf entry — a rule, a small-caps label,
// a rule. Arabic numerals in a gold circle is the chip this round refuses to draw; a roman
// numeral set in the shop's own display face reads as a curator's order, which is what it is.
// Capped at ten by SECTION_TYPES, so the table stops where the numerals stop being legible.
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function rankMark(i) {
  return ROMAN[i] || String(i + 1);
}

function Fleuron({ style }) {
  return <span style={{ color: 'rgba(201,164,76,.5)', ...style }}>&#10086;</span>;
}

/**
 * The head. `.section-head` and `.section-title` are the storefront's existing classes and
 * are not redefined here — CURATED_SECTION_CSS below adds only what is new.
 */
function SectionHead({ title, curatorLine, monthLabel }) {
  return (
    <>
      <div className="section-head">
        <span className="section-rule" />
        <span className="section-mark"><Fleuron /></span>
        <h2 className="section-title">{title}</h2>
        <span className="section-mark"><Fleuron /></span>
        <span className="section-rule" />
      </div>
      {/* The month, BY NAME. It sits with the head rather than beside the book, because it
          qualifies the claim and not the title: "Book of the Month · August 2026" is one
          sentence about one month, and the book is what the sentence is about. */}
      {monthLabel && <div className="curated-month">{monthLabel}</div>}
      {curatorLine && <p className="curated-line">{curatorLine}</p>}
    </>
  );
}

/**
 * THE CASE — one book, on a plate.
 *
 * The same treatment as the Window's display case, sharing its declarations rather than
 * copying them: CURATED_SECTION_CSS groups `.curated-case` onto the `.window-case` rules that
 * already exist in page.js's stylesheet. Two cases that must look identical and are described
 * twice will eventually be described differently.
 *
 * WHAT IT IS NOT is the Window. The Window has a plate reading "In the Window", a ribbon, a
 * shelf card, a sample link and a buy button, and it is drawn by page.js's own TheWindow
 * component which this round did not touch. This is the plate treatment generalised for a
 * section that features one book — and it stops at the door of the money.
 */
function CuratedCase({ section, title, genreLabelFor }) {
  const pull = resolveOpeningLine(title);
  const mark = formatCatalogueNumber(title.catalogueNumber);
  return (
    <div className="curated-case">
      <span className="fleuron-corner tl">&#10086;</span>
      <span className="fleuron-corner tr">&#10086;</span>
      <span className="fleuron-corner bl">&#10086;</span>
      <span className="fleuron-corner br">&#10086;</span>
      <div className="curated-lamp" />
      <div className="curated-case-inner">
        <div className="curated-case-book">
          <BoundBook title={title} variant="window" width={170} ribbon={false} />
        </div>
        <div className="curated-case-copy">
          <div className="window-kicker">{mark ? `${mark} · ` : ''}{genreLabelFor(title.genre)}</div>
          <h3 className="window-title">{title.title}</h3>
          <p className="window-author">by {title.author}</p>
          {pull && <p className="window-pull">&ldquo;{pull}&rdquo;</p>}
          {title.shelfCard && <p className="window-shelfcard">{title.shelfCard} <span>&mdash; Calvary</span></p>}
          <div className="curated-actions">
            <a className="btn-details" href={`/bookstore/${title.slug}`}>Full details &rarr;</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * THE SHELF — several books, in the curator's order.
 *
 * `renderEntry` is injected rather than imported: ShelfEntry lives in page.js, carries the
 * gesture, the modal hand-off and the money, and importing it here would drag all three into
 * a module the CMS preview also mounts — and into the app's eventual port. The storefront
 * passes its own entry renderer; the CMS passes a quieter one. One shelf, two inks.
 */
function CuratedShelf({ section, renderEntry }) {
  return (
    <div className="shelf curated-shelf">
      {section.titles.map((t, i) => (
        <div className="curated-slot" key={t.slug}>
          {section.ranked && (
            <div className="no-divider"><span className="no-line" /><span className="no-label">{rankMark(i)}</span><span className="no-line" /></div>
          )}
          {renderEntry(t, i, { suppressMark: section.ranked })}
        </div>
      ))}
    </div>
  );
}

/**
 * @param section        one entry from resolveSections()
 * @param renderEntry    (title, index, opts) => node — the shelf's entry renderer
 * @param renderWindow   (title) => node — the Window's own component, injected for the same
 *                       reason as renderEntry: folding the Window into the system must not
 *                       mean redrawing it here.
 * @param genreLabelFor  (slug) => string, from the taxonomy. Never a local table.
 */
export default function CuratedSection({ section, renderEntry, renderWindow, genreLabelFor }) {
  // ⛔ THE RULE, restated at the last possible moment. resolveSections has already dropped
  // every section that must not render; this is the belt to that brace, and it is here so
  // that a caller which builds a section object by hand — the CMS preview does — cannot put
  // an empty one on a screen either.
  if (!section || !Array.isArray(section.titles) || section.titles.length === 0) return null;

  // The Window renders as the Window. Same component, same classes, same markup, same plate.
  if (section.layout === 'window') {
    return renderWindow ? renderWindow(section.titles[0]) : null;
  }

  return (
    <section className="curated-section" data-section-type={section.type} data-testid={`curated-${section.type}`}>
      <SectionHead title={section.displayTitle} curatorLine={section.curatorLine} monthLabel={section.monthLabel} />
      {section.layout === 'case'
        ? <CuratedCase section={section} title={section.titles[0]} genreLabelFor={genreLabelFor} />
        : <CuratedShelf section={section} renderEntry={renderEntry} />}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE STYLESHEET
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Injected once by whichever page mounts this, exactly like BOUND_BOOK_CSS and
// CURRENCY_SELECTOR_CSS. It adds ONLY what is new and reuses the storefront's classes for
// everything the shop already knows how to draw: `.section-head`, `.section-rule`,
// `.section-mark`, `.section-title`, `.shelf`, `.no-divider`, `.window-kicker`,
// `.window-title`, `.window-author`, `.window-pull`, `.window-shelfcard`, `.btn-details`,
// `.fleuron-corner`.
//
// ⚠ THE CASE'S OWN LOOK IS NOT DESCRIBED HERE EITHER. `.curated-case` is grouped onto
// `.window-case`'s declaration in page.js's stylesheet, and `.curated-lamp` onto
// `.window-lamp`'s, so the display case has exactly one description in this codebase. What
// follows is only what has no precedent: the month line, the curator's line, the slot, and
// the case's slightly tighter interior.
export const CURATED_SECTION_CSS = `
  .curated-section{position:relative;z-index:2;max-width:1000px;margin:0 auto;padding:3.5rem 2rem 2.5rem}
  .curated-month{text-align:center;font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.3em;
    text-transform:uppercase;color:rgba(201,164,76,.72);margin:-1.6rem 0 1.4rem}
  .curated-line{text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;
    font-size:1.02rem;line-height:1.65;color:rgba(240,234,216,.55);max-width:560px;margin:-1.2rem auto 2.2rem}
  .curated-month + .curated-line{margin-top:0}
  .curated-case-inner{position:relative;display:grid;grid-template-columns:auto 1fr;gap:3rem;align-items:center}
  .curated-case-book{display:flex;justify-content:center;padding:.5rem 1rem}
  .curated-actions{display:flex;gap:.9rem;flex-wrap:wrap;align-items:center;margin-top:.4rem}
  /* NOT the catalogue's grid, and the difference is the head above it.
     .shelf fills a row from the left because it is a CATALOGUE — everything the shop has, in
     rows. A curated section is a small set under a centred, fleuron-flanked head, and two
     books left-justified beneath a centred head read as a row that failed to load the rest.
     So the element keeps .shelf for the entry styling that comes with it, and this overrides
     the layout to a centred wrap.
     R16 — the catalogue went to three fixed columns and this did NOT follow it. The slot keeps
     its 200px, so a curated book is 200px wide: the same as a catalogue book at the widest the
     shelf goes, and on a handset a single large book per row rather than a third of one. That
     is the distinction, drawn deliberately — the catalogue is a shelf you walk past, a table is
     something you stop at. The ruling named the auto-fill grid; this was never it.
     R15 — the gap is the shelf's own two tokens rather than the literals that were here. The
     element carries .shelf as well as .curated-shelf, so the tokens resolve off itself and the
     phone override in the vernacular reaches it exactly as it always did. Before the tokens
     existed that only worked by accident of source order: the storefront's media query set
     .shelf{gap:2.75rem 1rem} AFTER this rule, so a curated shelf on a handset was being
     narrowed by a rule aimed at the catalogue grid. Same result now, on purpose.
     NOTE FOR ANYONE EDITING THIS BLOCK: it is inside a template literal. A backtick here
     terminates the string, and what survives is not a syntax error — it is a broken export
     that throws at render. This comment used to quote class names in backticks; the admin
     preview went blank and the page error was the stylesheet itself. */
  .curated-shelf{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;
    gap:var(--shelf-row-gap) var(--shelf-col-gap);max-width:920px;margin:0 auto}
  .curated-slot{display:flex;flex-direction:column;align-items:center;width:200px}
  .curated-slot .no-divider{margin-bottom:.85rem}
  @media(max-width:640px){
    .curated-section{padding:2.5rem 1.25rem 2rem}
    .curated-case-inner{grid-template-columns:1fr;gap:2rem;text-align:center}
    .curated-case-book{padding:0}
    .curated-case-inner .window-pull{border-left:none;padding-left:0}
    .curated-actions{justify-content:center}
  }
`;

// ═════════════════════════════════════════════════════════════════════════════════════════
// ⛔ THE MONEY WALL
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// This module is storefront FURNITURE, and the app will eventually port it. The app cannot
// carry price, buy or purchase language — that is a platform rule older than this round and
// it is not negotiable by a section that would look nicer with a price on it.
//
// So: no import of BuyButton, no import of currency.js, no formatPrice, no priceLine, and no
// literal price, buy, purchase or checkout string anywhere above. The CASE ends at "Full
// details →", which is a link to the page where money is allowed to be discussed.
//
// The SHELF is the interesting case and the reason `renderEntry` is a prop. The storefront
// passes its own ShelfEntry, which does print a price — it has since R8.3, on every shelf in
// the shop, and a curated shelf that silently dropped the price would be the odder screen.
// That price is the STOREFRONT's, injected by the storefront, and it does not live here.
// This file can be ported as it stands; whatever the app injects is the app's business.
//
// tests/bookstore/sections.test.mjs reads this source as text and fails on any of the above.
