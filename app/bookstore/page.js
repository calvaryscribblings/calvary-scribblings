'use client';
import { useState, useEffect, useRef } from 'react';
import { notFound } from 'next/navigation';
import { db } from '../lib/firebase';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { getAllPublishedTitles } from '../lib/bookstore/loader';
import Navbar from '../components/Navbar';
import TabBar from '../components/TabBar';
import BoundBook, { BOUND_BOOK_CSS } from './components/BoundBook';
import BuyButton from './components/BuyButton';
import QuickLookModal from './components/QuickLookModal';
import { resolveOpeningLine, formatCatalogueNumber } from './components/fields';
import { useCurrency, useRegionCountry, priceLine } from '../lib/currency';
import CurrencySelector, { CURRENCY_SELECTOR_CSS } from './components/CurrencySelector';
import LaunchGate from './components/LaunchGate';
import { isStoreUnlocked } from '../lib/bookstore/gate';
// R13 — the curation system and the taxonomy. Both are DATA now; neither is a table in this
// file any more. See app/lib/bookstore/sections.js and genres.js for the two rules, which are
// deliberately opposite: an unclaimed section renders nothing, an unwritten vocabulary
// bootstraps to the seed.
import { getGenres, getSections, getSignals } from '../lib/bookstore/loader';
import { genreLabel as labelOf, genresPresentIn, titlesInGroup, groupLabel } from '../lib/bookstore/genres';
import { resolveSections, bandsFor, applyBands, rebindSections, nextExpiryMs, planShopFlow, shelfRuns } from '../lib/bookstore/sections';
import CuratedSection, { CURATED_SECTION_CSS } from './components/CuratedSection';
import { SHOP_VERNACULAR_CSS } from './components/shopVernacular';
// R20 — the grain, its ruling and its one definition. See the header of that file.
import { GRAIN_CSS, GRAIN_CLASS } from './components/grain';
// R22C — the departing half of the book's journey. Both documents must carry this stylesheet
// or the pair never forms; see the header of that file.
import { BOOK_TRANSITION_CSS, installBookTransitions } from './components/bookTransition';

// R13 — WHAT USED TO BE HERE, AND WHERE IT WENT.
//
// Three constants stood at the top of this file: FICTION_GENRES, NONFICTION_GENRES and a
// twelve-row GENRE_LABELS map, with sectionForGenre() exported so the detail page could
// "reuse the exact same mapping without re-deriving it". The detail page did not reuse the
// map — it kept a byte-identical copy of its own — and /admin/bookstore kept a THIRD version
// that derived labels from the slug and disagreed with both on four of the twelve. An editor
// picked "Thriller Suspense" from a dropdown and the shop printed "Thriller & Suspense".
//
// All three are gone. Labels, display order and the fiction/non-fiction split now come from
// bookstore_genres, read once below and threaded through as data. genreLabel is a call
// against that list, not a lookup in a table this file owns.

// ── Small ornaments ──────────────────────────────────────────────────────────
function Fleuron({ style }) {
  return <span style={{ color: 'rgba(201,164,76,.5)', ...style }}>&#10086;</span>;
}

// ⚠ ShelfBook USED TO STAND HERE, and its removal is the whole of R17.3. It called
// useBookGesture and spread the result into BoundBook as flipped/bind/bookRef — which meant
// the shelf was the ONLY surface with a live book, because it was the only surface that went
// through this wrapper. The Window and the curated case rendered BoundBook directly and got
// a book that ignored a tap. The gesture now lives inside BoundBook and those three props no
// longer exist, so there is nothing left for a new surface to forget to pass. See
// BOOK_SURFACES in app/bookstore/components/BoundBook.js.

// R13 — EXPORTED, and it takes two new props.
//
// `genreLabelFor` is the taxonomy's labeller, passed in rather than closed over, so this
// component holds no opinion about how a genre is spelled.
//
// `suppressMark` hides the catalogue divider for a RANKED curated shelf, where the same slot
// carries the rank numeral instead. Both marks in one slot would be two orderings arguing —
// "CS 003" is where a book sits in the catalogue and "II" is where the curator put it, and a
// shelf that shows both is telling the reader neither.
//
// The export is for the CMS preview, following the precedent page-detail.js set when it
// imported sectionForGenre from this route file: the panel must draw the shop with the shop's
// own components or it is drawing a mock-up.
export function ShelfEntry({ title, index, onOpen, genreLabelFor, suppressMark }) {
  const [currency] = useCurrency();
  // R8.4 — the country from the SAME one-shot probe the currency default already uses; no
  // second request. priceLine applies the precedence rule (territory outranks currency), so
  // this component makes no decision about which mark to show.
  const country = useRegionCountry();
  const { price, note, isTerritoryNote } = priceLine(title, currency, country);
  const mark = suppressMark ? null : formatCatalogueNumber(title.catalogueNumber);
  const tilt = index % 2 === 0 ? -0.7 : 0.7;
  return (
    <div className="shelf-entry">
      {mark && (
        <div className="no-divider"><span className="no-line" /><span className="no-label">{mark}</span><span className="no-line" /></div>
      )}
      <div className="shelf-book-wrap">
        {/* R16 — a CSS length, and the shelf passes 100%: the book is its column. See the note
            on .shelf-book-wrap in shopVernacular.js and on .bb-persp in BoundBook.js. */}
        <BoundBook title={title} variant="shelf" width="100%" onOpen={onOpen} />
      </div>
      <div className="entry-genre">{genreLabelFor(title.genre)}</div>
      <div className="entry-title">{title.title}</div>
      <div className="entry-author">{title.author}</div>
      {price && <div className="entry-price">{price}</div>}
      {/* R8.3 — SHOWN AND MARKED. The book keeps its place on the shelf; the line beneath
          simply names the money. No badge, no dimming, no alarm colour.
          R8.4 — a restricted title keeps its place too, and its cover, and its title, and its
          weight. The ONLY difference is which sentence sits here and the absence of a price
          above it. Same class, same quiet register: the shop is stating a fact about rights,
          not apologising for one. */}
      {note && (
        <div
          className="entry-price-note"
          data-testid={isTerritoryNote ? 'territory-note' : undefined}
        >
          {note}
        </div>
      )}
      {title.shelfCard && (
        <div className="shelf-card" style={{ transform: `rotate(${tilt}deg)` }}>
          <span className="shelf-card-body">{title.shelfCard}</span>
          <span className="shelf-card-sign">&mdash; Calvary</span>
        </div>
      )}
    </div>
  );
}

