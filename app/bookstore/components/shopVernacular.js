// THE SHOP'S VERNACULAR — the classes both the storefront and the CMS preview draw with.
//
// A stylesheet and nothing else, on the BOUND_BOOK_CSS / CURRENCY_SELECTOR_CSS precedent: a
// consuming page interpolates it once and every instance on that page shares it.
//
// ⚠ IT IS ITS OWN MODULE AND NOT PART OF CuratedSection.js, DELIBERATELY. These are the
// SHOP's classes, which means they include .entry-price and .entry-price-note — the storefront
// has printed a price on every shelf entry since R8.3. CuratedSection.js is new furniture the
// app will port, and the app cannot carry money; keeping the stylesheet separate is what lets
// that component stay literally free of the word, asserted by
// tests/bookstore/sections.test.mjs, instead of free of it apart from a carve-out.
//
// These rules lived inside app/bookstore/page.js's inline <style> until R13. They are moved
// here, unchanged, for one reason: the CMS preview needs them, and the first version of the
// Sections panel got them by RETYPING them into its own stylesheet. That worked, and it was
// wrong in the way this whole component exists to prevent — a preview whose CSS is a copy of
// the shop's is a preview that will one day disagree with the shop about what a shelf looks
// like, and nobody will notice until a curator arranges something that renders differently
// once it is live. (It did disagree, immediately: the copy kept the catalogue's grid, so a
// curated shelf of two sat left-justified under a centred head in the panel and centred on
// the shop.)
//
// Both surfaces now interpolate this one string. The storefront also keeps its own hero,
// rail, colophon and grain rules inline — those are the page's, not the vernacular's, and
// the preview has no use for them.
//
// ⚠ CLASS NAMES ARE GLOBAL. The admin screens style themselves with inline objects and use
// no class names at all, so injecting this there collides with nothing. If that ever stops
// being true, scope it rather than rename anything here — the names are the shop's.
// ═════════════════════════════════════════════════════════════════════════════════════════
// R25 — THE SHOP'S VERTICAL RHYTHM
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 27 August 2026: the web storefront has black voids between its elements —
// "check it against the app's perfect sizing and measurements." The app is the approved
// reference. These four values are the web's answer to it, and they are HERE, in the shop's
// vernacular, because the rhythm spans three stylesheets: this one (.catalogue-section),
// CURATED_SECTION_CSS (.curated-section) and app/bookstore/page.js's inline block (.hero,
// .the-window, .rail). One record, one :root block derived from it, three readers.
//
// ── WHY THE OLD NUMBERS WERE WHAT THEY WERE ────────────────────────────────────────────────
//
// Every padding this replaces dates from `e1e8baf7`, "Bookstore R4b", 14 July 2026 — with two
// later touches (.curated-section from R13 and the catalogue's handset padding from R15, both
// 19 August). On 14 July the shop stood on a VIOLET RADIAL GRADIENT over a three-stop vertical
// ramp, and from R20 on an animated grain over that. Large intervals on a textured ground read
// as atmosphere: the eye has something to look at between two sections.
//
// R22.1 removed the last of it on the MORNING of 27 August. The ground is now flat #070707.
// The same intervals on flat black have nothing in them, which is exactly the complaint: the
// spacing was never retuned for the ground it now sits on. That is the whole history, and it
// is why this is a retune and not a preference.
//
// ── WHAT WAS ACTUALLY MEASURED, on the built export ────────────────────────────────────────
//
// The void beneath the masthead was not a section gap at all. `.hero` carried
// `min-height:88vh` with `align-items:center`, so the leftover viewport was split in half and
// HALF OF IT SAT BELOW THE CURRENCY LINE — 219.06px at 402x874, 177.70 at 402x780, 126.67 at
// 390x664, 164.80 at 1280x800, 208.80 at 1440x900. A void that changes size with the device is
// why the page reads differently on every phone. On top of it sat .the-window's 64px of
// padding, for 283.06px total against the app's ~40.
//
// ⭑ AND NOTHING IS FAILING TO RENDER. Every element above the shelf with height was scanned
// for one with no text, no image and nothing painted: there are none. The web has no
// early-access line under the catalogue line — the app does, and the web has 219px of reserved
// viewport there instead. Empty space, not a broken element.
export const SHOP_RHYTHM = {
  ruledBy: 'Ikenna',
  on: '2026-08-27',
  ruling: 'The web storefront has black voids between elements. Check it against the app\'s sizing.',

  // The fixed .cs-nav is 68px tall (app/components/Navbar.js) and the storefront's <main> has
  // NO padding-top — the masthead was cleared from the bar only by the 88vh centring slack.
  // Remove the slack without stating this and the shop's title slides under the navigation.
  navClearPx: 68,

  // ⚠ A WEB JUDGEMENT CALL, FLAGGED. The app witnesses phone and tablet and gives no figure
  // for the air ABOVE the masthead; the web's own was never a chosen number either — it was
  // half of whatever the viewport had left over (219 at 874, 127 at 664). This makes it a
  // stated constant, the same at every width, which is itself the fix for a masthead that sat
  // differently on every device. 148px total (68 + 80) is close to what a 1280x800 laptop
  // already showed (164.78) and 71px tighter than a tall phone.
  headAir: '5rem',        // 80px

  // The masthead sits DOWN ONTO the first case. The app's measured figure, exactly: the
  // currency line and the Window's plate are one head, not two sections.
  headClose: '2.5rem',    // 40px

  // Half a join. Two adjacent sections each pay their half, so a section join is 4.5rem/72px.
  // The app's measured button-to-heading figure is ~75 once its own reserved slot is set
  // aside; 72 is the nearest value on a 0.25rem scale and is used at EVERY join above the
  // shelf, so the shop has one interval and not four.
  sectionAir: '2.25rem',  // 36px

  // What the joins come to, for the harness and for anyone reading this without a browser.
  get headClosePx() { return 40; },
  get sectionJoinPx() { return 72; },
};

