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
export const SHOP_VERNACULAR_CSS = `
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
  .shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--shelf-row-gap) var(--shelf-col-gap);justify-items:center}
  .shelf-entry{display:flex;flex-direction:column;align-items:center;text-align:center;width:100%;max-width:200px;animation:fadeUp .5s ease forwards}
  .shelf-book-wrap{margin-bottom:1.1rem}
  .no-divider{display:flex;align-items:center;gap:.6rem;width:100%;margin-bottom:1rem}
  .no-line{flex:1;height:1px;background:rgba(201,164,76,.14)}
  .no-label{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(201,164,76,.6)}
  .entry-genre{font-family:'Cormorant Garamond',Georgia,serif;font-size:.55rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#c9a44c;margin-bottom:.3rem}
  .entry-title{font-size:.92rem;font-weight:600;color:#f0ead8;line-height:1.28;margin-bottom:.15rem}
  .entry-author{font-family:'Cormorant Garamond',Georgia,serif;font-size:.76rem;font-style:italic;color:rgba(240,234,216,.45);margin-bottom:.4rem}
  .entry-price{font-family:'Cormorant Garamond',Georgia,serif;font-size:.85rem;font-weight:600;color:#f0ead8}
  .entry-price-note{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;
    font-size:.72rem;line-height:1.4;color:rgba(240,234,216,.42);margin-top:.1rem}
  .shelf-card{margin-top:1rem;background:#ece4cf;color:#2a2318;padding:.75rem .9rem;border-radius:1px;box-shadow:0 6px 18px rgba(0,0,0,.4);font-size:.72rem;line-height:1.5;max-width:190px}
  .shelf-card-body{display:block;font-style:italic}
  .shelf-card-sign{display:block;margin-top:.4rem;font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.12em;color:#7a5f24}

  /* ═══ THE CATALOGUE ═════════════════════════════════════════════════════════════════════
     R15 — these four moved out of app/bookstore/page.js's inline stylesheet for exactly the
     reason .shelf moved in R13: the CMS preview now draws the REAL CatalogueSection around a
     placed table, so a preview that got its own copy of these rules would be a picture of a
     shop that does not exist. Same string, both surfaces, nothing retyped. */
  .catalogue-section{position:relative;z-index:2;max-width:1120px;margin:0 auto;padding:4rem 2.5rem}
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
    .shelf,.catalogue-section{--shelf-row-gap:2.75rem;--shelf-col-gap:1rem}
    .shelf{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
    .catalogue-section{padding:3rem 1.25rem}
  }
`;
