'use client';
import { useState, useEffect } from 'react';
import { categoryMeta } from '../lib/stories';
import StoryCard from '../components/StoryCard';
import { useUserStoryTiers } from '../lib/useUserStoryTiers';
import { resolveAuthorNames, withCurrentAuthorNames } from '../lib/resolveAuthorNames';

// Typography — matches the homepage overhaul (DISPLAY title + gold LABEL kicker).
const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

const cat = 'inspiring';
const meta = categoryMeta[cat];
const KICKER = 'THE LIGHT';

export default function InspiringPage() {
  const userTiersMap = useUserStoryTiers();
  const [allStories, setAllStories] = useState([]);

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
          // Secondary fetch: per-story read counts (stories/{id}/hits) to sort by
          // popularity. Stories with no hits data default to 0 and sort last.
          let hitsData = {};
          try {
            const hitsSnap = await get(ref(db, 'stories'));
            if (hitsSnap.exists()) hitsData = hitsSnap.val();
          } catch (e) {}
          const withHits = resolved.map(s => ({ ...s, hits: hitsData[s.id]?.hits || 0 }));
          withHits.sort((a, b) => (b.hits - a.hits) || (new Date(b.date) - new Date(a.date)));
          setAllStories(withHits);
        }
      } catch(e) { console.error('CMS fetch error:', e); }
    }
    fetchCMS();
  }, []);

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Cochin', Georgia, serif" }}>
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, padding: '0 4%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(10,10,10,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <img src="/logo-header.jpg" alt="CS" style={{ width: 38, height: 38, borderRadius: 7, objectFit: 'cover' }} />
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
        </a>
        <a href="/" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: '0.85rem' }} onMouseEnter={e => e.target.style.color = '#fff'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.5)'}>← Back to Home</a>
      </nav>
      <section style={{ padding: '4rem 4% 3rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontFamily: LABEL, fontSize: '0.7rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 14, display: 'block' }}>{KICKER}</span>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 600, color: '#f5f0e8', marginBottom: '0.75rem' }}>{meta.label}</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '1rem' }}>{allStories.length} stories</p>
      </section>
      <section style={{ padding: '3rem 4%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
          {allStories.map(s => <StoryCard key={s.id} story={s} userTier={userTiersMap[s.id]?.tier ?? null} scorePct={userTiersMap[s.id]?.scorePct} />)}
        </div>
      </section>
    </div>
  );
}
