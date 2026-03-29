'use client';
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { stories } from '../lib/stories';

const cat = "news";
const _filtered = stories.filter(s => s.category === cat).sort((a,b) => new Date(b.date) - new Date(a.date));
const badgeStyle = {
  news: { background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' },
};

function StoryCard({ story }) {
  return (
    <a href={story.url || '/stories/' + story.id} style={{
      textDecoration: 'none', display: 'block', borderRadius: 10, overflow: 'hidden',
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      transition: 'all 0.25s ease', cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.25)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}>
      <img src={story.cover} alt={story.title} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
      <div style={{ padding: '1.25rem' }}>
        <span style={{ ...badgeStyle.news, fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.15rem 0.5rem', borderRadius: 3, display: 'inline-block', marginBottom: '0.6rem' }}>
          {story.categoryName}
        </span>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', lineHeight: 1.4, marginBottom: '0.5rem' }}>{story.title}</div>
        <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>By {story.author} · {story.date}</div>
      </div>
    </a>
  );
}

export default function NewsPage() {
  const [allStories, setAllStories] = useState(_filtered);

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
            .filter(s => s.category === cat && (!s.publishAt || new Date(s.publishAt).getTime() <= now));
          setAllStories(prev => {
            const merged = [...cms, ...prev].filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);
            return merged.sort((a, b) => new Date(b.date) - new Date(a.date));
          });
        }
      } catch(e) { console.error('CMS fetch error:', e); }
    }
    fetchCMS();
  }, []);

  const filtered = stories.filter(s => s.category === 'news');
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cochin, Georgia, serif' }}>
      <Navbar />
      <section style={{ paddingTop: '7rem', paddingBottom: '3rem', paddingLeft: '4%', paddingRight: '4%', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#ef4444', marginBottom: '1rem', padding: '0.25em 0.75em', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3 }}>News & Updates</div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 700, color: '#fff', marginBottom: '0.75rem' }}>News & Updates</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '1rem' }}>{allStories.length} stories</p>
      </section>
      <section style={{ padding: '3rem 4%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
          {allStories.map(s => <StoryCard key={s.id} story={s} />)}
        </div>
      </section>
    </div>
  );
}
