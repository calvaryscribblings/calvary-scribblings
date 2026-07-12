'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { db } from '../lib/firebase';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { getAllPublishedTitles } from '../lib/bookstore/loader';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

// Fiction/non-fiction split, derived from genre. Exported so R3 (the detail page)
// can reuse the exact same mapping without re-deriving it. Every slug here is a
// member of GENRES in app/lib/bookstore/schema.js — keep the two in step.
export const FICTION_GENRES = ['literary-fiction', 'romance', 'thriller-suspense', 'sci-fi-fantasy', 'historical', 'short-story-collection', 'poetry'];
export const NONFICTION_GENRES = ['memoir-biography', 'essays', 'self-development', 'business-finance', 'politics-society'];

export function sectionForGenre(genre) {
  if (FICTION_GENRES.includes(genre)) return 'fiction';
  if (NONFICTION_GENRES.includes(genre)) return 'nonfiction';
  return null;
}

// Display labels for the genre slugs. Presentation-only — the stored value stays kebab-case.
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

// GBP only for now — a currency toggle (NGN/USD) is a later round. Prices are stored
// as integer minor units (pence): 499 → '£4.99'.
function formatGbp(minor) {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  return `£${(minor / 100).toFixed(2)}`;
}

// Deterministic gradient for the typographic fallback cover, keyed off the slug so a
// given title always draws the same colour. Fallback only fires if coverUrl is somehow
// null — published titles always carry a real cover.
const COLORS = {
  c1: 'linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%)',
  c2: 'linear-gradient(148deg,#0e1a2e 0%,#060e1a 100%)',
  c3: 'linear-gradient(148deg,#1a120a 0%,#0e0806 100%)',
  c4: 'linear-gradient(148deg,#0a1a12 0%,#060e08 100%)',
  c5: 'linear-gradient(148deg,#1a0a14 0%,#0e0608 100%)',
  c6: 'linear-gradient(148deg,#141418 0%,#08080e 100%)',
  c7: 'linear-gradient(148deg,#1a1a08 0%,#0e0e06 100%)',
  c8: 'linear-gradient(148deg,#0e0a1a 0%,#08060e 100%)',
};
function gradientFor(seed) {
  const keys = Object.keys(COLORS);
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[keys[h % keys.length]];
}

function countLabel(titles, genres) {
  return `${titles} ${titles === 1 ? 'title' : 'titles'} · ${genres} ${genres === 1 ? 'genre' : 'genres'}`;
}

function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2.5rem' }}>
      <div style={{ flex: 1, height: '1px', background: 'rgba(201,164,76,.12)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem' }}>
        <span style={{ color: 'rgba(201,164,76,.5)', fontSize: '.7rem' }}>&#10086;</span>
        <span style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.3em', textTransform: 'uppercase', color: '#c9a44c' }}>{label}</span>
      </div>
      <div style={{ flex: 1, height: '1px', background: 'rgba(201,164,76,.12)' }} />
    </div>
  );
}

// Real cover via next/image (unoptimized — output:'export' ships no image optimiser),
// 2:3 aspect, with a typographic gradient fallback if coverUrl is null.
function BookCover({ title, size = 'card' }) {
  const dims = size === 'featured'
    ? { width: 150, height: 225 }
    : size === 'mini'
      ? { width: 36, height: 54 }
      : { width: '100%', aspectRatio: '2/3' };
  const shadow = size === 'featured'
    ? '8px 12px 40px rgba(0,0,0,.85),0 0 0 1px rgba(201,164,76,.12),inset -4px 0 10px rgba(0,0,0,.4)'
    : size === 'mini'
      ? '2px 3px 10px rgba(0,0,0,.6)'
      : '4px 6px 24px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.03),inset -3px 0 6px rgba(0,0,0,.35)';
  const wrap = {
    position: 'relative', ...dims, borderRadius: '2px 4px 4px 2px', overflow: 'hidden',
    boxShadow: shadow, flexShrink: 0, background: gradientFor(title.slug || title.title),
  };

  if (title.coverUrl) {
    return (
      <div style={wrap}>
        <Image
          src={title.coverUrl} alt={title.title} fill unoptimized
          sizes={size === 'card' ? '(max-width:640px) 45vw, 180px' : `${dims.width}px`}
          style={{ objectFit: 'cover' }}
        />
      </div>
    );
  }

  // Typographic fallback — belt-and-braces; a published title should always have a cover.
  if (size === 'mini') return <div style={wrap} />;
  return (
    <div style={{ ...wrap, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.25rem .9rem', textAlign: 'center' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', background: 'rgba(0,0,0,.4)' }} />
      <div style={{ fontSize: size === 'featured' ? '.82rem' : '.78rem', fontWeight: 600, color: 'rgba(255,255,255,.85)', lineHeight: 1.25, marginBottom: '.4rem', position: 'relative', zIndex: 1, fontFamily: 'Cormorant Garamond, Georgia, serif' }}>{title.title}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.56rem', fontWeight: 500, letterSpacing: '.06em', color: 'rgba(255,255,255,.4)', fontStyle: 'italic', position: 'relative', zIndex: 1 }}>{title.author}</div>
    </div>
  );
}

