'use client';
import { useState, useEffect, useRef } from 'react';
import { notFound } from 'next/navigation';
import { db } from '../lib/firebase';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { getAllPublishedTitles } from '../lib/bookstore/loader';
import Navbar from '../components/Navbar';
import BoundBook, { BOUND_BOOK_CSS } from './components/BoundBook';
import QuickLookModal from './components/QuickLookModal';
import { useBookGesture } from './components/useBookGesture';
import { formatGbp, resolveOpeningLine } from './components/fields';

// Fiction/non-fiction split, derived from genre. Exported so the detail page (R3) can reuse
// the exact same mapping without re-deriving it. Every slug here is a member of GENRES in
// app/lib/bookstore/schema.js — keep the two in step.
export const FICTION_GENRES = ['literary-fiction', 'romance', 'thriller-suspense', 'sci-fi-fantasy', 'historical', 'short-story-collection', 'poetry'];
export const NONFICTION_GENRES = ['memoir-biography', 'essays', 'self-development', 'business-finance', 'politics-society'];

export function sectionForGenre(genre) {
  if (FICTION_GENRES.includes(genre)) return 'fiction';
  if (NONFICTION_GENRES.includes(genre)) return 'nonfiction';
  return null;
}

const GENRE_LABELS = {
  'literary-fiction': 'Literary Fiction',
  'romance': 'Romance',
  'thriller-suspense': 'Thriller & Suspense',
  'sci-fi-fantasy': 'Sci-Fi & Fantasy',
  'historical': 'Historical',
  'short-story-collection': 'Short Story Collections',
  'poetry': 'Poetry',
  'memoir-biography': 'Memoir & Biography',
  'essays': 'Essays',
  'self-development': 'Self-Development',
  'business-finance': 'Business & Finance',
  'politics-society': 'Politics & Society',
};
const genreLabel = (g) => GENRE_LABELS[g] || g;

// ── Small ornaments ──────────────────────────────────────────────────────────
function Fleuron({ style }) {
  return <span style={{ color: 'rgba(201,164,76,.5)', ...style }}>&#10086;</span>;
}

// ── One shelf book: the gesture lives here, the modal is opened page-level ─────
function ShelfBook({ title, width, onOpen }) {
  const { flipped, bind, bookRef, reset } = useBookGesture({ onOpen: (rect) => onOpen(title, rect, reset) });
  return <BoundBook title={title} variant="shelf" width={width} flipped={flipped} bind={bind} bookRef={bookRef} />;
}

function ShelfEntry({ title, index, onOpen }) {
  const price = formatGbp(title.prices?.gbp);
  const hasNo = Number.isInteger(title.catalogueNumber);
  const tilt = index % 2 === 0 ? -0.7 : 0.7;
  return (
    <div className="shelf-entry">
      {hasNo && (
        <div className="no-divider"><span className="no-line" /><span className="no-label">No. {title.catalogueNumber}</span><span className="no-line" /></div>
      )}
      <div className="shelf-book-wrap">
        <ShelfBook title={title} width={150} onOpen={onOpen} />
      </div>
      <div className="entry-genre">{genreLabel(title.genre)}</div>
      <div className="entry-title">{title.title}</div>
      <div className="entry-author">{title.author}</div>
      {price && <div className="entry-price">{price}</div>}
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
function CatalogueSection({ id, sectionLabel, allLabel, titles, genresPresent, active, setActive, onOpen }) {
  const grid = titles.filter((t) => active === 'all' || t.genre === active);
  const tabs = [{ key: 'all', label: allLabel }, ...genresPresent.map((g) => ({ key: g, label: genreLabel(g) }))];
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
        ? <div className="shelf">{grid.map((t, i) => <ShelfEntry key={t.id} title={t} index={i} onOpen={onOpen} />)}</div>
        : <p className="shelf-empty">Nothing on this shelf yet.</p>}
    </section>
  );
}

