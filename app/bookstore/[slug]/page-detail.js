'use client';
import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { getTitleBySlug, getPublisherPublic } from '../../lib/bookstore/loader';
// R13 — the taxonomy, read as data. This used to import sectionForGenre from the storefront
// route AND keep its own byte-identical copy of GENRE_LABELS four lines below. Both are gone.
import { getGenres, getReadership } from '../../lib/bookstore/loader';
// R14 — the readership line. Pure, money-free and portable; see the module header.
import { readershipFor } from '../../lib/bookstore/readership';
import { genreLabel as labelOf, groupOf } from '../../lib/bookstore/genres';
import AuthorBlock, { AUTHOR_BLOCK_CSS } from '../components/AuthorBlock';
import Navbar from '../../components/Navbar';
import TabBar from '../../components/TabBar';
import BoundBook, { BOUND_BOOK_CSS } from '../components/BoundBook';
// R26 — the one place the detail board's width is written down. ./page.js reads it too, to
// tell the preload which rung this board will draw. See app/lib/bookstore/board.js.
import { DETAIL_BOARD_WIDTH } from '../../lib/bookstore/board';
import BuyButton from '../components/BuyButton';
import { truncate, formatCatalogueNumber } from '../components/fields';
import { useCurrency, useRegionCountry, priceLine, fallbackSentence } from '../../lib/currency';
import { TERRITORY_SENTENCE } from '../../lib/bookstore/territory';

// Both asides beneath the buy button — the currency one and the territory one — are the same
// object on purpose. They are one editorial register (a quiet qualification of the button
// above), they are mutually exclusive, and a reader who met them in different type would read
// the difference as meaning something.
const BUY_ASIDE_STYLE = {
  margin: 0,
  maxWidth: '34ch',
  fontFamily: 'Cormorant Garamond, Georgia, serif',
  fontSize: '.8rem',
  fontStyle: 'italic',
  lineHeight: 1.55,
  color: 'rgba(240,234,216,.5)',
};
import LaunchGate from '../components/LaunchGate';
import { isStoreUnlocked } from '../../lib/bookstore/gate';
// R20 — the grain, its ruling and its one definition. Superseded:
// R22.1 — the grain import is gone; the layer was ruled out entirely. The record lives
// at ../components/grain.js and is imported by nothing.
// R22C — the arriving half of the book's journey. One definition, both documents; see the
// header of that file for the mechanism and the timing window it has to land in.
// R22.1C — SHIPPED_BOOK_TRANSITION_CSS, not BOOK_TRANSITION_CSS. It is empty until
// BOOK_TRANSITION_SHIPPED is flipped; the built transition is intact in that file.
import { SHIPPED_BOOK_TRANSITION_CSS, BOOK_ARRIVAL_ATTR } from '../components/bookTransition';

// R13 — WHAT WAS HERE. A twelve-row GENRE_LABELS map whose comment read "kept local (the
// storefront's map isn't exported)", byte-identical to the storefront's and separately
// maintained. It is now a read of bookstore_genres, and the label the detail page prints is
// the same string the shelf it links back to prints, because it is the same record.
//
// The half-fallback in sectionLabel is preserved on purpose: groupOf() returns null for a
// genre missing from the taxonomy, and this page has always called that case Fiction rather
// than showing a broken breadcrumb. That is a link label, not a claim about the book.

// ISO date (YYYY-MM-DD) → long British form. Falls back to the raw string on parse failure.
function formatDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

function MetaItem({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.52rem', letterSpacing: '.24em', textTransform: 'uppercase', color: 'rgba(201,164,76,.55)', marginBottom: '.35rem' }}>{label}</div>
      <div style={{ fontSize: '.92rem', color: 'rgba(240,234,216,.78)' }}>{value}</div>
    </div>
  );
}

