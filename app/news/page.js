'use client';
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { stories } from '../lib/stories';
import QuizPill from '../components/QuizPill';
import { useUserStoryTiers } from '../lib/useUserStoryTiers';
import { resolveAuthorNames, withCurrentAuthorNames } from '../lib/resolveAuthorNames';

const cat = 'news';

// Typography — matches the homepage overhaul (DISPLAY title + gold LABEL kicker).
const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "'Cochin', Georgia, serif";
const KICKER = 'THE BRIEF';
const DESCRIPTION = "What's happening on the Island and beyond. Straight to the point.";

const SUBCATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'Op-Ed', label: 'Op-Ed' },
  { value: 'Essay', label: 'Essay' },
  { value: 'Music', label: 'Music' },
  { value: 'Film', label: 'Film' },
  { value: 'Tech', label: 'Tech' },
  { value: 'Science', label: 'Science' },
  { value: 'Business', label: 'Business' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Sport', label: 'Sport' },
  { value: 'Politics', label: 'Politics' },
  { value: 'Culture', label: 'Culture' },
];

const _filtered = stories.filter(s => s.category === cat).sort((a, b) => new Date(b.date) - new Date(a.date));

function sortBtnStyle(active) {
  return {
    fontFamily: LABEL, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    paddingBottom: active ? 1 : 0,
    color: active ? '#c9a84c' : 'rgba(245,240,232,0.28)',
    borderBottom: active ? '1px solid rgba(201,168,76,0.5)' : 'none',
  };
}

function StoryCard({ story, userTier = null, scorePct }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a href={story.url || '/stories/' + story.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none', display: 'block', borderRadius: 10, overflow: 'hidden',
        background: hovered ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
        border: hovered ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(255,255,255,0.07)',
        transition: 'all 0.25s ease', cursor: 'pointer', position: 'relative',
      }}>
      <img src={story.cover} alt={story.title} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
      <QuizPill hasQuiz={story.quizMeta?.hasQuiz || false} userTier={userTier} scribblesReward={story.quizMeta?.scribblesReward || 50} scorePct={scorePct} />
      <div style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.6rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.15rem 0.5rem', borderRadius: 3, display: 'inline-block', background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' }}>
            News
          </span>
          {story.subcategory && (
            <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.15rem 0.5rem', borderRadius: 3, display: 'inline-block', background: 'rgba(220,38,38,0.1)', color: '#fca5a5', border: '1px solid rgba(220,38,38,0.2)' }}>
              {story.subcategory}
            </span>
          )}
        </div>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', lineHeight: 1.4, marginBottom: '0.5rem' }}>{story.title}</div>
        <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>By {story.author} · {story.date}</div>
      </div>
    </a>
  );
}

export default function NewsPage() {
  const userTiersMap = useUserStoryTiers();
  const [allStories, setAllStories] = useState(_filtered);
  const [activeTab, setActiveTab] = useState('all');
  const [sortMode, setSortMode] = useState('hits');

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
        const snap = await get(ref(db, 'cms_stories'));
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
  // within that filtered set (sort never replaces the tab filter).
  const filtered = activeTab === 'all'
    ? allStories
    : allStories.filter(s => s.subcategory === activeTab || s.categoryName === activeTab);
  const displayed = [...filtered].sort((a, b) =>
    sortMode === 'hits'
      ? (b.hits - a.hits) || (new Date(b.date) - new Date(a.date))
      : (new Date(b.date) - new Date(a.date))
  );

  // Only show tabs that have at least one story
  const availableTabs = SUBCATEGORIES.filter(tab =>
    tab.value === 'all' || allStories.some(s => s.subcategory === tab.value || s.categoryName === tab.value)
  );

  return (
    <div style={{ background: '#080610', minHeight: '100vh', color: '#fff', fontFamily: BODY }}>
      <style>{`
        .cat-hero { min-height: 220px; }
        @media (min-width: 768px) { .cat-hero { min-height: 260px; } }
        .news-tab { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 0.35rem 1rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45); cursor: pointer; font-family: Cochin, Georgia, serif; transition: all 0.2s; white-space: nowrap; }
        .news-tab:hover { border-color: rgba(239,68,68,0.4); color: #f87171; }
        .news-tab.active { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.5); color: #f87171; }
      `}</style>
      <Navbar />

      {/* Hero — newsprint column-rule motif (THE BRIEF). */}
      <section className="cat-hero" style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg, #0a0e18 0%, #080610 60%)' }}>
        <svg viewBox="0 0 380 220" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.12 }}>
          {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360].map(x => (
            <line key={x} x1={x} y1="0" x2={x} y2="220" stroke="#94a3b8" strokeWidth={x === 0 ? 1 : 0.5} />
          ))}
          <line x1="0" y1="0" x2="380" y2="0" stroke="#94a3b8" strokeWidth="1" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(40,55,80,0.28) 0%, transparent 60%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #080610 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 20px 20px', zIndex: 2 }}>
          <span style={{ fontFamily: LABEL, fontSize: 9, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8, display: 'block' }}>{KICKER}</span>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(2rem, 8vw, 2.8rem)', fontWeight: 600, color: '#f5f0e8', lineHeight: 1, marginBottom: 10 }}>News &amp; Updates</h1>
          <p style={{ fontFamily: DISPLAY, fontSize: 13, fontStyle: 'italic', color: 'rgba(245,240,232,0.52)', lineHeight: 1.6, maxWidth: 280, margin: 0 }}>{DESCRIPTION}</p>
        </div>
      </section>

      {/* Sort / count bar. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#0c0918' }}>
        <span style={{ fontFamily: BODY, fontSize: 11, color: 'rgba(245,240,232,0.35)' }}>{displayed.length} stories</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button onClick={() => setSortMode('hits')} style={sortBtnStyle(sortMode === 'hits')}>Most Read</button>
          <button onClick={() => setSortMode('date')} style={sortBtnStyle(sortMode === 'date')}>Newest</button>
        </div>
      </div>

      {/* Subcategory filter tabs (preserved). */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '1.25rem 4%', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {availableTabs.map(tab => (
          <button
            key={tab.value}
            className={`news-tab${activeTab === tab.value ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      <section style={{ padding: '3rem 4%' }}>
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: '4rem 0', fontStyle: 'italic' }}>
            No stories in this category yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
            {displayed.map(s => <StoryCard key={s.id} story={s} userTier={userTiersMap[s.id]?.tier ?? null} scorePct={userTiersMap[s.id]?.scorePct} />)}
          </div>
        )}
      </section>
    </div>
  );
}
