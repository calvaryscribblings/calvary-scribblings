'use client';
// BoundBook — renders a title as a physical book object: front cover, spine hinge,
// RIGHT fore-edge page block, printed back cover, obi band, optional ribbon, contact shadow.
// All motion lives in CSS (BOUND_BOOK_CSS) so a consuming page injects the stylesheet ONCE
// and every instance shares it — no N copies. Reduced motion is handled entirely in CSS via
// prefers-reduced-motion (no resting angle, no transitions).
//
// R17.3 — THE BOOK CARRIES ITS OWN GESTURE. It used to be presentational, taking `flipped`,
// `bind` and `bookRef` from whatever wrapped it, and exactly one surface wrapped it: the
// shelf's ShelfBook. The Window's book and the book in a curated case were rendered directly
// and had no handler at all, so they were dead objects on a shop where every other book turns
// over on tap. See BOOK_SURFACES below for the whole argument and the register.
import Image from 'next/image';
import { useBookGesture } from './useBookGesture';
import { resolveOpeningLine, resolveBackBlurb, gradientFor, obiLabel, formatCatalogueNumber } from './fields';
import { useCurrency, useRegionCountry, priceLine } from '../../lib/currency';

// ═════════════════════════════════════════════════════════════════════════════════════════
// R16 — FEET OFF THE BOOK
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 19 August 2026, ratifying the app's storefront refinements as the house
// design:
//
//   "The book is a clean graphic object. Take the feet off — the bottom page block goes,
//    everywhere it renders, the Window included. That is the Masobe direction."
//
// ⚠ "REMOVE THE BOTTOM BLOCK" IS ONE EDIT AWAY FROM "REMOVE THE PAGE BLOCK", and that is why
// this constant exists rather than a deleted line and a silence. There were two page-edge
// elements and only one of them went. Everything in `keeps` below is still drawn, and
// tests/bookstore/boundbook.test.mjs asserts this record in BOTH directions: the removed one
// is gone from the stylesheet and from the DOM, and every kept one is still in both.
export const BOTTOM_PAGE_BLOCK_REMOVED = {
  ruledBy: 'Ikenna',
  on: '2026-08-19',
  ruling: 'The book is a clean graphic object. Take the feet off — the bottom page block goes, everywhere it renders, the Window included.',
  // The element as it stood, kept verbatim so the shadow derivation below can be read against
  // it and so a restoration is a copy rather than a reconstruction.
  removedClass: 'bb-foreedge-b',
  removedCss: 'position:absolute;left:2.5%;right:2.5%;bottom:-8px;height:8px;transform:translateZ(-5px);z-index:1;background:repeating-linear-gradient(0deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);border-radius:0 0 3px 3px',
  // THE NUMBER THE SHADOW MOVED BY. The feet hung exactly this far below the book's box, and
  // CONTACT_SHADOW_REBASE below is the same 8px travelling in the opposite direction. If the
  // feet are ever restored, these two move back together or the pool doubles.
  removedDropPx: 8,
  // Everything the ruling did NOT touch. Asserted present, individually, by name.
  keeps: [
    'bb-foreedge',   // the RIGHT fore-edge — the page block that stays, and its 12px minimum
    'bb-spine',      // the spine hinge, on both faces
    'bb-obi',        // the obi band, granted only by a live Editor's Choice claim
    'bb-ribbon',     // the gilt ribbon
    'bb-back',       // the printed back face
    'bb-book',       // the flip itself
  ],
  // The right fore-edge's width is part of the silhouette the ruling kept, so it is pinned
  // here rather than left to be "tidied" alongside the removal.
  foreEdgeMinWidthPx: 12,
};