export default function BookDetailClient({ params, seed = null }) {
  const { slug } = use(params);
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'missing'
  const [title, setTitle] = useState(null);
  const [publisherName, setPublisherName] = useState(null);

  // Stripe sends the reader back here with ?purchase=success|cancelled. Read once, lazily,
  // at first client render — the same pattern as app/my-library/read/page.js, and for the
  // same reason: useSearchParams() needs a Suspense boundary and can push the route into a
  // client-side bailout under output:'export'. The server prerender has no location, hence
  // the guard. Reading it here rather than in an effect keeps the decision to a single
  // evaluation and avoids a cascading render.
  const [purchased] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('purchase') === 'success'; }
    catch { return false; }
  });

  // ── R8.1 THE CURTAIN ──────────────────────────────────────────────────────
  // Same three states and the same reasoning as the storefront (app/bookstore/page.js): the
  // export prerenders this component, so storage is read in an effect rather than during
  // render, and the gate stays mounted through the unlock so its lift has something to reveal.
  // A shared /bookstore/[slug] link — the reader's "View in the Book Store", a message from a
  // friend — meets the same curtain as the front door, which is the point of gating both.
  //
  // ⛔ R23 — THE BLANK BEFORE THE PAGE IS THIS GATE, AND IT IS NOT FIXABLE FROM HERE.
  //
  // Ikenna's recording of 27 Aug (iPhone Safari, live site) shows ~600ms of EMPTY PAGE between
  // the tap and any content at all. Measured against the built export the same shape appears,
  // faster: nothing is in the document until an effect has run.
  //
  // The cause is the line below and the `{detailReady && (...)}` that reads it. `unlocked`
  // starts false and is set from localStorage in an effect, and the WHOLE tree — Navbar, the
  // <style> block, the body — hangs off it. So there is nothing to paint until React has
  // mounted, run the effect and re-rendered. The stylesheet @import inside that gated block
  // cannot even begin to load before then, which is why the fonts arrive late too.
  //
  // ⛔ DO NOT ANSWER THIS WITH ANIMATION. R23 has just removed a 600ms fadeUp that was put on
  // the content below, and every one of the four things it was blamed for came from covering
  // an arrival rather than making one. A fade over a blank makes the blank longer and the
  // arrival mushier; it does not make the page come sooner.
  //
  // THE FIX IS R9's GATE REMOVAL — the same unwinding that lets the cover flight pair, because
  // a cross-document transition cannot snapshot a page that has not rendered. Until then this
  // blank is a known, named cost and not a bug to be decorated over.
  const [curtain, setCurtain] = useState('checking'); // 'checking' | 'up' | 'gone'
  const [unlocked, setUnlocked] = useState(false);
  const [genres, setGenres] = useState([]);
  // R14 — the public count. 0 until the read lands, and 0 renders nothing, so the line
  // fades in a beat after the page rather than reserving an empty row for itself.
  const [readership, setReadership] = useState(0);
  useEffect(() => {
    if (isStoreUnlocked()) { setUnlocked(true); setCurtain('gone'); }
    else setCurtain('up');
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      // getTitleBySlug filters suspended publishers but does NOT gate on status — enforce
      // published here (not found OR not published → notFound()). R3 logic, unchanged.
      const t = await getTitleBySlug(slug);
      if (cancelled) return;
      if (!t || t.status !== 'published') { setState('missing'); return; }
      setTitle(t);
      setState('ready');
      // R13 — the taxonomy. Twelve records of four fields, and it is fetched AFTER the title
      // rather than beside it: the page's whole reason to exist is on screen the moment `t`
      // lands, and a genre label that arrives a beat later is a word filling in, not a page
      // waiting. genreLabel falls back to the slug in the meantime, which is never seen for
      // long enough to read and is honest when it is.
      const g = await getGenres();
      if (!cancelled) setGenres(g);
      // R14 — one key of a public node, keyed by the RECORD KEY (t.id), which is what
      // bookstore_purchases is keyed by and therefore what the webhook counted against.
      // Deliberately not gated on sign-in: this is public data and a guest sees it.
      const r = await getReadership(t.id);
      if (!cancelled) setReadership(r);
      if (t.publisherId) {
        // R9.2 PL-11 — the PUBLIC getter. Only `name` is ever used here, and the merged
        // getPublisher() also reached for bookstore_publishers_private, which is
        // founder-read-only: a guaranteed permission-denied on every reader's book page.
        const pub = await getPublisherPublic(t.publisherId);
        if (!cancelled && pub?.name) setPublisherName(pub.name);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, unlocked]);

  // Strip the marker from the URL once it has been read, so a refresh or a shared link never
  // re-announces a purchase that already happened. Pure side effect on an external system —
  // it sets no state, because `purchased` above has already decided what to show.
  // 'cancelled' is stripped just as silently: the reader changed their mind, which is not an
  // error and does not deserve a notice.
  useEffect(() => {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    const purchase = params.get('purchase');
    if (purchase !== 'success' && purchase !== 'cancelled') return;
    params.delete('purchase');
    params.delete('session_id');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);

  // No early return on curtain === 'checking' any more — same change, same reasoning, as the
  // storefront (app/bookstore/page.js). The bar renders in every state, so blanking the tree
  // before storage has been read would drop it for a frame and ship a prerender without it.
  // Only reachable from behind the curtain — the fetch that can set 'missing' does not run
  // until `unlocked`, so a visitor without the key gets the gate rather than a 404.
  if (unlocked) { if (state === 'missing') notFound(); }

  const detailReady = unlocked;

  // R8.3. `title` is null until the fetch lands, and priceFor tolerates that — the sentence is
  // simply absent until there is a book to say it about.
  //
  // R8.4 — PRECEDENCE, RENDERED. priceLine has already decided which of the two facts governs;
  // this reads its answer rather than re-deriving it. `sellable` false means the currency
  // sentence is not merely hidden, it is NOT COMPUTED: `priced` is null, so fallbackSentence
  // has nothing to say and could not contradict the territory line even by accident. One
  // sentence beneath the button, ever.
  const [currency] = useCurrency();
  const country = useRegionCountry();
  const { priced, sellable } = priceLine(title, currency, country);
  const fallbackLine = fallbackSentence(priced, currency);

  const genreLabel = (g) => labelOf(genres, g);
  const sectionLabel = (g) => (groupOf(genres, g) === 'nonfiction' ? 'Non-Fiction' : 'Fiction');
  const sectionAnchor = (g) => (groupOf(genres, g) === 'nonfiction' ? 'nonfiction' : 'fiction');
  // R14. The platform argument is left at its default here — this IS the web — and the
  // register lives in the module, so this call site never learns why the answer was null.
  const readershipLine = readershipFor(readership);
  const cat = title ? formatCatalogueNumber(title.catalogueNumber) : null;

  // ── R26 — THE BOARD'S SUBJECT, AND THE ONE FLAG THAT SWAPS TEXT ───────────────────────
  //
  // `board` is the live record once it lands and the build-time seed until then. It is ONE
  // value because the cover is ONE element: the loading state and the ready state used to be
  // two mutually exclusive JSX branches, each rendering its own <BoundBook>, so the flip tore
  // the board down and built a second one. Measured on the built export: two distinct <img>
  // elements, and the drawn board moving 53.42px (laptop) / 33px across and 53.42px down
  // (handset 390) between them. That WAS the second beat.
  //
  // The seed carries the same coverUrl and the same coverSizes as the record, so the <img>'s
  // src and srcSet do not change when `board` does — React keeps the element, the browser
  // keeps the decoded bitmap, and nothing repaints.
  //
  // `arrived` swaps TEXT ONLY. Nothing it gates sits above the board in the block flow, so
  // nothing it gates can move the board.
  const board = title || seed;
  const arrived = state === 'ready' && !!title;
  const section = board ? sectionLabel(board.genre) : '';

  return (
    <>
      {/* Same fragment-shape rule as the storefront: the detail body is slot one, the
          curtain is slot two, and neither slot ever changes position. */}
      {detailReady && (
        <>
        <Navbar />
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
          body{background:#070707;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
          ${BOUND_BOOK_CSS}
          ${AUTHOR_BLOCK_CSS}
          @keyframes pulse{0%,100%{opacity:.35}50%{opacity:.7}}
          .bd-skeleton{background:rgba(201,164,76,.08);border-radius:3px;animation:pulse 1.4s ease-in-out infinite}
          ${SHIPPED_BOOK_TRANSITION_CSS}
          .bd-synopsis{font-size:1.02rem;line-height:1.8;color:rgba(240,234,216,.72)}
          .bd-synopsis::first-letter{float:left;font-family:'Cinzel',serif;font-size:3.4rem;line-height:.82;font-weight:600;color:#c9a44c;padding:.1rem .6rem .1rem 0;margin-top:.1rem}
          .bd-shelfcard{margin-top:1.6rem;background:#ece4cf;color:#2a2318;padding:1rem 1.2rem;border-radius:1px;box-shadow:0 8px 22px rgba(0,0,0,.4);font-size:.9rem;line-height:1.6;font-style:italic;max-width:440px}
          .bd-shelfcard span{display:block;margin-top:.5rem;font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.14em;font-style:normal;color:#7a5f24}

          /* ══ R19.8 — THE BUY/SAMPLE PAIR: ONE GEOMETRY, TWO LIVERIES ═════════════════
             Ikenna raised it directly: BUY · £X.XX and READ SAMPLE did not line up. Measured,
             on the real export, they were 2.00px apart in HEIGHT and 11.83px apart in vertical
             CENTRE (87.34px at 390, where the row wrapped). Two independent causes:

               HEIGHT. .bd-sample carried border:1px solid; .bd-buy carried border:none.
               Everything else — padding 15.2/35.2, font-size 10.88, line-height 16.32 — was
               already identical, so the whole 2.00px was one border top and one bottom.
               box-sizing:border-box absorbed none of it, because neither control declares a
               height: with height:auto the box is content + padding + border either way.

               CENTRE. .bd-buy was not the sample's flex sibling. It sat inside a nested
               column that ALSO held the "Available September 2026" note, and .bd-actions
               centred that 70.34px column rather than the 46.69px button.

             THE BORDER, AND WHY A TRANSPARENT ONE RATHER THAN border-box + a fixed height.
             The border width is now declared ONCE, here, and it is 1px on BOTH. The filled
             control's is transparent. The alternative — pinning a height and letting
             border-box swallow the difference — was rejected twice over: it would replace a
             height DERIVED from the type (padding + line-height, which reflows correctly if
             Cinzel fails to load and Georgia's metrics stand in) with a magic number, and it
             would leave [data-unavailable] free to keep adding its own border. That last one
             is not hypothetical: before this round the unsellable button was 48.69px and the
             sellable one 46.69px, so the button changed its own height by 2px depending on the
             reader's geography, and it was the DISABLED variant that accidentally matched the
             sample. Every variant below now sets border-color only — never border — so no
             state of either control can move the pair's height again.

             THE TYPE IS UNTOUCHED. Same face, same .68rem, same .16em tracking, same weight.
             line-height:1.5 is written down rather than inherited, which computes to the same
             16.32px both controls already had; it is here so that a future change to the
             column's leading cannot desynchronise a <button> (which resets it in some UA
             stylesheets) from an <a> (which does not).                                       */
          .bd-cta{
            box-sizing:border-box;
            display:inline-flex;align-items:center;justify-content:center;
            font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;font-weight:600;
            line-height:1.5;
            padding:.95rem 2.2rem;
            border:1px solid transparent;
            border-radius:3px;
            cursor:pointer;text-decoration:none}
          /* Livery only below — no padding, no border-width, no font metric. */
          .bd-buy{background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;transition:filter .25s,opacity .25s}
          .bd-buy:hover{filter:brightness(1.08)}
          .bd-buy:disabled{cursor:progress;opacity:.6;filter:none}
          /* R8.4 — see the twin rule in app/bookstore/page.js. Unavailable is not pending.
             R19.8 — border-color, not border. See the block above. */
          .bd-buy[data-unavailable]{cursor:not-allowed;opacity:.55;background:none;border-color:rgba(201,164,76,.28);color:rgba(240,234,216,.55)}
          .bd-sample{background:rgba(201,164,76,.04);border-color:rgba(201,164,76,.4);color:#c9a44c;transition:all .25s}
          .bd-sample:hover{background:rgba(201,164,76,.1);border-color:rgba(201,164,76,.7)}

          /* THE ROW HOLDS THE PAIR AND NOTHING ELSE.
             align-items:flex-start, not center: the two controls are now the same height,
             so equal tops ARE equal centres — and a top-aligned item cannot be moved by
             anything that grows BENEATH it. That is what makes the ruling structural rather
             than a coincidence of the current content. */
          .bd-actions{display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-top:2.2rem}
          /* BuyButton returns a fragment: the <button> AND, on a failed checkout, its inline
             <p role="alert">. Without this slot that alert would become a flex item of the row
             and seat itself BETWEEN buy and sample. The slot keeps them as one item, stacked,
             growing downward from a fixed top. (AuthModal is position:fixed and out of flow.) */
          .bd-cta-slot{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
          /* The notes sit BENEATH the pair as a whole and take no part in its alignment. */
          .bd-actions-notes{display:flex;flex-direction:column;align-items:flex-start;gap:.4rem;margin-top:.6rem}
          .bd-availability{font-family:'Cormorant Garamond',Georgia,serif;font-size:.72rem;font-style:italic;color:rgba(201,164,76,.6);letter-spacing:.04em}
          .colophon{max-width:640px;margin:0 auto;padding:3rem 2rem 5rem;text-align:center;position:relative;z-index:2}
          .colophon-rule{width:80px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 2rem}
          .colophon-text{font-size:.85rem;line-height:1.9;color:rgba(240,234,216,.4);font-style:italic}
          .colophon-mark{margin-top:1.5rem;color:rgba(201,164,76,.5)}
          /* R19.8 — the handset. At 390 the pair needed 334.06px of a 326px row and wrapped,
             which put the two controls on different lines and made "one vertical centre"
             unachievable rather than merely wrong. The horizontal padding is what gives, and it
             gives in the ONE place the pair's geometry is declared: padding-inline only, so
             the vertical padding — and therefore the shared height — is identical at every
             viewport. flex-wrap:wrap is deliberately kept as the graceful floor: below about
             360px the longest label ("Unavailable here") alongside the sample still cannot fit,
             and wrapping is a better answer there than a clipped button. */
          @media(max-width:720px){.bd-header{grid-template-columns:1fr !important;justify-items:center;text-align:center}.bd-header .bd-cover-wrap{margin-bottom:1rem}.bd-synopsis::first-letter{float:none;font-size:inherit;color:inherit;padding:0;margin:0}.bd-actions{justify-content:center;gap:.6rem}.bd-cta{padding-inline:clamp(.6rem,3.2vw,2.2rem)}.bd-cta-slot{align-items:center}.bd-actions-notes{align-items:center;text-align:center}.bd-shelfcard{margin-left:auto;margin-right:auto}}
        `}</style>

        <main style={{ background: '#070707', color: '#f0ead8', minHeight: '100vh', paddingTop: '68px', position: 'relative' }}>
          {/* ⛔ R22.1 — THE GRAIN OVERLAY STOOD HERE AND IS GONE. Plain dark ground.
              See GRAIN_REMOVED in ../components/grain.js. */}
          <div style={{ maxWidth: '920px', margin: '0 auto', padding: '3.5rem 2rem 4rem', position: 'relative', zIndex: 2 }}>
            {/* ═══════════════════════════════════════════════════════════════════════════
                ⛔ R26 — THE SEPARATE LOADING BRANCH STOOD HERE AND IS GONE.
                ═══════════════════════════════════════════════════════════════════════════

                It drew the R22C seed board in a grid of its own — `260px 1fr`, no class, no
                breadcrumb above it — and the ready block below drew the SAME book again in
                `.bd-header`. Two branches, two <BoundBook>s, two <img> elements, and a flip
                between them that moved the drawn board. That is what Ikenna saw as the cover
                assembling in two beats; the whole of R26's answer is that there is now one
                board, rendered once, below.

                R22C'S REQUIREMENT IS UNCHANGED AND STILL MET — the board is on screen from the
                seed while the live record is in flight, at its final geometry, so the flagged
                cover flight still has an incoming element to pair with. What is no longer true
                is the claim R22C's own note made: the board is NOT in the parsed HTML. It never
                was. The whole tree hangs off `unlocked`, which is false during the prerender,
                so out/bookstore/<slug>.html contains no <img> at all — measured, zero, for
                every title. That is the R9 gate, it is not fixable from here, and R26 answers
                the part of it that CAN be answered from here: ./page.js emits a
                <link rel="preload" as="image"> in the head, which the preload scanner acts on
                off the raw bytes, so the cover is in cache before React has run. */}

            {/* Returned from a completed Stripe checkout. Modest on purpose — the shelf, not a
                receipt. The webhook is what actually grants the book, and it may land a moment
                after the redirect, so this points at the Library rather than claiming the
                record is already written.

                Gated on state === 'ready' as well as `purchased`: this page is a static export,
                and `purchased` is true on the very first client render when the query is
                present. Rendering it any earlier would put a banner in the hydrated tree that
                the prerendered HTML does not have. `state` is 'loading' until an effect
                resolves, so this branch is reliably closed at hydration. */}
            {purchased && state === 'ready' && (
              <div
                role="status"
                style={{
                  display: 'flex', alignItems: 'center', gap: '.9rem', flexWrap: 'wrap',
                  margin: '0 0 2.5rem', padding: '1rem 1.3rem',
                  border: '1px solid rgba(201,164,76,.28)', borderRadius: '3px',
                  background: 'rgba(201,164,76,.06)',
                }}
              >
                <span aria-hidden="true" style={{ color: 'rgba(201,164,76,.75)' }}>&#10086;</span>
                <span style={{ fontSize: '.98rem', fontStyle: 'italic', color: 'rgba(240,234,216,.8)' }}>
                  Thank you. This title is now in your Library.
                </span>
                <a
                  href="/my-library"
                  style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.18em', textTransform: 'uppercase', color: '#c9a44c', textDecoration: 'none', borderBottom: '1px solid rgba(201,164,76,.35)', paddingBottom: '2px' }}
                >
                  Go to My Library &rarr;
                </a>
              </div>
            )}

            {board && (
              /* ═══════════════════════════════════════════════════════════════════════════
                 R23 — THE ENTRANCE REVEAL IS CUT. THE PAGE ARRIVES FINISHED.
                 ═══════════════════════════════════════════════════════════════════════════

                 This div carried a 600ms `fadeUp` entrance. It was the ONLY entrance animation
                 on the page and it was doing all of what Ikenna named on 27 Aug, measured
                 frame by frame against the built export:

                   · THE COVER DIPPED. The loading branch that stood above — R26 removed it,
                     see the note where it was — drew the seed board at FULL opacity. When
                     `state` flipped to ready that branch unmounted and the SAME book
                     re-mounted INSIDE this wrapper, at opacity 0. Measured
                     effective opacity on .bd-cover-wrap: 1 -> 0 -> 1. Not a filter, not a late
                     decode. The board was being un-drawn and re-drawn by its own reveal, which
                     is exactly what the R22C seed above exists to prevent.
                   · THINGS ARRIVED OUT OF DOM ORDER. Not from a stagger — there is none — but
                     because the cover is on screen from the loading branch ~150ms before the
                     breadcrumb, kicker and title exist at all, and those then had to climb out
                     of opacity 0 while the cover was already standing there.
                   · IT TOOK ~430ms TO READ AS ARRIVED. The animation is 600ms; the stretch a
                     viewer registers as assembly is the climb to roughly nine-tenths opacity.

                 `cs-settle cs-settle-1` STAYS. Those classes are the flagged cover flight's
                 machinery, inert in shipped output — BOOK_TRANSITION_SHIPPED is false, so
                 SHIPPED_BOOK_TRANSITION_CSS is the empty string and the rules that would act
                 on them are never emitted. R9's flag flip still has what it needs.

                 ⛔ DO NOT PUT A FADE BACK HERE. The blank that precedes this content is not
                 this element's doing and cannot be answered from this element — see THE BLANK
                 note at the gate above.

                 R26 — THIS BLOCK IS NOW THE ONLY ONE. It renders from `board`, which is the
                 seed before the record lands and the record after, so the breadcrumb, the
                 header grid, the cover wrapper and the <BoundBook> are the same elements
                 throughout the arrival. `arrived` swaps the right-hand column's text and adds
                 the sections below the header — never anything above the board. */
              <div className="cs-settle cs-settle-1">
                {/* ── BREADCRUMB ──────────────────────────────────────────────────────────
                    R26 — IT IS DRAWN FROM THE FIRST FRAME, and that is a load-bearing detail
                    rather than a cosmetic one. This nav sits ABOVE the board in the block
                    flow, so a breadcrumb that appeared only when the live record landed pushed
                    the cover down by its own height the instant it did: measured 53.42px at
                    1280 (one line) and 76.44px at 390 (two). Drawing it from the seed — which
                    is why ./page.js seeds `genre` — means the board's box is settled before
                    the cover is even decoded.

                    The section word can still change once, from the taxonomy fallback to the
                    real group, when getGenres() lands. Measured across the whole live
                    catalogue at 390 and 1280, including the longest titles and all three
                    non-fiction ones, that word swap never changes the nav's HEIGHT — it is
                    four characters inside an already-wrapping row — so it never moves the
                    board. tests/bookstore/cover-arrival.spec.mjs asserts the box across the
                    entire arrival rather than trusting that. */}
                <nav style={{ fontFamily: "'Cinzel',serif", fontSize: '.56rem', letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(201,164,76,.5)', marginBottom: '2.5rem', display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <a href="/bookstore" style={{ color: 'rgba(201,164,76,.7)', textDecoration: 'none' }}>Book Store</a>
                  <span style={{ opacity: .5 }}>&middot;</span>
                  <a href={`/bookstore#${sectionAnchor(board.genre)}`} style={{ color: 'rgba(201,164,76,.7)', textDecoration: 'none' }}>{section}</a>
                  <span style={{ opacity: .5 }}>&middot;</span>
                  <span style={{ color: 'rgba(240,234,216,.55)' }}>{board.title}</span>
                </nav>

                {/* Book header.
                    `data-bd-state` names which half of the arrival this is. Nothing in the
                    shipped stylesheet selects on it — it is there so the arrival harness can
                    inject the pre-R26 geometry onto the loading half and prove its assertions
                    can go red. See tests/bookstore/cover-arrival.spec.mjs. */}
                <div className="bd-header" data-bd-state={arrived ? 'ready' : 'loading'} style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '3.5rem', alignItems: 'start' }}>
                  <div className="bd-cover-wrap" {...{ [BOOK_ARRIVAL_ATTR]: '' }} style={{ display: 'flex', justifyContent: 'center', paddingTop: '.5rem' }}>
                    {/* R17.3 — it flips on tap like every other book on the shop. NO `onOpen`:
                        this page IS the quick look, and a modal repeating the page you are
                        standing on is not a way in, so the book turns back instead. That is a
                        registered surface, not an omission — see BOOK_SURFACES in BoundBook.js.
                        R26 — `board`, not `title`: ONE element for the whole arrival. */}
                    <BoundBook title={board} variant="detail" width={DETAIL_BOARD_WIDTH} />
                  </div>
                  <div>
                    {!arrived && (
                      /* The right column while the record is in flight. The skeleton PULSE
                         stays — it is ruled, and it belongs to the text that is genuinely not
                         here yet. It is not on the cover, which is. */
                      <>
                        <div className="bd-skeleton" style={{ height: '.6rem', width: '35%', marginBottom: '1.2rem' }} />
                        <div className="bd-skeleton" style={{ height: '2rem', width: '80%', marginBottom: '.8rem' }} />
                        <div className="bd-skeleton" style={{ height: '1rem', width: '45%', marginBottom: '2rem' }} />
                        <div className="bd-skeleton" style={{ height: '.9rem', width: '100%', marginBottom: '.6rem' }} />
                        <div className="bd-skeleton" style={{ height: '.9rem', width: '92%', marginBottom: '.6rem' }} />
                        <div className="bd-skeleton" style={{ height: '.9rem', width: '96%' }} />
                      </>
                    )}
                    {arrived && (
                    <>
                    {cat !== null && (
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.26em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.6rem' }}>{cat}</div>
                    )}
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.62rem', fontWeight: 500, letterSpacing: '.22em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.9rem' }}>{genreLabel(title.genre)}</div>
                    <h1 style={{ fontFamily: "'Cinzel',serif", fontSize: 'clamp(1.8rem,4vw,2.8rem)', fontWeight: 600, color: '#f0ead8', lineHeight: 1.1, marginBottom: '.7rem' }}>{title.title}</h1>
                    <p style={{ fontSize: '1.15rem', fontStyle: 'italic', fontWeight: 400, color: 'rgba(240,234,216,.55)', marginBottom: '2rem' }}>by {title.author}</p>

                    {title.synopsis && <p className="bd-synopsis" dangerouslySetInnerHTML={{ __html: title.synopsis }} />}

                    {/* ── R18 — THE AUTHOR ─────────────────────────────────────────────
                        AFTER the synopsis, BEFORE the editor's note. The note is the last
                        beat before the button and stays that way; a biography wedged between
                        the curator's sentence and the thing it recommends is the one place
                        this section must never stand.

                        UNCONDITIONAL HERE ON PURPOSE. There is no `title.authorBio &&` guard
                        in front of it, because the decision is not this file's to make and a
                        condition here would be a second copy of it. AuthorBlock returns null
                        when there is no bio and no photograph, and null renders NOTHING — no
                        label, no placeholder, no empty frame. See app/lib/bookstore/author.js
                        for why absence is the normal state rather than a missing one. */}
                    <AuthorBlock title={title} />

                    {title.shelfCard && (
                      <div className="bd-shelfcard">{title.shelfCard}<span>&mdash; Calvary</span></div>
                    )}

                    {/* ── R19.8 — THE ACTION ROW: THE PAIR, THEN THE NOTES ────────────────
                        The row below holds EXACTLY two things — the buy slot and the sample —
                        and every qualifying line that used to live inside the buy's column now
                        sits in `.bd-actions-notes`, beneath the pair as a whole.

                        What was wrong: the note and the two asides were siblings of the button
                        inside a nested column, so that column — not the button — was what the
                        row centred. The note alone made it 70.34px against the button's 46.69,
                        which put the button's centre 11.83px above the sample's. Deleting the
                        note from the DOM moved both controls; it was load-bearing.

                        The notes are still read second, still in the same muted italic, and the
                        availability line is verbatim — launch is confirmed for 30 September
                        2026, so the wording was never the problem. Only its DOM position was.

                        The stacking order beneath is unchanged (territory OR currency, then
                        availability), and the two asides remain mutually exclusive by
                        construction rather than by these conditions: when a title is not
                        sellable here priceLine returns no price, so fallbackLine is already
                        null and there is no second sentence to suppress. */}
                    <div className="bd-actions">
                      <div className="bd-cta-slot">
                        <BuyButton title={title} className="bd-cta bd-buy" />
                      </div>
                      {title.samplePath && (
                        <a className="bd-cta bd-sample" href={`/reader/${title.slug}?sample=1`}>Read sample</a>
                      )}
                    </div>
                    <div className="bd-actions-notes" data-testid="bd-actions-notes">
                      {!sellable && (
                        <p data-testid="territory-sentence" style={BUY_ASIDE_STYLE}>
                          {TERRITORY_SENTENCE}
                        </p>
                      )}
                      {fallbackLine && (
                        <p data-testid="price-fallback-sentence" style={BUY_ASIDE_STYLE}>
                          {fallbackLine}
                        </p>
                      )}
                      <span className="bd-availability" data-testid="availability-note">Available September 2026</span>
                    </div>
                    </>
                    )}
                  </div>
                </div>

                {/* ── R26 — EVERYTHING BELOW THE HEADER IS `arrived`-ONLY ─────────────────
                    All of it sits BENEATH the board in the block flow, so none of it can move
                    the board when it appears. That is the whole rule this file now keeps:
                    what arrives late must arrive below. */}
                {arrived && (
                <>
                {/* Metadata strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '1.5rem 2rem', marginTop: '3.5rem', paddingTop: '2.5rem', borderTop: '1px solid rgba(201,164,76,.1)' }}>
                  <MetaItem label="Genre" value={genreLabel(title.genre)} />
                  {title.pageCount ? <MetaItem label="Pages" value={String(title.pageCount)} /> : null}
                  <MetaItem label="Published" value={formatDate(title.publishedDate)} />
                  <MetaItem label="Publisher" value={publisherName || null} />
                  {title.isbn ? <MetaItem label="ISBN" value={title.isbn} /> : null}
                </div>

                {/* ── R14 — THE READERSHIP LINE ────────────────────────────────────────────
                    Ikenna's ruling, 19 Aug 2026: the genre principle again. Absent is absent.
                    readershipFor() returns null below one, so there is no `count > 0` test
                    here and no zero to format — the element simply is not rendered, exactly
                    as MetaItem above returns null for a missing value.

                    A TITLE'S LINE APPEARING FOR THE FIRST TIME NEEDS NO CODE CHANGE: the
                    first purchase moves the counter inside the webhook's own write, and the
                    next load of this page has a line where it had none.

                    PLACEMENT. Under the credits strip, not beside the buy button. The strip
                    is where this page states facts ABOUT the book — genre, pages, date,
                    publisher, ISBN — and readership is one more of them, the only one that is
                    about other people. Beside the button it would be a persuasion; here it is
                    a credit.

                    TYPE. The strip's own label face, verbatim — Cinzel .52rem, .24em, muted
                    gold, uppercased by CSS — so it reads as a sixth line of the same block
                    rather than a new kind of thing. It sits below the grid rather than inside
                    it because it is a sentence, not a label over a value. */}
                {readershipLine && (
                  <div
                    data-testid="readership-line"
                    style={{
                      fontFamily: "'Cinzel',serif", fontSize: '.52rem', letterSpacing: '.24em',
                      textTransform: 'uppercase', color: 'rgba(201,164,76,.55)', marginTop: '1.6rem',
                    }}
                  >
                    {readershipLine}
                  </div>
                )}

                {/* From the book */}
                {title.excerpt && (
                  <div style={{ marginTop: '3.5rem' }}>
                    <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.2rem' }}>From the book</div>
                    <blockquote style={{ margin: 0, fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '1.12rem', lineHeight: 1.85, color: 'rgba(240,234,216,.6)', borderLeft: '2px solid rgba(201,164,76,.3)', paddingLeft: '1.6rem' }}>
                      {truncate(title.excerpt, 600)}
                    </blockquote>
                  </div>
                )}
                </>
                )}
              </div>
            )}

            {/* NO SEED, NO BOARD. `board` is null only when this page was built without the
                title — which, because generateStaticParams enumerates exactly the titles that
                have a seed, means the slug has no static page and this render is on its way to
                notFound(). The skeleton is what stands for the frame or two before that
                resolves; it is not an arrival, and nothing pairs with it. */}
            {!board && state === 'loading' && (
              <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '3.5rem' }}>
                <div className="bd-skeleton" style={{ width: '280px', aspectRatio: '2/3', borderRadius: '2px 5px 5px 2px' }} />
                <div>
                  <div className="bd-skeleton" style={{ height: '.6rem', width: '35%', marginBottom: '1.2rem' }} />
                  <div className="bd-skeleton" style={{ height: '2rem', width: '80%', marginBottom: '.8rem' }} />
                  <div className="bd-skeleton" style={{ height: '1rem', width: '45%', marginBottom: '2rem' }} />
                  <div className="bd-skeleton" style={{ height: '.9rem', width: '100%', marginBottom: '.6rem' }} />
                  <div className="bd-skeleton" style={{ height: '.9rem', width: '92%', marginBottom: '.6rem' }} />
                  <div className="bd-skeleton" style={{ height: '.9rem', width: '96%' }} />
                </div>
              </div>
            )}
          </div>

          {state === 'ready' && title && (
            <footer className="colophon">
              <div className="colophon-rule" />
              <p className="colophon-text">This catalogue is set in Cormorant Garamond &amp; Cinzel upon a ground of near-black, with ornaments in the printer&rsquo;s tradition. Published on the web by Calvary Media UK. Curated by hand in London &amp; Lagos.</p>
              <div className="colophon-mark">&#10086;</div>
            </footer>
          )}
        </main>
        </>
      )}

      {/* ── THE BAR, AND R9 MUST NOT TAKE IT ────────────────────────────────────────────────
          This route carried NO tab bar in any state — not locked, not open. A reader arriving on
          a shared /bookstore/<slug> link (the reader's "View in the Book Store", a message from a
          friend) reached a detail page, or a curtain, with no way back into the platform. The
          storefront at least kept the bar behind `storeReady`; this page never had it at all.
          Unconditional here for the same reason it is unconditional there.

          THIS IS PLATFORM CHROME, NOT GATE MACHINERY. gate.js's delete list (:101-115) names this
          file — it takes the LaunchGate import, the `curtain` state and the slot below, and it
          must leave this line standing. The bar outlives the curtain.

          Book Store is lit — a title page is a child of the storefront, not a destination of
          its own. */}
      <TabBar active="store" />

      {curtain === 'up' && (
        <LaunchGate onUnlock={() => setUnlocked(true)} onLifted={() => setCurtain('gone')} />
      )}
    </>
  );
}
