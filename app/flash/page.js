'use client';
import { useState } from 'react';
import { categoryMeta } from '../lib/stories';
import StoryCard from '../components/StoryCard';
import { useReliableLoad } from '../lib/useReliable';
import { loadCategoryShelf, countLabel } from '../lib/categoryShelf';
import ShelfState from '../components/ShelfState';
import TabBar, { TabLinks } from '../components/TabBar';
import { tabsPresentIn, inSubcategory } from '../lib/taxonomy';

// Typography — matches the homepage overhaul (DISPLAY title + gold LABEL kicker).
const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

const cat = 'flash';
const meta = categoryMeta[cat];
const NOUN = ['story', 'stories'];
const EMPTY = 'Nothing on this shelf yet.';
const SUBJECT = `the ${meta.label} shelf`;
const KICKER = 'THE FLASH';
const DESCRIPTION = 'Stories that arrive fast and leave a mark. Under 300 words — every one counts.';

function sortBtnStyle(active) {
  return {
    fontFamily: LABEL, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    paddingBottom: active ? 1 : 0,
    color: active ? '#c9a84c' : 'rgba(245,240,232,0.28)',
    borderBottom: active ? '1px solid rgba(201,168,76,0.5)' : 'none',
  };
}

export default function FlashPage() {
  // W2 / STORY-04 — the shelf's read, with a deadline and a designed failure (categoryShelf.js).
  const shelf = useReliableLoad(() => loadCategoryShelf(cat), []);
  const allStories = shelf.data || [];
  const [sortMode, setSortMode] = useState('hits');
  const [activeTab, setActiveTab] = useState('all');

  // Filter by the active subcategory tab, then apply the Most Read / Newest sort
  // within that filtered set (sort never replaces the tab filter). Stories with
  // no subcategory only appear under "All".
  const filtered = activeTab === 'all'
    ? allStories
    : allStories.filter(s => inSubcategory(s, activeTab));
  const sorted = [...filtered].sort((a, b) =>
    sortMode === 'hits'
      ? (b.hits - a.hits) || (new Date(b.date) - new Date(a.date))
      : (new Date(b.date) - new Date(a.date))
  );

  return (
    <div style={{ background: '#080610', minHeight: '100vh', fontFamily: BODY }}>
      <style>{`
        .cat-hero { min-height: 220px; }
        @media (min-width: 768px) { .cat-hero { min-height: 260px; } }
        .cat-tab { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 0.35rem 1rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45); cursor: pointer; font-family: Cormorant Garamond, Georgia, serif; transition: all 0.2s; white-space: nowrap; }
        .cat-tab:hover { border-color: rgba(107,47,173,0.5); color: #c4b5fd; }
        .cat-tab.active { background: #6b2fad; border-color: #6b2fad; color: #f5f0e8; }
      `}</style>
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, padding: '0 4%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(8,6,16,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <a href="/public-library" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <img src="/logo-header.jpg" alt="CS" style={{ width: 38, height: 38, borderRadius: 7, objectFit: 'cover' }} />
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
        </a>
        <TabLinks />
      </nav>

      {/* Hero — diagonal speed-lines motif (THE FLASH). */}
      <section className="cat-hero" data-reveal="fade" style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg, #1a0535 0%, #080610 60%)' }}>
        <svg viewBox="0 0 380 220" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.18 }}>
          <defs><pattern id="pf" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M0 30 L30 0" stroke="#6b2fad" strokeWidth="1" fill="none" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#pf)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(107,47,173,0.35) 0%, transparent 60%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #080610 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 20px 20px', zIndex: 2 }}>
          <span style={{ fontFamily: LABEL, fontSize: 9, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8, display: 'block' }}>{KICKER}</span>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(2rem, 8vw, 2.8rem)', fontWeight: 600, color: '#f5f0e8', lineHeight: 1, marginBottom: 10 }}>{meta.label}</h1>
          <p style={{ fontFamily: DISPLAY, fontSize: 13, fontStyle: 'italic', color: 'rgba(245,240,232,0.52)', lineHeight: 1.6, maxWidth: 280, margin: 0 }}>{DESCRIPTION}</p>
        </div>
      </section>

      {/* Sort / count bar. */}
      <div data-reveal="up" data-reveal-delay="1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#0c0918' }}>
        <span style={{ fontFamily: BODY, fontSize: 11, color: 'rgba(245,240,232,0.35)' }}>{countLabel(shelf, sorted.length, NOUN)}</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button onClick={() => setSortMode('hits')} style={sortBtnStyle(sortMode === 'hits')}>Most Read</button>
          <button onClick={() => setSortMode('date')} style={sortBtnStyle(sortMode === 'date')}>Newest</button>
        </div>
      </div>

      {/* Subcategory filter tabs. */}
      <div data-reveal="up" data-reveal-delay="2" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '1.25rem 4%', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {tabsPresentIn(cat, allStories).map(tab => (
          <button
            key={tab.value}
            className={`cat-tab${activeTab === tab.value ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Story grid — 2-col portrait cards matching the app, rank badges on Most Read. */}
      {shelf.phase !== 'ready' || sorted.length === 0 ? (
        <ShelfState shelf={shelf} count={sorted.length} empty={EMPTY} subject={SUBJECT} />
      ) : (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '0 16px 32px', marginTop: 16 }}>
          {sorted.map((s, i) => (
            <StoryCard
              key={s.id}
              story={s}
              rank={sortMode === 'hits' ? i + 1 : null}
              data-reveal="up"
              data-reveal-delay={(i % 6) + 1}
            />
          ))}
        </section>
      )}
      <TabBar />
    </div>
  );
}