// ═════════════════════════════════════════════════════════════════════════════════════════
// R16 — THE CONTACT SHADOW, REBASED BY DERIVATION
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// THE THING THE EYE READS is the pool of shadow visible BELOW the object's silhouette. Not
// the shadow's box, and not the front face's own drop shadow (8px 14px 46px), which paints
// some fifty pixels further down, is attached to the face, and does not move when the feet do.
//
// BEFORE the removal, the silhouette's lowest paint WAS the feet, and the contact shadow was
// positioned against them: `bottom:-16px` on a book whose feet ended at -8px, so the pool
// extended 8px past the lowest thing the book put on the ground.
//
// Removing the feet raises the silhouette by that 8px. Leaving the shadow where it was would
// have left the pool 8px deeper — measured at 17.1px against 9.5px on the 150px shelf book —
// and the book would read as hovering. So the shadow moves up by exactly the drop the feet
// occupied, and the pool it leaves is the pool it always left.
//
// MEASURED, both sides, on the real page at deviceScaleFactor 4, with the contact shadow
// isolated DIFFERENTIALLY — the identical frame rendered twice, once with .bb-shadow
// suppressed, and the difference read down the book's centre. That isolation is the whole
// method: without it the probe reads the front face's drop shadow, which paints some fifty
// pixels below the book, does not move when the feet do, and would drown the signal.
//
// The two call sites whose SIZE did not change this round are the controlled comparison:
//
//                       silhouette below box     visible pool below the silhouette
//   window      190px   +9.00  →  +1.55          8.86px  →  8.31px    (−0.55)
//   curated case 170px  +8.75  →  +1.24          8.79px  →  9.43px    (+0.64)
//
// (The 150px shelf book is not in that table on purpose: the same round resized it to its
// column, so its before and after are not the same object. Its BEFORE is where the 8px came
// from — silhouette +8.54, pool 9.52px.)
//
// The residual is the one honest imperfection and it is written down rather than rounded
// away. The feet sat at translateZ(-5px) and the shadow sits at translateZ(-40px), so under
// the 1600px perspective the same 8px of CSS travel renders as 7.98px there and 7.81px here;
// and the required travel is itself size-dependent — 7.58px at 150, 7.45px at 190, 7.35px at
// 220 — because the perspective origin sits at 42% of a height that changes. No single CSS
// rule is exact at every size. Both measured residuals are inside two thirds of one CSS pixel,
// which is the price of a number that can be re-derived from the ruling rather than fitted to
// a screenshot.
export const CONTACT_SHADOW_REBASE = {
  wasBottomPx: -16,
  isBottomPx: -8,
  // …because the silhouette rose by exactly this, which is BOTTOM_PAGE_BLOCK_REMOVED.removedDropPx.
  raisedByPx: 8,
  measuredPoolBefore: { window190: 8.86, curatedCase170: 8.79, shelf150: 9.52 },
  measuredPoolAfter: { window190: 8.31, curatedCase170: 9.43 },
  // The guard tests/bookstore/boundbook.spec.mjs uses: the pool may not drift further than
  // this from its pre-removal depth on a call site whose size did not change.
  tolerancePx: 1,
};