function BookCard({ title }) {
  const price = formatGbp(title.prices?.gbp);
  // Whole card links to the R3 detail route — which does not exist yet, so clicks will
  // 404 until R3 lands. Intentional plumbing-ahead.
  return (
    <a href={`/bookstore/${title.slug}`} className="book-card" style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ marginBottom: '1rem' }}>
        <BookCover title={title} size="card" />
      </div>
      <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.56rem', fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.25rem' }}>{genreLabel(title.genre)}</div>
      <div style={{ fontSize: '.88rem', fontWeight: 600, color: '#f0ead8', lineHeight: 1.3, marginBottom: '.15rem' }}>{title.title}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.75rem', fontWeight: 500, fontStyle: 'italic', color: 'rgba(240,234,216,.45)', marginBottom: '.45rem' }}>{title.author}</div>
      {price && <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.85rem', fontWeight: 600, color: '#f0ead8' }}>{price}</div>}
    </a>
  );
}

function FeaturedCard({ title }) {
  const price = formatGbp(title.prices?.gbp);
  return (
    <a href={`/bookstore/${title.slug}`} className="featured-inner" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3rem', alignItems: 'center', padding: '2.5rem', marginBottom: '3.5rem', background: 'rgba(201,164,76,.03)', border: '1px solid rgba(201,164,76,.1)', position: 'relative', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ position: 'absolute', top: '1.2rem', right: '1.5rem', fontFamily: "'Cinzel',serif", fontSize: '.52rem', letterSpacing: '.28em', color: 'rgba(201,164,76,.4)' }}>FEATURED</div>
      <BookCover title={title} size="featured" />
      <div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.56rem', letterSpacing: '.22em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.6rem' }}>{genreLabel(title.genre)} &middot; Editor&rsquo;s Pick</div>
        <h2 style={{ fontSize: 'clamp(1.5rem,3vw,2.2rem)', fontWeight: 300, fontStyle: 'italic', color: '#f0ead8', lineHeight: 1.15, marginBottom: '.4rem' }}>{title.title}</h2>
        <p style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.82rem', fontWeight: 500, color: 'rgba(240,234,216,.45)', marginBottom: '1rem' }}>{title.author}</p>
        {title.synopsis && <p style={{ fontSize: '.92rem', lineHeight: 1.75, color: 'rgba(240,234,216,.6)', maxWidth: '440px', marginBottom: '1.5rem', fontStyle: 'italic' }}>{title.synopsis}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          {price && <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.05rem', fontWeight: 600, color: '#f0ead8' }}>{price}</span>}
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.22em', textTransform: 'uppercase', color: '#c9a44c' }}>Read more &rarr;</span>
        </div>
      </div>
    </a>
  );
}

function BestsellersStrip({ items }) {
  return (
    <div style={{ background: 'rgba(201,164,76,.04)', border: '1px solid rgba(201,164,76,.12)', padding: '1.5rem 2rem', marginBottom: '3rem' }}>
      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.25rem' }}>Bestsellers</div>
      <div style={{ display: 'flex', gap: '1.5rem', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '.25rem' }}>
        {items.map((t, i) => (
          <a key={t.id} href={`/bookstore/${t.slug}`} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0, minWidth: '200px', textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: '1.1rem', color: 'rgba(201,164,76,.35)', fontWeight: 600, width: '24px', textAlign: 'right' }}>{i + 1}</div>
            <BookCover title={t} size="mini" />
            <div>
              <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#f0ead8', lineHeight: 1.2, marginBottom: '2px' }}>{t.title}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.68rem', fontWeight: 500, color: 'rgba(240,234,216,.45)' }}>{t.author}</div>
              {t.salesCount > 0 && <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.58rem', fontWeight: 500, color: '#c9a44c', marginTop: '2px' }}>{t.salesCount.toLocaleString()} sold</div>}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function CatalogueSection({ id, sectionLabel, allLabel, topPad, titles, genresPresent, active, setActive }) {
  const featured = titles.find((t) => t.featured);
  const showFeatured = featured && (active === 'all' || active === featured.genre);
  const grid = titles.filter((t) => (active === 'all' || t.genre === active) && !(showFeatured && t.id === featured.id));
  const tabs = [{ key: 'all', label: allLabel }, ...genresPresent.map((g) => ({ key: g, label: genreLabel(g) }))];

  return (
    <section id={id} style={{ padding: topPad }}>
      <Divider label={sectionLabel} />
      <div className="genre-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`genre-tab${active === t.key ? ' active' : ''}`} onClick={() => setActive(t.key)}>{t.label}</button>
        ))}
      </div>
      {showFeatured && <FeaturedCard title={featured} />}
      {grid.length > 0
        ? <div className="shelf">{grid.map((t) => <BookCard key={t.id} title={t} />)}</div>
        : !showFeatured && (
          <p style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '1.05rem', color: 'rgba(240,234,216,.4)', textAlign: 'center', padding: '2rem 0' }}>Nothing on this shelf yet.</p>
        )}
    </section>
  );
}