// ── Genre-tabbed catalogue section (R2 logic preserved: tabs, filter, hide rules) ──
//
// R15 — THE SHELF IS NOW CUT, and everything else about this component is untouched.
//
// `interleaves` is one shelf's slice of planShopFlow(): a list of cuts, each a depth and the
// curated tables standing at it. shelfRuns() turns the books plus the cuts into runs, and a run
// draws a grid only if it HAS books — which is what makes a cut at depth 0 render as a table
// above the first row rather than as an empty grid with a row's worth of margin.
//
// ── THE FILTERED-TAB RULING ────────────────────────────────────────────────────────────────
//
// A genre tab is a QUESTION THE READER ASKED. A curated table is a CLAIM THE CURATOR MADE
// about the shop. When the reader narrows the shelf to Historical, the shop stops merchandising
// and answers: no tables, one continuous grid of exactly the books they asked for. Touch "All
// Fiction" again and the tables are back where they were.
//
// It is not a shortcut, it is the only version that is honest, and three separate things go
// wrong without it:
//
//   · THE TABLE CONTRADICTS THE TAB. Editor's Choice names four books across four genres. Under
//     "Historical" it would put three non-historical covers on a shelf the reader has just told
//     the shop to restrict — an answer that ignores the question, in the middle of the answer.
//   · THE PLACEMENT STOPS MEANING ANYTHING. `placeAfter` counts books. A filtered shelf holds
//     different books, so "after the 6th" would land in a different place on every tab, and on
//     a two-book tab it would clamp to the foot. The table would appear to jump around as the
//     reader browsed.
//   · THE CURATOR CANNOT SEE IT. There is one shop to arrange, not one per tab.
//
// The Window, and anything else placed at 'opening' or 'foot', is OUTSIDE this component and
// therefore outside the tab. That is the same rule, not an exception to it: a tab filters the
// shelf it belongs to, so what is inside the shelf answers to it and what stands between
// shelves does not.
//
// Exported for the CMS preview — see the panel's placed-context frame.
export function CatalogueSection({ id, sectionLabel, allLabel, titles, genresPresent, active, setActive, onOpen, genreLabelFor, interleaves, renderSection }) {
  const filtered = active !== 'all';
  const grid = filtered ? titles.filter((t) => t.genre === active) : titles;
  // R13 — genresPresent is now taxonomy RECORDS rather than slugs, so the tab carries the
  // curator's label and the curator's order. The rule it encodes is unchanged and is now
  // stated once, in genres.js: All Fiction first, then only genres holding a published title.
  // An empty genre is absent, not an empty tab.
  const tabs = [{ key: 'all', label: allLabel }, ...genresPresent.map((g) => ({ key: g.slug, label: g.label }))];
  // Under a filter this is [{ titles: grid, sections: [] }] — one run, no cuts, byte-identical
  // to what the shop drew before this round.
  const runs = filtered || !renderSection ? [{ titles: grid, sections: [] }] : shelfRuns(grid, interleaves);
  // The entry index runs across the WHOLE shelf, not per run: it drives the shelf-card tilt,
  // which alternates, and restarting it at each cut would put two cards at the same angle
  // either side of a table.
  let seen = 0;
  return (
    <section id={id} className="catalogue-section">
      <div className="section-head">
        <span className="section-rule" />
        <span className="section-mark"><Fleuron /></span>
        <h2 className="section-title">{sectionLabel}</h2>
        <span className="section-mark"><Fleuron /></span>
        <span className="section-rule" />
      </div>
      <div className="genre-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`genre-tab${active === t.key ? ' active' : ''}`} onClick={() => setActive(t.key)}>{t.label}</button>
        ))}
      </div>
      {grid.length > 0
        ? runs.map((run, r) => {
          const from = seen;
          seen += run.titles.length;
          return (
            <div key={`run-${r}`}>
              {/* ⛔ NO GRID FOR AN EMPTY RUN. A cut at the very top of the shelf, and any two
                  cuts that clamped to the same depth, leave a run with nothing in it — and an
                  empty .shelf is a row gap with no row, which is the hole this round is
                  required not to open. */}
              {run.titles.length > 0 && (
                <div className="shelf">
                  {run.titles.map((t, i) => (
                    <ShelfEntry key={t.id} title={t} index={from + i} onOpen={onOpen} genreLabelFor={genreLabelFor} />
                  ))}
                </div>
              )}
              {run.sections.map((sec) => (
                <div className="catalogue-interleave" key={sec.id}>{renderSection(sec)}</div>
              ))}
            </div>
          );
        })
        : <p className="shelf-empty">Nothing on this shelf yet.</p>}
    </section>
  );
}