// Injected once per page (storefront, detail, modal). Keyed classes only — no dynamic values.
export const BOUND_BOOK_CSS = `
  /* R16 — THE BOOK IS SIZED BY ITS CONTAINER, NOT BY A NUMBER PASSED IN.
     --bb-w is the one input: a length from the caller (the Window's 190px, the detail page's
     220px) or 100% for a shelf book, which then takes the width of its column. Everything the
     component used to derive in JS from that number — the height, the ribbon, two font sizes —
     is derived here instead, in container-query units against this element's own width, so a
     percentage works exactly as a pixel value does.
     THE RATIOS ARE THE OLD ONES, unchanged:
       height    = w * 1.5           → aspect-ratio 2/3
       ribbon    = height * .32      = w * .48    → 48cqw
       obi type  = max(.42rem, w/320 rem)         → 5cqw  (16px at w=320)
       cover type= max(.62rem, w/190 rem)         → 8.421cqw (16px at w=190)
     The floors stay in rem so a reader who scales their type still gets the floor; the fluid
     half is in cqw and does not scale with it. That asymmetry is deliberate — a floor is a
     legibility promise, a ratio is a drawing. */
  .bb-persp{--bb-w:160px;container-type:inline-size;position:relative;
    width:var(--bb-w);aspect-ratio:2/3;
    perspective:1600px;perspective-origin:50% 42%;
    touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
  .bb-book{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateY(-9deg);
    transition:transform .95s cubic-bezier(.2,.72,.16,1);will-change:transform}
  .bb-book.bb-flipped{transform:rotateY(-178deg) translateY(-16px) scale(1.045)}
  .bb-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;
    border-radius:2px 5px 5px 2px;overflow:hidden}
  .bb-front{background:#0e0a16;box-shadow:8px 14px 46px rgba(0,0,0,.8),0 0 0 1px rgba(201,164,76,.1),inset -5px 0 12px rgba(0,0,0,.42)}
  .bb-back{transform:rotateY(180deg);background:#ece4cf;color:#2a2318;
    box-shadow:8px 14px 46px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.2),inset 5px 0 12px rgba(0,0,0,.14)}
  .bb-spine{position:absolute;top:0;bottom:0;left:0;width:13px;z-index:4;pointer-events:none;
    background:linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.2) 34%,rgba(255,255,255,.09) 50%,rgba(0,0,0,.22) 66%,rgba(0,0,0,.34) 100%)}
  .bb-back .bb-spine{left:auto;right:0;transform:scaleX(-1)}
  .bb-foreedge{position:absolute;top:2.5%;bottom:2.5%;right:-11px;width:12px;transform:translateZ(-7px);z-index:1;
    border-radius:0 2px 2px 0;background:repeating-linear-gradient(90deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);
    box-shadow:1px 2px 6px rgba(0,0,0,.5)}
  /* .bb-foreedge-b — THE FEET — is gone. See BOTTOM_PAGE_BLOCK_REMOVED at the head of this
     file for the ruling, the element verbatim, and the 8px the shadow below moved by. The
     RIGHT fore-edge one line above it stays, and stays 12px wide. */
  .bb-grain{position:absolute;inset:0;pointer-events:none;opacity:.06;mix-blend-mode:overlay;
    background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 2px),
      repeating-linear-gradient(90deg,rgba(255,255,255,.4) 0,rgba(0,0,0,.4) 1px,transparent 1px,transparent 3px)}
  .bb-sheen{position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(122deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.04) 26%,transparent 46%)}
  /* R16 — bottom was -16px, against a silhouette whose lowest paint was the feet at -8px.
     The feet went, so it rises by the same 8px and the pool it leaves below the book is the
     pool it always left. Nothing else about it changes: same size, same blur, same falloff,
     same z. See CONTACT_SHADOW_REBASE for the measurement on both sides. */
  .bb-shadow{position:absolute;left:7%;right:7%;bottom:-8px;height:24px;z-index:0;filter:blur(5px);
    transform:translateZ(-40px);background:radial-gradient(ellipse at center,rgba(0,0,0,.6) 0%,transparent 72%)}
  .bb-obi{position:absolute;left:0;right:0;bottom:9%;z-index:5;pointer-events:none;
    font-size:max(.42rem,5cqw);
    background:linear-gradient(180deg,#ece4cf,#ddd2b4);color:#2a2318;
    border-top:1px solid rgba(0,0,0,.14);border-bottom:1px solid rgba(0,0,0,.14);
    box-shadow:0 3px 10px rgba(0,0,0,.35);padding:.34em .1em;text-align:center;
    font-family:'Cinzel',serif;text-transform:uppercase;letter-spacing:.14em;font-weight:600}
  .bb-ribbon{position:absolute;top:-4px;right:15%;width:15px;height:48cqw;z-index:6;pointer-events:none;
    background:linear-gradient(180deg,#e8c877,#a8842f);box-shadow:0 3px 8px rgba(0,0,0,.5)}
  .bb-ribbon::after{content:'';position:absolute;left:0;right:0;bottom:-7px;height:8px;
    background:linear-gradient(180deg,#c9a44c,#a8842f);clip-path:polygon(0 0,100% 0,100% 100%,50% 55%,0 100%)}
  .bb-foil{background:linear-gradient(135deg,#f4e2a6 0%,#c9a44c 42%,#8f6d24 62%,#e8c877 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
  /* R17.3 — the cursor is on EVERY book, because every book now answers a press. The LIFT is
     still only on the surfaces that always had it: that is a look, and no ruling moved it. */
  .bb-book{cursor:pointer}
  @media (hover:hover){
    .bb-hoverable .bb-book:not(.bb-flipped):hover{transform:rotateY(-9deg) translateY(-9px)}
  }
  /* The fallback cover's foil title. Was Math.max(0.62, width/190) in rem, computed per
     instance; the same curve, in the container's own units. */
  .bb-cover-title{font-family:'Cinzel',serif;font-weight:600;font-size:max(.62rem,8.421cqw);
    line-height:1.2;margin-bottom:.5rem;letter-spacing:.02em}
  .bb-barcode{display:flex;gap:1px;align-items:flex-end;height:26px}
  .bb-barcode i{display:block;width:2px;background:#2a2318}
  @media (prefers-reduced-motion: reduce){
    .bb-book,.bb-book.bb-flipped{transition:none}
    .bb-book{transform:none}
    .bb-book.bb-flipped{transform:rotateY(180deg)}
    .bb-hoverable .bb-book:not(.bb-flipped):hover{transform:none}
  }
`;

