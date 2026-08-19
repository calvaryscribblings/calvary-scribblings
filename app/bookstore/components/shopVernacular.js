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

  .shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:3.5rem 1.5rem;justify-items:center}
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
`;