function SkeletonShelf() {
  return (
    <section style={{ padding: '5rem 2.5rem 6rem' }}>
      <Divider label="The Shelves" />
      <div className="shelf">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton" style={{ width: '100%', aspectRatio: '2/3', borderRadius: '2px 4px 4px 2px', marginBottom: '1rem' }} />
            <div className="skeleton" style={{ height: '.55rem', width: '40%', marginBottom: '.5rem' }} />
            <div className="skeleton" style={{ height: '.8rem', width: '82%', marginBottom: '.45rem' }} />
            <div className="skeleton" style={{ height: '.7rem', width: '55%' }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Hero({ loading, fictionCount, fictionGenreCount, nonfictionCount, nonfictionGenreCount }) {
  const showFiction = fictionCount > 0;
  const showNonfiction = nonfictionCount > 0;
  return (
    <section style={{ height: '100vh', minHeight: '620px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', textAlign: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 55% at 50% 38%,rgba(107,47,173,.2) 0%,transparent 68%),linear-gradient(180deg,#060608 0%,#0d0810 50%,#060608 100%)' }} />
      <div style={{ position: 'relative', zIndex: 2, padding: '2rem', maxWidth: '680px', animation: 'fadeUp .8s ease forwards' }}>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.35em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'center' }}>
          <span style={{ height: '1px', width: '36px', background: 'linear-gradient(90deg,transparent,#c9a44c)', display: 'block' }} />
          Calvary Scribblings
          <span style={{ height: '1px', width: '36px', background: 'linear-gradient(90deg,#c9a44c,transparent)', display: 'block' }} />
        </div>
        <h1 style={{ fontSize: 'clamp(3.8rem,9vw,7.5rem)', fontWeight: 300, lineHeight: .92, color: '#f0ead8', marginBottom: '1.5rem' }}>The<br /><em style={{ fontStyle: 'italic', color: '#c9a44c' }}>Book Store</em></h1>
        <p style={{ fontSize: '1.05rem', fontStyle: 'italic', color: 'rgba(240,234,216,.45)', margin: '0 auto 3rem', lineHeight: 1.7 }}>Worlds waiting to be entered. Stories that stay with you long after the last page.</p>
        {!loading && (showFiction || showNonfiction) && (
          <div className="hero-doors" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {showFiction && (
              <a href="#fiction" className="door">
                <span style={{ fontFamily: "'Cinzel',serif", fontSize: '.55rem', letterSpacing: '.25em', textTransform: 'uppercase', color: '#c9a44c', position: 'relative' }}>Explore</span>
                <span style={{ fontSize: '1.55rem', fontWeight: 300, fontStyle: 'italic', position: 'relative' }}>Fiction</span>
                <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.65rem', fontWeight: 500, color: 'rgba(240,234,216,.45)', position: 'relative' }}>{countLabel(fictionCount, fictionGenreCount)}</span>
              </a>
            )}
            {showNonfiction && (
              <a href="#nonfiction" className="door">
                <span style={{ fontFamily: "'Cinzel',serif", fontSize: '.55rem', letterSpacing: '.25em', textTransform: 'uppercase', color: '#c9a44c', position: 'relative' }}>Explore</span>
                <span style={{ fontSize: '1.55rem', fontWeight: 300, fontStyle: 'italic', position: 'relative' }}>Non-Fiction</span>
                <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.65rem', fontWeight: 500, color: 'rgba(240,234,216,.45)', position: 'relative' }}>{countLabel(nonfictionCount, nonfictionGenreCount)}</span>
              </a>
            )}
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: '2.5rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem', color: 'rgba(240,234,216,.45)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.58rem', fontWeight: 500, letterSpacing: '.22em', textTransform: 'uppercase', animation: 'bob 2.2s ease-in-out infinite' }}>
        <div style={{ width: '1px', height: '30px', background: 'linear-gradient(to bottom,#c9a44c,transparent)' }} />
        Browse
      </div>
    </section>
  );
}

export default function BookStorePage() {
  const [gateState, setGateState] = useState('checking');
  const [titles, setTitles] = useState(null); // null until the catalogue load resolves
  const [activeFiction, setActiveFiction] = useState('all');
  const [activeNonfiction, setActiveNonfiction] = useState('all');

  // A0 runtime gate — unchanged. The route stays invisible (404) until at least one
  // title is published; once one is, the storefront is public (the old passcode is retired).
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

  // Once the gate is open, fetch the full published catalogue exactly once and derive
  // every view (genre filter, fiction/non-fiction split, featured, bestsellers) from
  // that single array client-side — no per-genre round trips.
  useEffect(() => {
    if (gateState !== 'open') return;
    let cancelled = false;
    (async () => {
      const list = await getAllPublishedTitles();
      if (!cancelled) setTitles(list);
    })();
    return () => { cancelled = true; };
  }, [gateState]);

  if (gateState === 'checking') return null;
  if (gateState === 'empty') notFound();

  const loading = titles === null;
  const fictionTitles = loading ? [] : titles.filter((t) => FICTION_GENRES.includes(t.genre));
  const nonfictionTitles = loading ? [] : titles.filter((t) => NONFICTION_GENRES.includes(t.genre));
  const fictionGenresPresent = FICTION_GENRES.filter((g) => fictionTitles.some((t) => t.genre === g));
  const nonfictionGenresPresent = NONFICTION_GENRES.filter((g) => nonfictionTitles.some((t) => t.genre === g));
  const bestsellers = loading ? [] : titles.filter((t) => t.bestseller).sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0));

  return (
    <>
      <Navbar />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
        html{scroll-behavior:smooth}
        body{background:#0a0a0a;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
        @keyframes bob{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(7px)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:.35}50%{opacity:.75}}
        .skeleton{background:rgba(201,164,76,.08);border-radius:3px;animation:pulse 1.4s ease-in-out infinite}
        .door{display:flex;flex-direction:column;align-items:center;gap:.4rem;padding:1.25rem 2.75rem;border:1px solid rgba(201,164,76,.22);background:rgba(201,164,76,.03);text-decoration:none;color:#f0ead8;transition:all .3s;cursor:pointer;position:relative;overflow:hidden}
        .door::before{content:'';position:absolute;inset:0;background:rgba(201,164,76,.06);transform:translateY(101%);transition:transform .3s}
        .door:hover::before{transform:translateY(0)}
        .door:hover{border-color:rgba(201,164,76,.45)}
        .genre-tabs{display:flex;overflow-x:auto;margin-bottom:3rem;scrollbar-width:none;border-bottom:1px solid rgba(255,255,255,.06)}
        .genre-tabs::-webkit-scrollbar{display:none}
        .genre-tab{padding:.7rem 1.3rem;white-space:nowrap;font-family:'Cormorant Garamond',Georgia,serif;font-size:.75rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,234,216,.45);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s}
        .genre-tab:hover{color:#f0ead8}
        .genre-tab.active{color:#c9a44c;border-bottom-color:#c9a44c}
        .shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:2.5rem 1.5rem}
        .book-card{transition:transform .25s ease}
        .book-card:hover{transform:translateY(-5px)}
        @media(max-width:640px){
          .shelf{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:2rem 1rem}
          .hero-doors{flex-direction:column;align-items:center}
          .door{width:100%;max-width:260px}
          .featured-inner{grid-template-columns:1fr !important;gap:1.5rem !important}
        }
      `}</style>

      <main style={{ background: '#0a0a0a', color: '#f0ead8' }}>
        <Hero
          loading={loading}
          fictionCount={fictionTitles.length}
          fictionGenreCount={fictionGenresPresent.length}
          nonfictionCount={nonfictionTitles.length}
          nonfictionGenreCount={nonfictionGenresPresent.length}
        />

        {loading ? (
          <SkeletonShelf />
        ) : (
          <>
            {bestsellers.length >= 3 && (
              <section style={{ padding: '4.5rem 2.5rem 0' }}>
                <BestsellersStrip items={bestsellers.slice(0, 10)} />
              </section>
            )}

            {fictionTitles.length > 0 && (
              <CatalogueSection
                id="fiction" sectionLabel="Fiction" allLabel="All Fiction" topPad="5rem 2.5rem 4rem"
                titles={fictionTitles} genresPresent={fictionGenresPresent}
                active={activeFiction} setActive={setActiveFiction}
              />
            )}

            {nonfictionTitles.length > 0 && (
              <CatalogueSection
                id="nonfiction" sectionLabel="Non-Fiction" allLabel="All Non-Fiction" topPad="2rem 2.5rem 6rem"
                titles={nonfictionTitles} genresPresent={nonfictionGenresPresent}
                active={activeNonfiction} setActive={setActiveNonfiction}
              />
            )}
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
