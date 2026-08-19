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
import { useBookGesture } from './components/useBookGesture';
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
import { genreLabel as labelOf, genresPresentIn, titlesInGroup } from '../lib/bookstore/genres';
import { resolveSections, bandsFor, applyBands, rebindSections, nextExpiryMs } from '../lib/bookstore/sections';
import CuratedSection, { CURATED_SECTION_CSS } from './components/CuratedSection';
import { SHOP_VERNACULAR_CSS } from './components/shopVernacular';

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

// ── One shelf book: the gesture lives here, the modal is opened page-level ─────
function ShelfBook({ title, width, onOpen }) {
  const { flipped, bind, bookRef, reset } = useBookGesture({ onOpen: (rect) => onOpen(title, rect, reset) });
  return <BoundBook title={title} variant="shelf" width={width} flipped={flipped} bind={bind} bookRef={bookRef} />;
}

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
        <ShelfBook title={title} width={150} onOpen={onOpen} />
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
function CatalogueSection({ id, sectionLabel, allLabel, titles, genresPresent, active, setActive, onOpen, genreLabelFor }) {
  const grid = titles.filter((t) => active === 'all' || t.genre === active);
  // R13 — genresPresent is now taxonomy RECORDS rather than slugs, so the tab carries the
  // curator's label and the curator's order. The rule it encodes is unchanged and is now
  // stated once, in genres.js: All Fiction first, then only genres holding a published title.
  // An empty genre is absent, not an empty tab.
  const tabs = [{ key: 'all', label: allLabel }, ...genresPresent.map((g) => ({ key: g.slug, label: g.label }))];
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
        ? <div className="shelf">{grid.map((t, i) => <ShelfEntry key={t.id} title={t} index={i} onOpen={onOpen} genreLabelFor={genreLabelFor} />)}</div>
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
export function TheWindow({ title, genreLabelFor }) {
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
            <BoundBook title={title} variant="window" width={190} ribbon />
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

// ── Opening Lines rail: rotating quote → reveal → next ────────────────────────
function OpeningLinesRail({ pool }) {
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const entry = pool[i % pool.length];
  const line = resolveOpeningLine(entry);
  const advance = () => { setRevealed(false); setI((n) => (n + 1) % pool.length); };
  return (
    <section className="rail">
      <div className="rail-eyebrow"><Fleuron /> Opening Lines <Fleuron /></div>
      <blockquote className="rail-quote">&ldquo;{line}&rdquo;</blockquote>
      {revealed ? (
        <div className="rail-reveal">
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
      // The catalogue is awaited FIRST because getSections needs it: the bootstrap builds the
      // Window's claim out of the published titles, and asking for the same list twice to
      // avoid one await would be the round trip this file's header says it avoids.
      const [g, s, sig] = await Promise.all([getGenres(), getSections(list), getSignals()]);
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
          @keyframes grainShift{0%{transform:translate(0,0)}10%{transform:translate(-3%,-2%)}20%{transform:translate(-8%,4%)}30%{transform:translate(3%,-8%)}40%{transform:translate(-2%,9%)}50%{transform:translate(-8%,3%)}60%{transform:translate(4%,-2%)}70%{transform:translate(-4%,6%)}80%{transform:translate(6%,3%)}90%{transform:translate(-2%,-4%)}}
          .skeleton{background:rgba(201,164,76,.08);border-radius:3px;animation:pulse 1.4s ease-in-out infinite}
          .bookstore-grain{position:fixed;inset:-50%;z-index:1;pointer-events:none;opacity:.05;
            background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.6) 0,rgba(0,0,0,.6) 1px,transparent 1px,transparent 2px),repeating-linear-gradient(90deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 3px);
            animation:grainShift 8s steps(10) infinite}

          .hero{min-height:88vh;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;text-align:center;padding:2rem}
          .hero-lamp{position:absolute;inset:0;background:radial-gradient(ellipse 60% 44% at 50% 40%,rgba(201,164,76,.16) 0%,transparent 66%);animation:lampPulse 5.5s ease-in-out infinite}
          .hero-inner{position:relative;z-index:2;max-width:720px;animation:fadeUp .9s ease forwards}
          .hero-eyebrow{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.34em;text-transform:uppercase;color:#c9a44c;margin-bottom:2rem}
          .hero-title{line-height:.9;margin-bottom:1.8rem}
          .hero-the{display:block;font-family:'Cinzel',serif;font-weight:400;font-size:clamp(1.6rem,4vw,2.6rem);letter-spacing:.06em;color:rgba(240,234,216,.72)}
          .hero-store{display:block;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:clamp(3.6rem,10vw,7.6rem);color:#c9a44c}
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
          .rail-reveal{display:flex;flex-direction:column;align-items:center;gap:1rem}
          .rail-answer{text-decoration:none;color:inherit}
          .rail-answer-title{display:block;font-family:'Cinzel',serif;font-size:.8rem;letter-spacing:.1em;color:#c9a44c}
          .rail-answer-author{display:block;font-size:.9rem;font-style:italic;color:rgba(240,234,216,.5);margin-top:.2rem}
          .rail-btn{font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;color:#c9a44c;background:none;border:1px solid rgba(201,164,76,.3);border-radius:3px;padding:.7rem 1.6rem;cursor:pointer;transition:all .2s}
          .rail-btn:hover{background:rgba(201,164,76,.08);border-color:rgba(201,164,76,.55)}

          .catalogue-section{position:relative;z-index:2;max-width:1120px;margin:0 auto;padding:4rem 2.5rem}
          .genre-tabs{display:flex;overflow-x:auto;margin-bottom:3rem;scrollbar-width:none;border-bottom:1px solid rgba(255,255,255,.06)}
          .genre-tabs::-webkit-scrollbar{display:none}
          .genre-tab{padding:.7rem 1.3rem;white-space:nowrap;font-family:'Cormorant Garamond',Georgia,serif;font-size:.75rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,234,216,.45);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s}
          .genre-tab:hover{color:#f0ead8}
          .genre-tab.active{color:#c9a44c;border-bottom-color:#c9a44c}
          /* R8.3 — the mark. Lowercase, small, italic, muted, and NOTHING else: no border,
             no background, no colour that could be read as a warning. It states a fact about
             which money the price is in. */
          .shelf-empty{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:1.05rem;color:rgba(240,234,216,.4);text-align:center;padding:2rem 0}

          .curation-band{position:relative;z-index:2;max-width:640px;margin:2rem auto;padding:2.5rem 2rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:1rem}
          .curation-band p{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:1.15rem;line-height:1.6;color:rgba(240,234,216,.6)}
          .colophon{position:relative;z-index:2;max-width:640px;margin:0 auto;padding:3rem 2rem 5rem;text-align:center}
          .colophon-rule{width:80px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 2rem}
          .colophon-text{font-size:.85rem;line-height:1.9;color:rgba(240,234,216,.4);font-style:italic}
          .colophon-mark{margin-top:1.5rem;color:rgba(201,164,76,.5)}

          @media(max-width:640px){
            .shelf{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:2.75rem 1rem}
            .window-inner{grid-template-columns:1fr;gap:2rem;text-align:center}
            .window-book{padding:0}
            .window-pull{border-left:none;padding-left:0}
            .window-actions{justify-content:center}
            .catalogue-section{padding:3rem 1.25rem}
          }
        `}</style>

        <div className="bookstore-grain" aria-hidden="true" />

        <main style={{ background: '#070707', color: '#f0ead8', position: 'relative' }}>
          <Hero count={totalCount} currency={currency} onCurrency={chooseCurrency} chosen={currencyChosen} />

          {loading ? (
            <SkeletonShelf />
          ) : (
            <>
              {/* ── R13 — THE CURATED BAND ──────────────────────────────────────────────
                  In CMS ORDER, and nothing else decides it. The Window is one of these when
                  a WINDOW section claims a book, and at order 0 it lands exactly where it
                  has always been: first thing under the hero.

                  There is no `curated.length > 0 &&` guard and there must not be one. An
                  empty list maps to nothing, which is the correct output of a shop nobody
                  has curated — and a guard here would be somewhere for an empty state to
                  grow later. */}
              {curatedBanded.map((sec) => (
                <CuratedSection
                  key={sec.id}
                  section={sec}
                  genreLabelFor={genreLabelFor}
                  renderWindow={(t) => <TheWindow title={t} genreLabelFor={genreLabelFor} />}
                  renderEntry={(t, i, opts) => (
                    <ShelfEntry title={t} index={i} onOpen={openModal} genreLabelFor={genreLabelFor} suppressMark={opts?.suppressMark} />
                  )}
                />
              ))}

              {linesPool.length >= 2 && <OpeningLinesRail pool={linesPool} />}

              {fictionTitles.length > 0 && (
                <CatalogueSection
                  id="fiction" sectionLabel="Fiction" allLabel="All Fiction"
                  titles={fictionTitles} genresPresent={fictionGenresPresent}
                  active={activeFiction} setActive={setActiveFiction} onOpen={openModal}
                  genreLabelFor={genreLabelFor}
                />
              )}

              {nonfictionTitles.length > 0 && (
                <CatalogueSection
                  id="nonfiction" sectionLabel="Non-Fiction" allLabel="All Non-Fiction"
                  titles={nonfictionTitles} genresPresent={nonfictionGenresPresent}
                  active={activeNonfiction} setActive={setActiveNonfiction} onOpen={openModal}
                  genreLabelFor={genreLabelFor}
                />
              )}

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