// ── The Window: the featured title in the display case ────────────────────────
//
// R13 FOLDED THIS INTO THE SECTION SYSTEM AND CHANGED NOTHING ABOUT IT.
//
// Same component, same classes, same markup, same plate reading "In the Window", same
// ribbon, same buy button. What changed is WHO DECIDES IT RENDERS: it used to be
// `titles.find(t => t.featured)` at the foot of this file, and it is now a WINDOW section in
// bookstore_sections whose claim resolved. The no-fallback behaviour that one line encoded —
// no featured title, no display case, never a case with a substitute book in it — is the
// template every other section type now obeys, which is why this component needed no
// argument to make: it had already made it.
//
// The only edit below is genreLabelFor, for the same reason as everywhere else in this file.
// Exported for the CMS preview.
// R17.3 — `onOpen` IS THE ONLY ADDITION, and it is threaded rather than closed over for the
// same reason genreLabelFor is: the CMS preview mounts this component too, and it has no Quick
// Look to open. Omitted, the book turns back instead of standing face-down.
export function TheWindow({ title, genreLabelFor, onOpen }) {
  // The price label moved into BuyButton, so the button's face and the currency it charges
  // in can never drift apart.
  const pull = resolveOpeningLine(title);
  const mark = formatCatalogueNumber(title.catalogueNumber);
  return (
    <section className="the-window">
      <div className="window-plate"><Fleuron /> In the Window <Fleuron /></div>
      <div className="window-case">
        <span className="fleuron-corner tl">&#10086;</span>
        <span className="fleuron-corner tr">&#10086;</span>
        <span className="fleuron-corner bl">&#10086;</span>
        <span className="fleuron-corner br">&#10086;</span>
        <div className="window-lamp" />
        <div className="window-inner">
          <div className="window-book">
            <BoundBook title={title} variant="window" width={190} ribbon onOpen={onOpen} />
          </div>
          <div className="window-copy">
            <div className="window-kicker">{mark ? `${mark} · ` : ''}{genreLabelFor(title.genre)}</div>
            <h3 className="window-title">{title.title}</h3>
            <p className="window-author">by {title.author}</p>
            {pull && <p className="window-pull">&ldquo;{pull}&rdquo;</p>}
            {title.shelfCard && <p className="window-shelfcard">{title.shelfCard} <span>&mdash; Calvary</span></p>}
            <div className="window-actions">
              <BuyButton title={title} className="btn-buy" />
              {title.samplePath && <a className="btn-sample" href={`/reader/${title.slug}?sample=1`}>Read sample</a>}
              <a className="btn-details" href={`/bookstore/${title.slug}`}>Full details &rarr;</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// OPENING LINES — R22B: THE LINE TURNS LIKE A PAGE
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The rail used to swap its quote with a bare setState: one frame the old sentence, the next
// frame the new one. Per the approved mock the words now TURN — the outgoing line rises out of
// the frame and the new one arrives from below, with the attribution a beat behind it.
//
//   out    opacity 1 → 0, translateY 0 → -9px      ~420ms
//   in     opacity 0 → 1, translateY +11px → 0     ~420ms
//   the attribution runs the same pair, 60ms later
//
// ── THE QUOTATION MARKS, THE KICKER AND THE FRAME DO NOT MOVE ────────────────────────────
//
// That is the whole reading of the effect: the rail is a frame with a book's first sentence
// showing through it, and a page turns behind the frame rather than the frame going with it.
// So the &ldquo; and &rdquo; were pulled OUT of the moving element — they used to sit inside
// .rail-quote's text, which would have carried them up and out with the words — and now sit
// beside .rail-words as their own spans. `.rail-quote` itself never transforms; only
// `.rail-words` and `.rail-attrib` do.
//
// ── TRANSFORM AND OPACITY ONLY ───────────────────────────────────────────────────────────
//
// Nothing here animates a property that repaints or reflows: no height, no margin, no colour,
// no filter. The two transitioned properties are named in RAIL_TURN below and asserted by
// tests/bookstore/payload.spec.mjs against the computed style, so a later edit that reaches
// for `top` or `line-height` because it is easier fails rather than quietly costing a round
// like R22A's.
//
// ── AND IT STOPS FOR prefers-reduced-motion ──────────────────────────────────────────────
//
// `transition:none` under the query, so the swap is instantaneous. R20 declined to add one to
// the grain on the grounds that nobody had asked for a class of readers to stop seeing a thing
// the house had ruled in. This is the opposite case: the motion is the feature, and a reader
// who has asked their system for less of it is asking about exactly this.
export const RAIL_TURN = {
  ruledBy: 'Ikenna',
  on: '2026-08-26',
  approvedAs: 'the mock — the line turns like a page',
  durationMs: 420,
  easing: 'cubic-bezier(.4,0,.2,1)',
  outY: '-9px',
  inY: '11px',
  attributionDelayMs: 60,
  // The ONLY two properties that may appear in the transition. Asserted, not hoped.
  properties: ['opacity', 'transform'],
  // What must never move, because moving it turns a frame with a page behind it into a card
  // that slides.
  stationary: ['.rail-eyebrow', '.rail-quote', '.rail-mark'],
};

function OpeningLinesRail({ pool }) {
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // 'idle' | 'out' | 'in'. One variable rather than two booleans: the page is either settled,
  // leaving, or arriving, and a pair of flags admits a fourth state that means nothing.
  const [phase, setPhase] = useState('idle');
  const timers = useRef([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const entry = pool[i % pool.length];
  const line = resolveOpeningLine(entry);

  const advance = () => {
    // Mid-turn presses are ignored rather than queued. A second press during the 420ms would
    // otherwise start an `in` on a line that is still going `out`, and the rail would flicker
    // through a sentence nobody read.
    if (phase !== 'idle') return;
    setPhase('out');
    timers.current.push(setTimeout(() => {
      // The swap happens at the far end of the outgoing turn, while the words are invisible —
      // which is what makes it a page turn rather than a cross-fade.
      setRevealed(false);
      setI((n) => (n + 1) % pool.length);
      setPhase('in');
      // One frame in the arriving position before the class comes off, or the browser
      // coalesces "put it at +11px" and "put it back at 0" into no transition at all.
      timers.current.push(setTimeout(() => setPhase('idle'), 30));
    }, RAIL_TURN.durationMs));
  };

  const turning = phase === 'out' ? ' is-out' : phase === 'in' ? ' is-in' : '';

  return (
    <section className="rail">
      <div className="rail-eyebrow"><Fleuron /> Opening Lines <Fleuron /></div>
      {/* The marks are the FRAME and stay put; only .rail-words travels through them. */}
      <blockquote className="rail-quote">
        <span className="rail-mark" aria-hidden="true">&ldquo;</span>
        <span className={`rail-words${turning}`}>{line}</span>
        <span className="rail-mark" aria-hidden="true">&rdquo;</span>
      </blockquote>
      {revealed ? (
        <div className={`rail-reveal rail-attrib${turning}`}>
          <a href={`/bookstore/${entry.slug}`} className="rail-answer">
            <span className="rail-answer-title">{entry.title}</span>
            <span className="rail-answer-author">{entry.author}</span>
          </a>
          <button className="rail-btn" onClick={advance}>Another line <Fleuron /></button>
        </div>
      ) : (
        <button className="rail-btn" onClick={() => setRevealed(true)}>Whose line is this?</button>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE MASTHEAD LOCKUP'S AIR — a derivation, not a nudge
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// .hero-title sets line-height:.9 over Cormorant Garamond, whose natural line box is 1.211em.
// CSS pays for a compressed line-height out of HALF-LEADING — half from the top of the line
// box, half from the bottom — so the shortfall taken from ABOVE the display line is
//
//     air = (naturalLineBox - requestedLineHeight) / 2 = (1.211 - .9) / 2 = .1555em
//
// which is what made "The" sit on "Book Store"'s ink with the same air pooling underneath.
//
// The rule at .hero-store hands that back with `margin-top: .1555em` and pays for it with
// `margin-bottom: -.1555em`, so the transfer is net zero to the flow beneath. Both halves are
// derived from the two numbers below and neither is typed twice — tests/bookstore/masthead.
// spec.mjs recomputes the arithmetic from this record and fails if the stylesheet disagrees.
//
// THE APP REPO CARRIES THE IDENTICAL CONSTANT AS HERO_LOCKUP_AIR. Same name on both sides on
// purpose: .1555 on its own reads as a fitted number in either repo, and it is not one.
export const HERO_LOCKUP_AIR = {
  // Cormorant Garamond's natural line box, in em — the value the face reports when no
  // line-height is asked for. Everything below is derived from this and `requestedLineHeight`.
  naturalLineBoxEm: 1.211,
  requestedLineHeight: 0.9,   // .hero-title
  get em() { return +(((this.naturalLineBoxEm - this.requestedLineHeight) / 2).toFixed(4)); },
  selector: '.hero-store',
  appConstant: 'HERO_LOCKUP_AIR',
  // The measurement the fix is accountable to, at 390px where .hero-store clamps to its
  // 3.6rem floor (57.6px) and the air is therefore .1555 x 57.6 = 8.96px.
  //
  // ⚠ THE ABSOLUTE `above` DIFFERS FROM THE APP LANE'S FIGURE AND THAT IS NOT A DISAGREEMENT.
  // The app harness reported ~8px above / ~42px below; this repo's probe reads 5.00 / 43.67.
  // `below` agrees to within 1.7px; `above` does not, because the two instruments do not draw
  // the top edge of an ink run the same way. What BOTH agree on is the DELTA, which is the
  // only thing the derivation predicts: +8.96 above, -8.96 below, and zero net. Measured here
  // as +9.00 / -9.00 at a 0.33px instrument resolution. Do not "reconcile" the 5 to an 8 by
  // moving the margin — that would break the transfer, which is the property under test.
  measuredAt390: { fontSizePx: 57.6, aboveBefore: 5.00, belowBefore: 43.67, aboveAfter: 14.00, belowAfter: 34.67 },
};

// ── Hero: the title-page treatment ────────────────────────────────────────────
function Hero({ count, currency, onCurrency, chosen }) {
  return (
    <section className="hero">
      <div className="hero-lamp" />
      <div className="hero-inner">
        <div className="hero-eyebrow">&#10086; Calvary Scribblings &#10086;</div>
        <h1 className="hero-title"><span className="hero-the">The</span><em className="hero-store">Book Store</em></h1>
        <p className="hero-colophon">A shop, not a warehouse. Every title on these shelves was chosen by hand.</p>
        <div className="hero-edition">Catalogue &middot; {count} {count === 1 ? 'Title' : 'Titles'} &middot; Est. 2026</div>
        {/* R8.3 — the currency line sits with the catalogue line, because that is what it is:
            a statement about how this catalogue is priced, in the same register as the count
            and the year. Not a control panel, and not a floating widget. */}
        <div className="hero-currency">
          <CurrencySelector currency={currency} onChange={onCurrency} chosen={chosen} />
        </div>
      </div>
    </section>
  );
}

function SkeletonShelf() {
  return (
    <section className="catalogue-section">
      <div className="section-head"><span className="section-rule" /><span className="section-mark"><Fleuron /></span><h2 className="section-title">The Shelves</h2><span className="section-mark"><Fleuron /></span><span className="section-rule" /></div>
      <div className="shelf">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="shelf-entry">
            <div className="skeleton" style={{ width: 150, height: 225, borderRadius: '2px 5px 5px 2px', margin: '0 auto 1rem' }} />
            <div className="skeleton" style={{ height: '.55rem', width: '40%', margin: '0 auto .5rem' }} />
            <div className="skeleton" style={{ height: '.8rem', width: '70%', margin: '0 auto .4rem' }} />
            <div className="skeleton" style={{ height: '.7rem', width: '50%', margin: '0 auto' }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Colophon({ count }) {
  return (
    <>
      <section className="curation-band">
        <Fleuron style={{ fontSize: '1rem' }} />
        <p>{count} {count === 1 ? 'title' : 'titles'}. Each one chosen. When everything is stocked, nothing is recommended.</p>
      </section>
      <footer className="colophon">
        <div className="colophon-rule" />
        <p className="colophon-text">This catalogue is set in Cormorant Garamond &amp; Cinzel upon a ground of near-black, with ornaments in the printer&rsquo;s tradition. Published on the web by Calvary Media UK. Curated by hand in London &amp; Lagos.</p>
        <div className="colophon-mark">&#10086;</div>
      </footer>
    </>
  );
}

export default function BookStorePage() {
  const [gateState, setGateState] = useState('checking');
  const [titles, setTitles] = useState(null); // null until the catalogue load resolves
  // R13 — the taxonomy and the claims. Both null until their load resolves, for the same
  // reason `titles` is: a shop that renders tabs before it knows their names, or a section
  // before it knows whether it is claimed, would flash a wrong screen at every reader.
  const [genres, setGenres] = useState(null);
  const [sectionRows, setSectionRows] = useState(null);
  const [signals, setSignals] = useState(null);
  // THE CLOCK, HELD IN STATE AND NOT READ DURING RENDER.
  //
  // React refuses Date.now() in a render body (react-hooks/purity) and it is right to: this
  // component is PRERENDERED into the static export, so a clock read during render is a
  // value the build has and the browser does not agree with. It is set once at mount, and
  // re-set exactly once more at the next month boundary — see the effect below.
  const [now, setNow] = useState(0);
  const [activeFiction, setActiveFiction] = useState('all');
  const [activeNonfiction, setActiveNonfiction] = useState('all');
  const [modal, setModal] = useState(null); // { title, rect }
  const modalReset = useRef(null);

  // ── R8.1 THE CURTAIN ──────────────────────────────────────────────────────
  //
  // Three states, and the middle one is why this is not a boolean: 'checking' is the render
  // before the effect has read localStorage. The export prerenders this component to HTML at
  // build time, so the first client render must match that HTML — reading storage during
  // render would make a returning keyholder's markup differ from the prerendered gate and
  // throw a hydration error. So the first paint commits to neither, and the effect decides.
  //
  // 'up' keeps the gate mounted while `unlocked` is already true: that overlap IS the reveal.
  // See the note at the head of components/LaunchGate.js.
  const [curtain, setCurtain] = useState('checking'); // 'checking' | 'up' | 'gone'
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (isStoreUnlocked()) { setUnlocked(true); setCurtain('gone'); }
    else setCurtain('up');
  }, []);

  // R22C — THE BOOK CARRIES YOU TO ITS PAGE.
  //
  // One delegated listener for the whole shop rather than a handler per link: the shelf
  // re-renders on every genre tab, every currency change and every section resolve, and the
  // links live in four different components including a modal that mounts and unmounts. It
  // reads the href, finds the board with that slug, and names it so the browser carries it
  // across the navigation. See ./components/bookTransition.js.
  //
  // ⚠ NOTHING HERE IS LOAD-BEARING FOR GETTING TO THE PAGE. No preventDefault, no scripted
  // navigation. If this effect never ran — an old browser, a thrown error, the module removed —
  // every link on the shop still works exactly as it did before R22, without the motion.
  useEffect(() => installBookTransitions(), []);

  // A0 runtime gate — UNCHANGED in substance: the route still stays invisible (404) until at
  // least one title is published. The only difference is that it now waits for the curtain,
  // because R8.1's brief is that nothing is fetched from behind it. A visitor without the key
  // never issues this query, so the 404 case is not even reachable until they are through.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await get(query(ref(db, 'bookstore_titles'), orderByChild('status'), equalTo('published')));
        if (cancelled) return;
        setGateState(snap.exists() ? 'open' : 'empty');
      } catch {
        if (!cancelled) setGateState('empty');
      }
    })();
    return () => { cancelled = true; };
  }, [unlocked]);

  // Single-fetch data flow — UNCHANGED. Fetch the full published catalogue exactly once and
  // derive every view (genre filter, split, featured/window, opening lines) client-side.
  useEffect(() => {
    if (gateState !== 'open') return;
    let cancelled = false;
    (async () => {
      const list = await getAllPublishedTitles();
      if (cancelled) return;
      setTitles(list);
      // R13 — THREE MORE READS, AND THEY ARE ALL SMALL. bookstore_genres is twelve records of
      // four fields. bookstore_sections is however many shelves the curator has planned, and
      // at launch that is one or two. bookstore_signals does not exist, so it is an absent-node
      // read that returns nothing — see getSignals()'s note on why it is wired anyway.
      //
      // ⚠ THE REASON THIS CATALOGUE READ IS AWAITED FIRST HAS BEEN RETIRED, and the comment
      // that gave it is corrected here rather than left standing. It read: "the catalogue is
      // awaited FIRST because getSections needs it — the bootstrap builds the Window's claim
      // out of the published titles". R17.2 deleted that bootstrap and getSections now takes
      // no argument, so nothing below depends on `list` any more.
      //
      // The serialisation is therefore no longer necessary — these three could join the
      // catalogue in one Promise.all and save a round trip. NOT DONE HERE: that is a change to
      // how the shop loads, and this round's job was to remove dead code, not to re-time the
      // page behind it. It is left as a named, deliberate opportunity rather than an accident.
      const [g, s, sig] = await Promise.all([getGenres(), getSections(), getSignals()]);
      if (cancelled) return;
      setGenres(g);
      setSectionRows(s);
      setSignals(sig);
      // The clock, taken once, beside the claims it dates. See THE CLOCK above.
      setNow(Date.now());
    })();
    return () => { cancelled = true; };
  }, [gateState]);

  // The clock, and its one alarm.
  //
  // The catalogue effect above sets it, in the same async callback that lands the sections —
  // deliberately, and not in a mount effect of its own. A synchronous setState in an effect
  // body is what react-hooks/set-state-in-effect refuses and what the lint ratchet counts;
  // reading the clock beside the data it dates is also simply where it belongs. Then a SINGLE
  // timeout is armed at the next instant a dated claim changes
  // state — the start of a pending month or the end of a live one, whichever comes first —
  // and firing it re-reads the clock, which re-resolves the sections, which is the whole
  // mechanism by which a Book of the Month hides itself when its month ends without anybody
  // reloading the page. No polling: nextExpiryMs returns null when nothing is dated, and the
  // effect arms nothing at all.
  useEffect(() => {
    if (!now || !sectionRows) return undefined;
    const at = nextExpiryMs(sectionRows, now);
    if (at === null) return undefined;
    // setTimeout's delay is a signed 32-bit int; a claim months away overflows it and fires
    // immediately, which would spin. Clamp to a day and let the next tick re-arm.
    const delay = Math.min(at - now, 24 * 60 * 60 * 1000);
    const id = setTimeout(() => setNow(Date.now()), Math.max(delay, 1000));
    return () => clearTimeout(id);
  }, [now, sectionRows]);

  const openModal = (title, rect, reset) => { modalReset.current = reset; setModal({ title, rect }); };
  const closeModal = () => { if (modalReset.current) modalReset.current(); modalReset.current = null; setModal(null); };

  // No early return on curtain === 'checking' any more. It used to be `return null`, which was
  // correct while the bar lived inside storeReady — there was nothing to render before storage
  // had been read. Now the bar renders in EVERY state, so returning null would blank it for the
  // one frame between first paint and the effect, and the prerendered HTML would ship without it.
  // Hydration is still safe: the bar's markup is a pure function of the pathname, identical on
  // the server and on the first client render, and it is the ONLY thing rendered while
  // `curtain === 'checking'` — storeReady is false and the gate's slot is empty.

  // Only reachable from behind the curtain, because gateState stays 'checking' until `unlocked`
  // lets the A0 query run. A visitor without the key gets the gate, never the 404.
  if (unlocked && gateState === 'empty') notFound();

  const storeReady = unlocked && gateState === 'open';

  // R8.3. The hook is read here for the selector; every OTHER surface that prints money reads
  // the same module store directly (ShelfEntry, BoundBook, QuickLookModal, BuyButton), so
  // there is no prop to thread through the shelf and no context to provide. One store, one
  // document, one answer.
  const [currency, chooseCurrency, currencyChosen] = useCurrency();

  // The skeleton stands until ALL FOUR reads have landed AND the clock has been set, not just
  // the catalogue. A shop that painted its shelves and then grew a curated section a beat
  // later would be two different pages in the same scroll position.
  const loading = titles === null || genres === null || sectionRows === null || signals === null || now === 0;

  const genreLabelFor = (slug) => labelOf(genres || [], slug);

  // ── R13 — THE CLAIMS, RESOLVED ──────────────────────────────────────────────────────────
  //
  // Every hide-it decision in the shop now happens inside this one call: retired sections,
  // unclaimed sections, claims that no longer resolve, months that have ended, and the two
  // data-driven types that are dormant and have no data anyway. What comes back is what
  // renders — there is no empty state to handle and nothing for this component to decide.
  //
  // RESOLVED ONCE, against the clock in state.
  const curated = loading ? [] : resolveSections(sectionRows, titles, { now, signals });

  // ── THE BAND ────────────────────────────────────────────────────────────────────────────
  //
  // Stamped onto the title objects the WHOLE PAGE renders from, so the cover in the curated
  // section, the cover on the shelf below and the cover inside Quick Look are literally the
  // same object. That is what makes "the band and the section cannot disagree" a structural
  // fact rather than a promise: there is one input, and it came from the resolved claim.
  const banded = loading ? [] : applyBands(titles, bandsFor(curated));
  // The sections are re-POINTED at the banded objects rather than resolved a second time —
  // see rebindSections' note on why a second decision is not the same as a cheaper one.
  const curatedBanded = loading ? [] : rebindSections(curated, banded);

  const fictionTitles = titlesInGroup(genres, banded, 'fiction');
  const nonfictionTitles = titlesInGroup(genres, banded, 'nonfiction');
  const fictionGenresPresent = genresPresentIn(genres, fictionTitles, 'fiction');
  const nonfictionGenresPresent = genresPresentIn(genres, nonfictionTitles, 'nonfiction');

  // ── R15 — THE SCROLL ────────────────────────────────────────────────────────────────────
  //
  // Every resolved claim, distributed across the shop's own stops. The shelves handed in are
  // ONLY the ones about to be drawn — a half of the shop with no published titles is not on
  // the page, and a table placed into it degrades to the foot of the catalogue rather than
  // waiting somewhere invisible.
  //
  // ⚠ THE COUNTS ARE THE UNFILTERED SHELVES, always, and they are the same numbers the tabs
  // filter down from. `placeAfter` is a depth into the catalogue, not into whatever the reader
  // is currently looking at — see THE FILTERED-TAB RULING on CatalogueSection above.
  const shelvesOnPage = [];
  if (fictionTitles.length > 0) shelvesOnPage.push({ group: 'fiction', count: fictionTitles.length });
  if (nonfictionTitles.length > 0) shelvesOnPage.push({ group: 'nonfiction', count: nonfictionTitles.length });
  const flow = planShopFlow(curatedBanded, shelvesOnPage);

  const renderCurated = (sec) => (
    <CuratedSection
      key={sec.id}
      section={sec}
      genreLabelFor={genreLabelFor}
      onOpen={openModal}
      renderWindow={(t) => <TheWindow title={t} genreLabelFor={genreLabelFor} onOpen={openModal} />}
      renderEntry={(t, i, opts) => (
        <ShelfEntry title={t} index={i} onOpen={openModal} genreLabelFor={genreLabelFor} suppressMark={opts?.suppressMark} />
      )}
    />
  );
  // Opening Lines pool: published titles with a resolvable opening line (field or excerpt).
  const linesPool = loading ? [] : banded.filter((t) => resolveOpeningLine(t));
  const totalCount = loading ? 0 : titles.length;

  return (
    <>
      {/* R8.1: the storefront is a slot in a fragment whose SECOND slot is the curtain, and
          it stays a fragment in every state — including the one where this slot is empty.
          Returning <LaunchGate /> alone while locked and a fragment once open would change
          the root element type between renders, so React would unmount and remount the gate
          at the exact moment it is mid-lift, throwing away its `lifting` state. Same shape,
          same positions, always. */}
      {storeReady && (
        <>
        <Navbar />
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
          html{scroll-behavior:smooth}
          body{background:#070707;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
          ${BOUND_BOOK_CSS}
          ${CURRENCY_SELECTOR_CSS}
          ${SHOP_VERNACULAR_CSS}
          ${CURATED_SECTION_CSS}
          @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
          @keyframes pulse{0%,100%{opacity:.35}50%{opacity:.75}}
          @keyframes lampPulse{0%,100%{opacity:.5}50%{opacity:.9}}
          .skeleton{background:rgba(201,164,76,.08);border-radius:3px;animation:pulse 1.4s ease-in-out infinite}
          ${GRAIN_CSS}
          ${BOOK_TRANSITION_CSS}

          .hero{min-height:88vh;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;text-align:center;padding:2rem}
          .hero-lamp{position:absolute;inset:0;background:radial-gradient(ellipse 60% 44% at 50% 40%,rgba(201,164,76,.16) 0%,transparent 66%);animation:lampPulse 5.5s ease-in-out infinite}
          .hero-inner{position:relative;z-index:2;max-width:720px;animation:fadeUp .9s ease forwards}
          .hero-eyebrow{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.34em;text-transform:uppercase;color:#c9a44c;margin-bottom:2rem}
          .hero-title{line-height:.9;margin-bottom:1.8rem}
          .hero-the{display:block;font-family:'Cinzel',serif;font-weight:400;font-size:clamp(1.6rem,4vw,2.6rem);letter-spacing:.06em;color:rgba(240,234,216,.72)}
          /* ── THE MASTHEAD MIRROR ────────────────────────────────────────────────────
             The lockup asks for line-height:.9 on a face whose natural line box is 1.211em.
             CSS pays for that compression with HALF-LEADING, which means it is taken equally
             from both ends of the line — so (1.211 - .9) / 2 = .1555em came off ABOVE the
             display line. "The" ended up sitting on "Book Store"'s ink while the same air
             pooled underneath: measured at 390px, 5.00px above and 43.67px below.

             The fix HANDS THAT AIR BACK AND PAYS FOR IT FROM UNDERNEATH. It is one movement,
             not two: the top margin lets the display line down by exactly what the compression
             took, and the bottom margin gives the identical amount back to the flow, so the
             colophon and the edition line do not move at all. THAT IS THE TEST — if anything
             below the masthead moves, air was ADDED rather than TRANSFERRED and this is wrong
             however the title itself looks. tests/bookstore/masthead.spec.mjs measures the two
             lines below in absolute page coordinates for exactly that reason.

             ⚠ em, DELIBERATELY, AND NOT rem OR px. .hero-store is a clamp(), so its size is a
             different number at every viewport; an em is the display line's OWN size, so the
             air tracks the clamp with no media query and no second number to keep in step.

             The app repo carries the identical constant as HERO_LOCKUP_AIR — each site names
             the other, because the derivation is the shared thing and .1555 alone reads like a
             magic number in either repo. */
          .hero-store{display:block;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:clamp(3.6rem,10vw,7.6rem);color:#c9a44c;
            margin-top:.1555em;margin-bottom:-.1555em}
          .hero-colophon{font-size:1.05rem;font-style:italic;color:rgba(240,234,216,.5);line-height:1.7;max-width:520px;margin:0 auto 2.2rem}
          .hero-edition{font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.28em;text-transform:uppercase;color:rgba(201,164,76,.6)}
          .hero-currency{margin-top:1.6rem}

          .the-window{position:relative;z-index:2;max-width:1000px;margin:0 auto;padding:4rem 2rem 3rem}
          .window-plate{text-align:center;font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.3em;text-transform:uppercase;color:#c9a44c;margin-bottom:1.6rem}
          /* R13 — .curated-case and .curated-lamp are GROUPED ONTO these rules rather than
             described again in CuratedSection.js. The display case is one look and it has
             one description; two cases that must be identical and are written down twice
             will eventually be written down differently. The curated case differs only in
             its interior padding, which is the one line that follows. */
          .window-inner{position:relative;display:grid;grid-template-columns:auto 1fr;gap:3.5rem;align-items:center}
          .window-book{display:flex;justify-content:center;padding:1rem 1.4rem}
          .window-actions{display:flex;gap:.9rem;flex-wrap:wrap;align-items:center}

          .btn-buy{font-family:'Cinzel',serif;font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;padding:.85rem 1.9rem;border:none;border-radius:3px;background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;font-weight:600;cursor:pointer;transition:filter .25s,opacity .25s}
          .btn-buy:hover{filter:brightness(1.08)}
          .btn-buy:disabled{cursor:progress;opacity:.6;filter:none}
          /* R8.4 — unavailable is not pending. A progress cursor on a button that will never
             finish reads as a hang, so the territory state gets its own cursor and its own
             flatter face: gilt is the shop's affordance for "press me", and this cannot be
             pressed. It overrides the :disabled rule above because both apply at once. */
          .btn-buy[data-unavailable]{cursor:not-allowed;opacity:.55;background:none;border:1px solid rgba(201,164,76,.28);color:rgba(240,234,216,.55)}
          .btn-sample{font-family:'Cinzel',serif;font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;padding:.85rem 1.9rem;border:1px solid rgba(201,164,76,.4);border-radius:3px;background:rgba(201,164,76,.04);color:#c9a44c;font-weight:600;text-decoration:none}
          .btn-sample:hover{background:rgba(201,164,76,.1)}

          .rail{position:relative;z-index:2;max-width:760px;margin:0 auto;padding:3.5rem 2rem;text-align:center}
          .rail-eyebrow{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.3em;text-transform:uppercase;color:#c9a44c;margin-bottom:1.5rem}
          .rail-quote{font-size:clamp(1.3rem,3vw,1.9rem);font-style:italic;font-weight:300;line-height:1.5;color:#f0ead8;margin-bottom:1.8rem}
          /* R22B — THE PAGE TURN. See RAIL_TURN above for the record and the reasoning.
             .rail-quote and .rail-mark are the FRAME: neither carries a transition, so the
             quotation marks hold their place while the words travel between them.
             .rail-words is inline-block because a transform has no effect on an inline box. */
          .rail-mark{display:inline}
          .rail-words{display:inline-block;transition:opacity 420ms cubic-bezier(.4,0,.2,1),transform 420ms cubic-bezier(.4,0,.2,1)}
          .rail-words.is-out{opacity:0;transform:translateY(-9px)}
          .rail-words.is-in{opacity:0;transform:translateY(11px);transition:none}
          /* The attribution follows a beat behind — 60ms, which is enough to read as "and then
             the credit" and not enough to read as two separate animations. */
          .rail-attrib{transition:opacity 420ms cubic-bezier(.4,0,.2,1) 60ms,transform 420ms cubic-bezier(.4,0,.2,1) 60ms}
          .rail-attrib.is-out{opacity:0;transform:translateY(-9px)}
          .rail-attrib.is-in{opacity:0;transform:translateY(11px);transition:none}
          /* The motion IS the feature, so a reader who has asked for less of it gets the swap
             and not the turn. Instant, never a slower version of the same thing. */
          @media(prefers-reduced-motion:reduce){
            .rail-words,.rail-words.is-out,.rail-words.is-in,
            .rail-attrib,.rail-attrib.is-out,.rail-attrib.is-in{transition:none;transform:none;opacity:1}
          }
          .rail-reveal{display:flex;flex-direction:column;align-items:center;gap:1rem}
          .rail-answer{text-decoration:none;color:inherit}
          .rail-answer-title{display:block;font-family:'Cinzel',serif;font-size:.8rem;letter-spacing:.1em;color:#c9a44c}
          .rail-answer-author{display:block;font-size:.9rem;font-style:italic;color:rgba(240,234,216,.5);margin-top:.2rem}
          .rail-btn{font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;color:#c9a44c;background:none;border:1px solid rgba(201,164,76,.3);border-radius:3px;padding:.7rem 1.6rem;cursor:pointer;transition:all .2s}
          .rail-btn:hover{background:rgba(201,164,76,.08);border-color:rgba(201,164,76,.55)}

          /* R15 — .catalogue-section, .genre-tabs, .genre-tab and .shelf-empty moved to
             SHOP_VERNACULAR_CSS, interpolated above. The CMS preview now draws the real
             CatalogueSection around a placed table, so these are shared classes and the
             vernacular is where a shared class is described. Nothing about them changed. */

          .curation-band{position:relative;z-index:2;max-width:640px;margin:2rem auto;padding:2.5rem 2rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:1rem}
          .curation-band p{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:1.15rem;line-height:1.6;color:rgba(240,234,216,.6)}
          .colophon{position:relative;z-index:2;max-width:640px;margin:0 auto;padding:3rem 2rem 5rem;text-align:center}
          .colophon-rule{width:80px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 2rem}
          .colophon-text{font-size:.85rem;line-height:1.9;color:rgba(240,234,216,.4);font-style:italic}
          .colophon-mark{margin-top:1.5rem;color:rgba(201,164,76,.5)}

          @media(max-width:640px){
            /* The shelf grid and the catalogue's phone padding moved with their rules; the
               handset gap is now the vernacular's --shelf-row-gap / --shelf-col-gap, which is
               what the interleave's air is derived from. */
            .window-inner{grid-template-columns:1fr;gap:2rem;text-align:center}
            .window-book{padding:0}
            .window-pull{border-left:none;padding-left:0}
            .window-actions{justify-content:center}
          }
        `}</style>

        <main style={{ background: '#070707', color: '#f0ead8', position: 'relative' }}>
          {/* R20 — INSIDE <main>, AND THAT IS THE WHOLE OF THE UN-FIXING. It used to sit
              here as a SIBLING, which was fine while it was position:fixed and would be
              silently broken now: an absolutely positioned element with no positioned
              ancestor resolves against the viewport-sized initial containing block, so the
              grain would cover the first screenful and then stop. <main> is already
              position:relative, so it is the containing block and the grain is as tall as the
              document. See GRAIN_PARENT_RULE in ../components/grain.js. */}
          <div className={GRAIN_CLASS} aria-hidden="true" />
          <Hero count={totalCount} currency={currency} onCurrency={chooseCurrency} chosen={currencyChosen} />

          {loading ? (
            <SkeletonShelf />
          ) : (
            <>
              {/* ── THE OPENING ────────────────────────────────────────────────────────
                  R13 rendered EVERY resolved claim here, in CMS order, and R15 is Ikenna's
                  ruling on what that looked like once there were two of them: "they stack up
                  above the shop and it reads as a run of headers followed by the shop." So
                  this slot now holds only what is PLACED at the opening — the Window, and
                  whatever else a curator deliberately stands above the catalogue.

                  There is still no `flow.opening.length > 0 &&` guard and there still must not
                  be one. An empty list maps to nothing, which is the correct output of a shop
                  nobody has curated, and a guard here would be somewhere for an empty state to
                  grow later. */}
              {flow.opening.map(renderCurated)}

              {linesPool.length >= 2 && <OpeningLinesRail pool={linesPool} />}

              {fictionTitles.length > 0 && (
                <CatalogueSection
                  id="fiction" sectionLabel={groupLabel('fiction')} allLabel={`All ${groupLabel('fiction')}`}
                  titles={fictionTitles} genresPresent={fictionGenresPresent}
                  active={activeFiction} setActive={setActiveFiction} onOpen={openModal}
                  genreLabelFor={genreLabelFor}
                  interleaves={flow.shelves.fiction} renderSection={renderCurated}
                />
              )}

              {nonfictionTitles.length > 0 && (
                <CatalogueSection
                  id="nonfiction" sectionLabel={groupLabel('nonfiction')} allLabel={`All ${groupLabel('nonfiction')}`}
                  titles={nonfictionTitles} genresPresent={nonfictionGenresPresent}
                  active={activeNonfiction} setActive={setActiveNonfiction} onOpen={openModal}
                  genreLabelFor={genreLabelFor}
                  interleaves={flow.shelves.nonfiction} renderSection={renderCurated}
                />
              )}

              {/* THE FOOT — after the last shelf, above the curation band. Where a table
                  placed into a half of the shop that has not opened yet waits, and where a
                  curator can deliberately close the catalogue with one. */}
              {flow.foot.map(renderCurated)}

              <Colophon count={totalCount} />
            </>
          )}
        </main>

        {modal && <QuickLookModal title={modal.title} originRect={modal.rect} onClose={closeModal} />}
        </>
      )}

      {/* ── THE BAR SITS OUTSIDE BOTH SLOTS, AND R9 MUST NOT TAKE IT ────────────────────────
          It was inside `storeReady` until now, which meant a locked visitor got a full-screen
          curtain with no bar and no way back but the browser's own — and on an installed PWA
          there may be no back affordance at all. That is a dead end at the exact moment the tab
          is meant to prove the two platforms converge, so the bar is now unconditional: locked,
          checking, open, all three.

          THIS IS PLATFORM CHROME, NOT GATE MACHINERY. The delete list at the foot of
          app/lib/bookstore/gate.js (:101-115) names this file — it removes the LaunchGate import,
          the `curtain` state and the <LaunchGate /> slot below. It must NOT remove this line or
          the padding that clears it in LaunchGate.js. The bar outlives the curtain: after R9 the
          storefront still needs it, for exactly the reason the storefront needed it before R8.1.

          Book Store is lit. `active` is passed explicitly rather than left to activeTabFor's
          pathname read: this component is the storefront no matter which route reaches it, and
          stating that is cheaper than trusting every future route to keep matching. */}
      <TabBar active="store" />

      {/* The curtain outlives the unlock: `unlocked` is already true while this is still
          mounted, and that overlap is the reveal. It unmounts itself via onLifted. */}
      {curtain === 'up' && (
        <LaunchGate onUnlock={() => setUnlocked(true)} onLifted={() => setCurtain('gone')} />
      )}
    </>
  );
}