// ── The Window: the featured title in the display case ────────────────────────
function TheWindow({ title }) {
  const price = formatGbp(title.prices?.gbp);
  const pull = resolveOpeningLine(title);
  const hasNo = Number.isInteger(title.catalogueNumber);
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
            <div className="window-kicker">{hasNo ? `No. ${title.catalogueNumber} · ` : ''}{genreLabel(title.genre)}</div>
            <h3 className="window-title">{title.title}</h3>
            <p className="window-author">by {title.author}</p>
            {pull && <p className="window-pull">&ldquo;{pull}&rdquo;</p>}
            {title.shelfCard && <p className="window-shelfcard">{title.shelfCard} <span>&mdash; Calvary</span></p>}
            <div className="window-actions">
              <button type="button" className="btn-buy" disabled title="Purchasing opens at launch">{price ? `Buy · ${price}` : 'Buy'}</button>
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
function Hero({ count }) {
  return (
    <section className="hero">
      <div className="hero-lamp" />
      <div className="hero-inner">
        <div className="hero-eyebrow">&#10086; Calvary Scribblings &#10086;</div>
        <h1 className="hero-title"><span className="hero-the">The</span><em className="hero-store">Book Store</em></h1>
        <p className="hero-colophon">A shop, not a warehouse. Every title on these shelves was chosen by hand.</p>
        <div className="hero-edition">Catalogue &middot; {count} {count === 1 ? 'Title' : 'Titles'} &middot; Est. 2026</div>
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
  const [activeFiction, setActiveFiction] = useState('all');
  const [activeNonfiction, setActiveNonfiction] = useState('all');
  const [modal, setModal] = useState(null); // { title, rect }
  const modalReset = useRef(null);

  // A0 runtime gate — UNCHANGED. Route stays invisible (404) until at least one title is
  // published; once one is, the storefront is public (the old passcode is retired).
  useEffect(() => {
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
  }, []);

  // Single-fetch data flow — UNCHANGED. Fetch the full published catalogue exactly once and
  // derive every view (genre filter, split, featured/window, opening lines) client-side.
  useEffect(() => {
    if (gateState !== 'open') return;
    let cancelled = false;
    (async () => {
      const list = await getAllPublishedTitles();
      if (!cancelled) setTitles(list);
    })();
    return () => { cancelled = true; };
  }, [gateState]);

  const openModal = (title, rect, reset) => { modalReset.current = reset; setModal({ title, rect }); };
  const closeModal = () => { if (modalReset.current) modalReset.current(); modalReset.current = null; setModal(null); };

  if (gateState === 'checking') return null;
  if (gateState === 'empty') notFound();

  const loading = titles === null;
  const fictionTitles = loading ? [] : titles.filter((t) => FICTION_GENRES.includes(t.genre));
  const nonfictionTitles = loading ? [] : titles.filter((t) => NONFICTION_GENRES.includes(t.genre));
  const fictionGenresPresent = FICTION_GENRES.filter((g) => fictionTitles.some((t) => t.genre === g));
  const nonfictionGenresPresent = NONFICTION_GENRES.filter((g) => nonfictionTitles.some((t) => t.genre === g));
  // The Window = the featured title, derived from the single fetch (equivalent to
  // getFeaturedTitles()[0] over the published set — no extra round trip).
  const windowTitle = loading ? null : titles.find((t) => t.featured) || null;
  // Opening Lines pool: published titles with a resolvable opening line (field or excerpt).
  const linesPool = loading ? [] : titles.filter((t) => resolveOpeningLine(t));
  const totalCount = loading ? 0 : titles.length;

  return (
    <>
      <Navbar />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
        html{scroll-behavior:smooth}
        body{background:#070707;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
        ${BOUND_BOOK_CSS}
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

        .the-window{position:relative;z-index:2;max-width:1000px;margin:0 auto;padding:4rem 2rem 3rem}
        .window-plate{text-align:center;font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.3em;text-transform:uppercase;color:#c9a44c;margin-bottom:1.6rem}
        .window-case{position:relative;border:1px solid rgba(201,164,76,.2);background:radial-gradient(ellipse 70% 60% at 50% 0%,rgba(201,164,76,.06),transparent 70%),rgba(255,255,255,.015);padding:3.5rem 3rem}
        .window-lamp{position:absolute;top:-1px;left:20%;right:20%;height:120px;background:radial-gradient(ellipse 60% 100% at 50% 0%,rgba(201,164,76,.18),transparent 72%);pointer-events:none}
        .fleuron-corner{position:absolute;color:rgba(201,164,76,.4);font-size:.9rem}
        .fleuron-corner.tl{top:.7rem;left:.9rem}.fleuron-corner.tr{top:.7rem;right:.9rem}
        .fleuron-corner.bl{bottom:.7rem;left:.9rem}.fleuron-corner.br{bottom:.7rem;right:.9rem}
        .window-inner{position:relative;display:grid;grid-template-columns:auto 1fr;gap:3.5rem;align-items:center}
        .window-book{display:flex;justify-content:center;padding:1rem 1.4rem}
        .window-kicker{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.22em;text-transform:uppercase;color:#c9a44c;margin-bottom:.8rem}
        .window-title{font-family:'Cinzel',serif;font-size:clamp(1.5rem,3vw,2.2rem);font-weight:600;color:#f0ead8;line-height:1.12;margin-bottom:.35rem}
        .window-author{font-size:1.05rem;font-style:italic;color:rgba(240,234,216,.5);margin-bottom:1.3rem}
        .window-pull{font-size:1.05rem;font-style:italic;line-height:1.6;color:rgba(240,234,216,.78);border-left:2px solid rgba(201,164,76,.35);padding-left:1.1rem;margin-bottom:1.2rem}
        .window-shelfcard{font-size:.92rem;line-height:1.6;color:rgba(240,234,216,.6);background:rgba(236,228,207,.06);border:1px solid rgba(201,164,76,.15);padding:.85rem 1.1rem;margin-bottom:1.5rem}
        .window-shelfcard span{font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.12em;color:#c9a44c}
        .window-actions{display:flex;gap:.9rem;flex-wrap:wrap;align-items:center}

        .btn-buy{font-family:'Cinzel',serif;font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;padding:.85rem 1.9rem;border:none;border-radius:3px;background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;font-weight:600;cursor:not-allowed;opacity:.55}
        .btn-sample{font-family:'Cinzel',serif;font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;padding:.85rem 1.9rem;border:1px solid rgba(201,164,76,.4);border-radius:3px;background:rgba(201,164,76,.04);color:#c9a44c;font-weight:600;text-decoration:none}
        .btn-sample:hover{background:rgba(201,164,76,.1)}
        .btn-details{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(240,234,216,.55);text-decoration:none;border-bottom:1px solid rgba(201,164,76,.25);padding-bottom:2px}

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
        .section-head{display:flex;align-items:center;gap:1.2rem;margin-bottom:2.5rem}
        .section-rule{flex:1;height:1px;background:rgba(201,164,76,.12)}
        .section-mark{font-size:.7rem}
        .section-title{font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.3em;text-transform:uppercase;color:#c9a44c;font-weight:600}
        .genre-tabs{display:flex;overflow-x:auto;margin-bottom:3rem;scrollbar-width:none;border-bottom:1px solid rgba(255,255,255,.06)}
        .genre-tabs::-webkit-scrollbar{display:none}
        .genre-tab{padding:.7rem 1.3rem;white-space:nowrap;font-family:'Cormorant Garamond',Georgia,serif;font-size:.75rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,234,216,.45);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s}
        .genre-tab:hover{color:#f0ead8}
        .genre-tab.active{color:#c9a44c;border-bottom-color:#c9a44c}
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
        .shelf-card{margin-top:1rem;background:#ece4cf;color:#2a2318;padding:.75rem .9rem;border-radius:1px;box-shadow:0 6px 18px rgba(0,0,0,.4);font-size:.72rem;line-height:1.5;max-width:190px}
        .shelf-card-body{display:block;font-style:italic}
        .shelf-card-sign{display:block;margin-top:.4rem;font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.12em;color:#7a5f24}
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
        <Hero count={totalCount} />

        {loading ? (
          <SkeletonShelf />
        ) : (
          <>
            {windowTitle && <TheWindow title={windowTitle} />}
            {linesPool.length >= 2 && <OpeningLinesRail pool={linesPool} />}

            {fictionTitles.length > 0 && (
              <CatalogueSection
                id="fiction" sectionLabel="Fiction" allLabel="All Fiction"
                titles={fictionTitles} genresPresent={fictionGenresPresent}
                active={activeFiction} setActive={setActiveFiction} onOpen={openModal}
              />
            )}

            {nonfictionTitles.length > 0 && (
              <CatalogueSection
                id="nonfiction" sectionLabel="Non-Fiction" allLabel="All Non-Fiction"
                titles={nonfictionTitles} genresPresent={nonfictionGenresPresent}
                active={activeNonfiction} setActive={setActiveNonfiction} onOpen={openModal}
              />
            )}

            <Colophon count={totalCount} />
          </>
        )}
      </main>

      {modal && <QuickLookModal title={modal.title} originRect={modal.rect} onClose={closeModal} />}
    </>
  );
}