// Varying bar widths for the faux barcode — deterministic (index-seeded), no randomness.
const BAR_WIDTHS = [2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 1, 2];

// R9.2 PL-20 — THE COVER'S alt IS EMPTY ON PURPOSE, and it is not an omission.
//
// The cover is decorative at every one of BoundBook's three call sites, because all three
// print the title as adjacent text: app/bookstore/page.js:76 (.entry-title on the shelf),
// :148 (.window-title in the window) and app/bookstore/[slug]/page-detail.js:268 (the <h1>).
// BackFace below prints it a fourth time. alt={title.title} therefore made a screen reader
// announce the same book twice in a row — once as an image, once as a heading — on a shelf
// of them. app/my-library/page.js:78 always had this right; this now matches it.
//
// IF A FOURTH CALL SITE EVER RENDERS A COVER WITH NO TITLE BESIDE IT, this has to change with
// it: alt="" on the only carrier of the name is a silent image, which is worse than the
// duplicate. tests/bookstore/gate.spec.mjs pins both halves for the shelf and the detail page.
function FrontFace({ title, sizes }) {
  const hasCover = !!title.coverUrl;
  return (
    <div className="bb-face bb-front">
      {hasCover ? (
        <Image src={title.coverUrl} alt="" fill unoptimized sizes={sizes} style={{ objectFit: 'cover' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: gradientFor(title.slug || title.title), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.4rem 1rem', textAlign: 'center' }}>
          <div className="bb-foil bb-cover-title">{title.title}</div>
          <div style={{ width: '30px', height: '1px', background: 'rgba(232,200,119,.5)', margin: '.2rem 0 .5rem' }} />
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.62rem', letterSpacing: '.08em', color: 'rgba(240,234,216,.5)' }}>{title.author}</div>
        </div>
      )}
      <div className="bb-spine" />
      <div className="bb-grain" />
      <div className="bb-sheen" />
    </div>
  );
}

function BackFace({ title }) {
  const [currency] = useCurrency();
  const opening = resolveOpeningLine(title);
  const blurb = resolveBackBlurb(title);
  // R8.3: the effective price, and the mark when it is not the one being browsed in. The
  // back face is printed matter — cream stock, brown ink — so the mark takes its muted tone
  // from THAT palette rather than from the dark shelf's.
  // R8.4: and no price at all when the book is not licensed here, because a price printed on a
  // back cover is the strongest claim the shop makes that a sum of money will buy this book.
  const country = useRegionCountry();
  const { price, note } = priceLine(title, currency, country);
  const cat = formatCatalogueNumber(title.catalogueNumber);
  return (
    <div className="bb-face bb-back">
      <div className="bb-spine" />
      <div style={{ position: 'absolute', inset: 0, padding: '11% 12% 9% 15%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: '#5a4a2a', marginBottom: '.6rem' }}>{title.title}</div>
        {opening && (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.72rem', lineHeight: 1.5, color: '#3a3020', marginBottom: '.55rem' }}>&ldquo;{opening}&rdquo;</div>
        )}
        {blurb && (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.66rem', lineHeight: 1.55, color: 'rgba(42,35,24,.72)', flex: 1, overflow: 'hidden' }}>{blurb}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '.5rem', marginTop: 'auto', paddingTop: '.6rem' }}>
          {cat !== null ? (
            <div>
              <div className="bb-barcode" aria-hidden="true">
                {BAR_WIDTHS.map((w, i) => <i key={i} style={{ width: `${w}px`, height: `${16 + ((i * 7) % 10)}px` }} />)}
              </div>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.5rem', letterSpacing: '.1em', color: '#2a2318', marginTop: '2px' }}>{cat}</div>
            </div>
          ) : <span />}
          {/* R8.4 — the mark no longer hangs off the price. A territory-restricted title has
              NO price to print (priceLine withholds it) and yet is exactly the case that most
              needs its line, so the block renders for either. */}
          {(price || note) && (
            <div style={{ textAlign: 'right' }}>
              {price && (
                <>
                  <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 700, fontSize: '.82rem', color: '#2a2318' }}>{price}</div>
                  <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.44rem', letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(42,35,24,.6)' }}>ebook</div>
                </>
              )}
              {/* R8.3. Brown ink on cream stock, not the shelf's vellum-on-black — the back
                  face is printed matter and the mark has to belong to it. */}
              {note && (
                <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.52rem', color: 'rgba(42,35,24,.62)', marginTop: '1px' }}>{note}</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="bb-grain" />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// R17.3 — EVERY BOOK ON THE SHOP TURNS OVER, AND THE HANDLER LIVES WHERE THEY SHARE IT
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// THE DEFECT, from the walk of the live site: a book on the shop grid flipped on tap; the book
// in the Window and the book in a curated case did not. One shop, two grammars, and no reason
// a reader could infer — the same object, drawn by the same component, answering a tap on one
// shelf and ignoring it on another.
//
// THE CAUSE was not a missing handler at those two sites. It was WHERE the handler lived. The
// gesture sat in a wrapper — `ShelfBook` in app/bookstore/page.js — that called useBookGesture
// and spread the result into BoundBook as `flipped` / `bind` / `bookRef`. Exactly one surface
// used that wrapper. Every other surface rendered BoundBook directly and therefore got a book
// with no listeners, which looks completely correct in review: the props were optional and the
// JSX read fine.
//
// ⚠ SO THE FIX IS NOT "CALL useBookGesture IN THREE MORE PLACES". Three copies of a gesture is
// three places for a fourth surface to be forgotten, and forgetting is exactly what happened.
// The handler moved INTO THIS COMPONENT, and the three props that let a caller supply its own
// were REMOVED rather than left as an override. That is the whole guarantee: there is no way
// to render a BoundBook without a gesture, because there is no longer a prop that turns one
// off. A fourth surface added next year gets the flip whether or not anyone remembers to.
//
// ── WHAT A TAP LEADS TO, PER SURFACE ─────────────────────────────────────────────────────
//
// The FLIP is universal. What the flip leads INTO is the surface's own way in, and there are
// only two answers: the storefront's Quick Look, or back to the front cover. A surface passes
// `onOpen` when it has a modal to open; useBookGesture turns the book back when it has not, so
// a book is never left face-down with nothing to press.
//
// ── ACCESSIBILITY, STATED PLAINLY BECAUSE IT IS A GAP AND NOT A DESIGN ───────────────────
//
// The grid's gesture was pointer-only — touchstart/move/end, contextmenu, click, on a plain
// <div> with no tabIndex, no role and no key handler. Moving it here carries that to the other
// surfaces IDENTICALLY, which is what was asked, and identically is also the honest word for
// it: keyboard users could not flip a book before this change and cannot flip one now.
//
// What saves it from being a content gap is that THE FLIP IS DECORATIVE FOR ASSISTIVE TECH.
// Both faces are in the DOM at all times — backface-visibility hides a face from the eye, not
// from the accessibility tree — so the back cover's opening line, blurb, catalogue mark and
// price are announced on every surface whether or not the book has been turned. The flip shows
// a sighted reader something a screen reader already had.
//
// tests/bookstore/flip.spec.mjs asserts the parity as a PROPERTY rather than a level: every
// surface's book carries the same attribute set. If the grid ever gains a real keyboard
// affordance, the suite fails until the others have it too.
export const BOOK_SURFACES = {
  ruledOn: '2026-08-20',
  ruling: 'One interaction grammar: every BoundBook on the shop flips on tap, whatever surface holds it.',
  // The register. A `<BoundBook` call site anywhere in the tree that is not listed here fails
  // tests/bookstore/flip.test.mjs — which is how a fourth surface is stopped from shipping a
  // dead book quietly. `opens` is what a completed tap leads to.
  surfaces: [
    { key: 'shelf',        file: 'app/bookstore/page.js',                    component: 'ShelfEntry',   opens: 'quick-look' },
    { key: 'window',       file: 'app/bookstore/page.js',                    component: 'TheWindow',    opens: 'quick-look' },
    { key: 'curated-case', file: 'app/bookstore/components/CuratedSection.js', component: 'CuratedCase', opens: 'quick-look' },
    // The detail page IS the quick look. A modal repeating the page you are standing on is not
    // a way in, so the book turns back instead — the gesture is the same, its destination is
    // the only honest difference.
    { key: 'detail',       file: 'app/bookstore/[slug]/page-detail.js',      component: 'BookDetailClient', opens: 'turns-back' },
  ],
  // The props that USED to let a caller own the gesture. Their absence is the guarantee, so
  // they are named here and asserted absent rather than simply deleted and forgotten.
  retiredProps: ['flipped', 'bind', 'bookRef'],
};

/**
 * @param width   a CSS length. A NUMBER is pixels, exactly as it always was — the Window's 190,
 *                the curated case's 170, the detail page's 220 all pass one and render at the
 *                same size they always have. A STRING is used verbatim, which is how a shelf
 *                book takes the width of its column: `width="100%"`. Everything the component
 *                used to compute off the number is now derived in CSS from the element's own
 *                width, so the two forms cannot diverge. See the note on .bb-persp.
 * @param onOpen  (title, rect, reset) => void. The surface's way in, called after the back
 *                cover has breathed. OMIT IT and the book turns back instead — see
 *                BOOK_SURFACES. It is not a switch for the gesture; there isn't one.
 */
export default function BoundBook({ title, variant = 'shelf', width = 160, ribbon, onOpen, hoverable }) {
  // `reset` is referenced by the callback before the destructuring completes, and that is fine:
  // the callback cannot run until a finger has been on the glass. Same shape ShelfBook used.
  const { flipped, bind, bookRef, reset } = useBookGesture({ onOpen: onOpen ? (rect) => onOpen(title, rect, reset) : undefined });
  const cssWidth = typeof width === 'number' ? `${width}px` : width;
  const showRibbon = ribbon ?? variant === 'window';
  const obi = obiLabel(title);
  // The HOVER LIFT stays where it already was — it is a look, and no ruling moved it. The
  // POINTER CURSOR is a different thing and now applies to every book, because every book is
  // now pressable and a pressable object that says otherwise is the discoverability bug this
  // round exists to fix. See .bb-book / .bb-hoverable in the stylesheet.
  const canHover = hoverable ?? (variant === 'shelf' || variant === 'detail');
  // Inert while next/image is `unoptimized` (no srcset is emitted), and correct the moment it
  // is not. A fixed book states its pixels; a column-width one states the columns.
  const sizes = typeof width === 'number' ? `${width}px` : '(max-width:640px) 33vw, 200px';

  return (
    <div className={'bb-persp' + (canHover ? ' bb-hoverable' : '')} style={{ '--bb-w': cssWidth }} {...bind}>
      <div className="bb-shadow" />
      <div ref={bookRef} className={'bb-book' + (flipped ? ' bb-flipped' : '')}>
        {/* The RIGHT fore-edge. The bottom one was removed by R16 — see
            BOTTOM_PAGE_BLOCK_REMOVED at the head of this file. */}
        <div className="bb-foreedge" />
        <FrontFace title={title} sizes={sizes} />
        <BackFace title={title} />
        {showRibbon && <div className="bb-ribbon" />}
        {obi && <div className="bb-obi">{obi}</div>}
      </div>
    </div>
  );
}