// Declared once, on :root, inside the vernacular — because the vernacular is the string BOTH
// surfaces inject (the storefront and /admin/bookstore's Sections preview), so a rule in any
// of the three stylesheets can read these and neither surface can get a different rhythm.
export const SHOP_RHYTHM_CSS = `
  :root{
    --shop-nav-clear:${SHOP_RHYTHM.navClearPx}px;
    --shop-head-air:${SHOP_RHYTHM.headAir};
    --shop-head-close:${SHOP_RHYTHM.headClose};
    --shop-section-air:${SHOP_RHYTHM.sectionAir};
  }
`;

export const SHOP_VERNACULAR_CSS = `
  ${SHOP_RHYTHM_CSS}
  .section-head{display:flex;align-items:center;gap:1.2rem;margin-bottom:2.5rem}
  .section-rule{flex:1;height:1px;background:rgba(201,164,76,.12)}
  .section-mark{font-size:.7rem}
  .section-title{font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.3em;text-transform:uppercase;color:#c9a44c;font-weight:600}

  /* R13 — .curated-case and .curated-lamp are GROUPED ONTO the window's rules rather than
     described again. The display case is one look and it has one description; two cases that
     must be identical and are written down twice will eventually be written down
     differently. The curated case differs only in its interior padding. */
  .window-case,.curated-case{position:relative;border:1px solid rgba(201,164,76,.2);background:radial-gradient(ellipse 70% 60% at 50% 0%,rgba(201,164,76,.06),transparent 70%),rgba(255,255,255,.015);padding:3.5rem 3rem}
  .curated-case{padding:2.75rem 2.5rem}
  .window-lamp,.curated-lamp{position:absolute;top:-1px;left:20%;right:20%;height:120px;background:radial-gradient(ellipse 60% 100% at 50% 0%,rgba(201,164,76,.18),transparent 72%);pointer-events:none}
  .fleuron-corner{position:absolute;color:rgba(201,164,76,.4);font-size:.9rem}
  .fleuron-corner.tl{top:.7rem;left:.9rem}.fleuron-corner.tr{top:.7rem;right:.9rem}
  .fleuron-corner.bl{bottom:.7rem;left:.9rem}.fleuron-corner.br{bottom:.7rem;right:.9rem}

  .window-kicker{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.22em;text-transform:uppercase;color:#c9a44c;margin-bottom:.8rem}
  .window-title{font-family:'Cinzel',serif;font-size:clamp(1.5rem,3vw,2.2rem);font-weight:600;color:#f0ead8;line-height:1.12;margin-bottom:.35rem}
  .window-author{font-size:1.05rem;font-style:italic;color:rgba(240,234,216,.5);margin-bottom:1.3rem}
  .window-pull{font-size:1.05rem;font-style:italic;line-height:1.6;color:rgba(240,234,216,.78);border-left:2px solid rgba(201,164,76,.35);padding-left:1.1rem;margin-bottom:1.2rem}
  .window-shelfcard{font-size:.92rem;line-height:1.6;color:rgba(240,234,216,.6);background:rgba(236,228,207,.06);border:1px solid rgba(201,164,76,.15);padding:.85rem 1.1rem;margin-bottom:1.5rem}
  .window-shelfcard span{font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.12em;color:#c9a44c}
  .btn-details{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(240,234,216,.55);text-decoration:none;border-bottom:1px solid rgba(201,164,76,.25);padding-bottom:2px}

  /* ── THE SHELF'S RHYTHM, AS TWO TOKENS ────────────────────────────────────────────────
     R15 — the grid's gaps were two literals here and two more inside the storefront's phone
     media query. They are now named, because the interleave below has to be a MULTIPLE of the
     row gap and a multiple of a literal you cannot see is an eyeballed number wearing a calc().
     Declared on BOTH selectors in one rule: .shelf so any shelf anywhere carries its own
     rhythm, .catalogue-section so a curated table standing BETWEEN two shelf runs — a sibling
     of the grid, not a child of it — can still read the same value. One declaration, one pair
     of numbers, two places that need them. */
  .shelf,.catalogue-section{--shelf-row-gap:3.5rem;--shelf-col-gap:1.5rem}
  /* ── THREE ACROSS, EVERYWHERE ──────────────────────────────────────────────────────────
     R16, Ikenna's ruling of 19 Aug 2026 ratifying the app's storefront as the house design:
     three books per row at every viewport, and the book sized from the column it lands in.

     ⚠ WHAT WAS HERE, AND IT WAS NOT AN ACCIDENT. The rule this replaces was
         repeat(auto-fill,minmax(180px,1fr))   with minmax(150px,1fr) under 640px
     — a MEASURED rule: 180px was the point at which a 150px book plus its shelf card stopped
     crowding, and the handset override existed because 180 would have given a 390px phone one
     book per row. It worked and it is being replaced, not corrected. What it could not do is
     hold a count: it gave two on a phone, four on a laptop and five on a wide desktop, so the
     shelf had a different rhythm on every machine and no fixed unit for a curator to think in.
     Three is now that unit, and it is the same three everywhere.

     minmax(0,1fr) rather than 1fr: a bare 1fr floors at min-content, and a long unbroken title
     in .entry-title would then push a column wider than its third and put four-across geometry
     on a three-across shelf. */
  .shelf{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--shelf-row-gap) var(--shelf-col-gap);justify-items:center}
  .shelf-entry{display:flex;flex-direction:column;align-items:center;text-align:center;width:100%;max-width:200px;animation:fadeUp .5s ease forwards}
  /* THE BOOK IS THE COLUMN. BoundBook takes a CSS length, so the shelf hands it 100% and the
     cover is whatever a third of the shelf is — about 106px on a 390px handset, and 200px on a
     laptop, where .shelf-entry's own long-standing cap stops a third of 1040px from becoming a
     330px book that would out-scale the display case. No number is introduced here: the cap is
     the one the entry has carried since R4b. */
  .shelf-book-wrap{margin-bottom:1.1rem;width:100%}
  .no-divider{display:flex;align-items:center;gap:.6rem;width:100%;margin-bottom:1rem}
  .no-line{flex:1;height:1px;background:rgba(201,164,76,.14)}
  .no-label{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(201,164,76,.6)}
  .entry-genre{font-family:'Cormorant Garamond',Georgia,serif;font-size:.55rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#c9a44c;margin-bottom:.3rem}
  .entry-title{font-size:.92rem;font-weight:600;color:#f0ead8;line-height:1.28;margin-bottom:.15rem}
  .entry-author{font-family:'Cormorant Garamond',Georgia,serif;font-size:.76rem;font-style:italic;color:rgba(240,234,216,.45);margin-bottom:.4rem}
  .entry-price{font-family:'Cormorant Garamond',Georgia,serif;font-size:.85rem;font-weight:600;color:#f0ead8}
  .entry-price-note{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;
    font-size:.72rem;line-height:1.4;color:rgba(240,234,216,.42);margin-top:.1rem}
  /* ── THE SLIM SHELF TICKET ─────────────────────────────────────────────────────────────
     R16 — the app's ratified ticket, in the web's own measurements. It was a 190px-capped card
     that ran to whatever length the curator wrote; it is now 92% of the column, centred and
     tucked under the book, with the note clamped to two lines.

     ⚠ THE CLAMP IS A SHELF DECISION AND ONLY A SHELF DECISION. The full note is printed
     untruncated on the title's own page (.bd-shelfcard) and in the Window (.window-shelfcard),
     and tests/bookstore/shelf-ticket.test.mjs fails if either surface starts clamping the
     other's copy. A shelf shows you there is a card; the page shows you what is on it.

     TYPE, FROM THE BOARD'S OWN HIERARCHY — no new sizes were invented:
       the note        .72rem — the rung the back cover's opening quote sits on
       the attribution .5rem  — the rung the catalogue mark sits on
       the floor       .42rem — the smallest floor the storefront already uses (the obi's)
     Both runs are fluid against the ticket's own width, so the ratio holds as the column
     changes: .72rem at the 184px ticket a 200px column gives is 6.26cqw, .5rem is 4.35cqw.

     ⚠ ON A PHONE BOTH RUNS SIT ON THE FLOOR and are therefore the SAME SIZE — a 106px column
     gives a 97px ticket, where 6.26cqw and 4.35cqw are both below .42rem. That is accepted,
     not overlooked: at that width the hierarchy is carried by FACE AND COLOUR instead — the
     note in italic Cormorant on the card's own ink, the attribution in Cinzel small-caps,
     letter-spaced, in the muted gold-brown. Size is one signal and it is the first to run out. */
  .shelf-card{width:92%;margin:1rem auto 0;container-type:inline-size;background:#ece4cf;color:#2a2318;
    padding:.5rem .6rem;border-radius:1px;box-shadow:0 6px 18px rgba(0,0,0,.4);line-height:1.42}
  .shelf-card-body{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
    font-style:italic;font-size:max(.42rem,6.26cqw)}
  .shelf-card-sign{display:block;margin-top:.35rem;font-family:'Cinzel',serif;
    font-size:max(.42rem,4.35cqw);letter-spacing:.12em;color:#7a5f24}

  /* ═══ THE CATALOGUE ═════════════════════════════════════════════════════════════════════
     R15 — these four moved out of app/bookstore/page.js's inline stylesheet for exactly the
     reason .shelf moved in R13: the CMS preview now draws the REAL CatalogueSection around a
     placed table, so a preview that got its own copy of these rules would be a picture of a
     shop that does not exist. Same string, both surfaces, nothing retyped. */
  .catalogue-section{position:relative;z-index:2;max-width:1120px;margin:0 auto;padding:var(--shop-section-air) 2.5rem}
  .genre-tabs{display:flex;overflow-x:auto;margin-bottom:3rem;scrollbar-width:none;border-bottom:1px solid rgba(255,255,255,.06)}
  .genre-tabs::-webkit-scrollbar{display:none}
  .genre-tab{padding:.7rem 1.3rem;white-space:nowrap;font-family:'Cormorant Garamond',Georgia,serif;font-size:.75rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,234,216,.45);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s}
  .genre-tab:hover{color:#f0ead8}
  .genre-tab.active{color:#c9a44c;border-bottom-color:#c9a44c}
  .shelf-empty{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:1.05rem;color:rgba(240,234,216,.4);text-align:center;padding:2rem 0}

  /* ── THE INTERLEAVE, AND ITS AIR ────────────────────────────────────────────────────────
     A curated table standing in the middle of a shelf has one job to do before it says
     anything: it has to read as a CHANGE OF KIND rather than as another row of books. On a
     phone the failure mode is specific and ugly — the shelf is one book wide, so a head
     arriving between two covers with a row's worth of air above it looks like a caption that
     lost its cover, or a row that failed to load.

     The shelf already states what a change of ROW is worth: --shelf-row-gap. So the table
     takes exactly TWICE it, above and below. That is the smallest multiple that cannot be
     mistaken for the gap it sits beside, it is derived from the grid rather than chosen
     against a screenshot, and it shrinks with the grid on a handset (3.5rem → 2.75rem, so
     7rem → 5.5rem) without a second breakpoint being written anywhere.

     The section's OWN vertical padding is zeroed, not added to. .curated-section's 3.5rem was
     calibrated for a table standing alone between other standalone sections; inside the shelf
     flow the run above is the neighbour, and stacking both paddings would push the table so
     far from the books that it stops reading as part of the same shelf. Its horizontal padding
     and max-width go too, so the head's rules span the same width as the grid above them —
     a narrower table reads as an embed, not as part of the shop. */
  .catalogue-interleave{padding:calc(var(--shelf-row-gap) * 2) 0}
  .catalogue-interleave > .curated-section{max-width:none;margin:0;padding:0}

  @media(max-width:640px){
    /* R16 — the grid-template-columns override that lived here is gone with the auto-fill rule
       it corrected: three columns need no handset variant, which was half the point of fixing
       the count. The gap tokens stay, and R15's doubled interleave air still derives from them.

       R25 — ONLY THE HORIZONTAL PADDING IS A BREAKPOINT NOW. This used to read
       "padding:3rem 1.25rem", which quietly made the shop's vertical rhythm 48px on a handset
       and 64px on a laptop — two rhythms, neither of them written down. The vertical air is
       --shop-section-air at every width; the gutter still narrows, because a gutter is about
       the width of the screen and an interval is not. */
    .shelf,.catalogue-section{--shelf-row-gap:2.75rem;--shelf-col-gap:1rem}
    .catalogue-section{padding-inline:1.25rem}
  }
`;
