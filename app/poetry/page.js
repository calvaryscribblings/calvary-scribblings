'use client';
import { useState, useEffect } from 'react';
import { categoryMeta } from '../lib/stories';
import StoryCard from '../components/StoryCard';
import { useUserStoryTiers } from '../lib/useUserStoryTiers';
import { resolveAuthorNames, withCurrentAuthorNames } from '../lib/resolveAuthorNames';
import TabBar, { TabLinks } from '../components/TabBar';

// Typography — matches the homepage overhaul (DISPLAY title + gold LABEL kicker).
const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

const cat = 'poetry';
const meta = categoryMeta[cat];
const KICKER = 'THE VERSE';
const DESCRIPTION = 'Language at its most precise. Words chosen like the last ones left.';

const SUBCATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'Love', label: 'Love' },
  { value: 'Grief', label: 'Grief' },
  { value: 'Political', label: 'Political' },
  { value: 'Nature', label: 'Nature' },
  { value: 'Spiritual', label: 'Spiritual' },
  { value: 'Spoken Word', label: 'Spoken Word' },
];

function sortBtnStyle(active) {
  return {
    fontFamily: LABEL, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    paddingBottom: active ? 1 : 0,
    color: active ? '#c9a84c' : 'rgba(245,240,232,0.28)',
    borderBottom: active ? '1px solid rgba(201,168,76,0.5)' : 'none',
  };
}

export default function PoetryPage() {
  const userTiersMap = useUserStoryTiers();
  const [allStories, setAllStories] = useState([]);
  const [sortMode, setSortMode] = useState('hits');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    async function fetchCMS() {
      try {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getDatabase, ref, get } = await import('firebase/database');
        const firebaseConfig = {
          apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
          authDomain: 'calvary-scribblings.firebaseapp.com',
          databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
          projectId: 'calvary-scribblings',
          storageBucket: 'calvary-scribblings.firebasestorage.app',
          messagingSenderId: '1052137412283',
          appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
        };
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getDatabase(app);
        const snap = await get(ref(db, 'cms_stories_index'));
        if (snap.exists()) {
          const now = Date.now();
          const cms = Object.entries(snap.val())
            .map(([id, s]) => ({ ...s, id }))
            .filter(s => s.category === cat && s.published !== false && (!s.publishAt || new Date(s.publishAt).getTime() <= now));
          const nameMap = await resolveAuthorNames(cms);
          const resolved = withCurrentAuthorNames(cms, nameMap);
          // Secondary fetch: per-story read counts (stories/{id}/hits) so the
          // "Most Read" sort works. Stories with no hits data default to 0.
          let hitsData = {};
          try {
            const hitsSnap = await get(ref(db, 'stories'));
            if (hitsSnap.exists()) hitsData = hitsSnap.val();
          } catch (e) {}
          const withHits = resolved.map(s => ({ ...s, hits: hitsData[s.id]?.hits || 0 }));
          setAllStories(withHits);
        }
      } catch(e) { console.error('CMS fetch error:', e); }
    }
    fetchCMS();
  }, []);

  // Filter by the active subcategory tab, then apply the Most Read / Newest sort
  // within that filtered set (sort never replaces the tab filter). Stories with
  // no subcategory only appear under "All".
  const filtered = activeTab === 'all'
    ? allStories
    : allStories.filter(s => s.subcategory === activeTab);
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

      {/* Hero — constellation motif (THE VERSE). */}
      <section className="cat-hero" data-reveal="fade" style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(200deg, #05102a 0%, #080610 50%)' }}>
        <svg viewBox="0 0 380 220" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.25 }}>
          <g stroke="#9a5fd6" strokeWidth="0.3" opacity="0.35">
            <line x1="190" y1="60" x2="120" y2="30" />
            <line x1="190" y1="60" x2="260" y2="45" />
            <line x1="120" y1="30" x2="160" y2="15" />
            <line x1="260" y1="45" x2="310" y2="25" />
            <line x1="80" y1="80" x2="50" y2="50" />
            <line x1="230" y1="90" x2="290" y2="110" />
          </g>
          <circle cx="190" cy="60" r="2" fill="#9a5fd6" />
          <circle cx="120" cy="30" r="1.5" fill="#c9a84c" />
          <circle cx="260" cy="45" r="2" fill="#9a5fd6" />
          <circle cx="80" cy="80" r="1" fill="#c9a84c" />
          <circle cx="310" cy="25" r="1.5" fill="#9a5fd6" />
          <circle cx="50" cy="50" r="1" fill="#c9a84c" />
          <circle cx="340" cy="70" r="2" fill="#9a5fd6" />
          <circle cx="160" cy="15" r="1" fill="#c9a84c" />
          <circle cx="230" cy="90" r="1.5" fill="#9a5fd6" />
          <circle cx="290" cy="110" r="1" fill="#c9a84c" />
          <circle cx="70" cy="120" r="2" fill="#9a5fd6" />
          <circle cx="350" cy="110" r="1.5" fill="#c9a84c" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(200deg, rgba(20,50,120,0.32) 0%, transparent 55%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #080610 0%, transparent 60%)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 20px 20px', zIndex: 2 }}>
          <span style={{ fontFamily: LABEL, fontSize: 9, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8, display: 'block' }}>{KICKER}</span>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(2rem, 8vw, 2.8rem)', fontWeight: 600, color: '#f5f0e8', lineHeight: 1, marginBottom: 10 }}>{meta.label}</h1>
          <p style={{ fontFamily: DISPLAY, fontSize: 13, fontStyle: 'italic', color: 'rgba(245,240,232,0.52)', lineHeight: 1.6, maxWidth: 280, margin: 0 }}>{DESCRIPTION}</p>
        </div>
      </section>

      {/* Sort / count bar. */}
      <div data-reveal="up" data-reveal-delay="1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#0c0918' }}>
        <span style={{ fontFamily: BODY, fontSize: 11, color: 'rgba(245,240,232,0.35)' }}>{sorted.length} stories</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button onClick={() => setSortMode('hits')} style={sortBtnStyle(sortMode === 'hits')}>Most Read</button>
          <button onClick={() => setSortMode('date')} style={sortBtnStyle(sortMode === 'date')}>Newest</button>
        </div>
      </div>

      {/* Subcategory filter tabs. */}
      <div data-reveal="up" data-reveal-delay="2" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '1.25rem 4%', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {SUBCATEGORIES.map(tab => (
          <button
            key={tab.value}
            className={`cat-tab${activeTab === tab.value ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Story grid — 2-col portrait cards matching the app, rank badges on Most Read. */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '0 16px 32px', marginTop: 16 }}>
        {sorted.map((s, i) => (
          <StoryCard
            key={s.id}
            story={s}
            userTier={userTiersMap[s.id]?.tier ?? null}
            scorePct={userTiersMap[s.id]?.scorePct}
            rank={sortMode === 'hits' ? i + 1 : null}
            data-reveal="up"
            data-reveal-delay={(i % 6) + 1}
          />
        ))}
      </section>
      <TabBar />
    </div>
  );
}
