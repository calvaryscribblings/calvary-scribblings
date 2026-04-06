'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './lib/AuthContext';
import AuthModal from './components/AuthModal';
import Navbar from './components/Navbar';

const stories = [
  { id: 'my-dream-man', title: 'My Dream Man', category: 'flash', categoryName: 'Flash Fiction', url: '/stories/my-dream-man', cover: '/my-dream-man-cover.jpeg', author: 'Tricia Ajax', date: 'Mar 27, 2026' },
  { id: 'the-enabler', title: 'The Enabler', category: 'flash', categoryName: 'Flash Fiction', url: '/stories/the-enabler', cover: '/the-enabler-cover.jpeg', author: 'Ufedo Adaji', date: 'Mar 26, 2026' },
  { id: 'rise-and-shine', title: 'Rise and Shine', category: 'flash', categoryName: 'Flash Fiction', url: '/stories/rise-and-shine', cover: '/rise-and-shine-cover.jpeg', author: 'Ufedo Adaji', date: 'Mar 21, 2026' },
  { id: 'an-appetite-for-love', title: 'An Appetite for Love', category: 'poetry', categoryName: 'Poetry', url: '/stories/an-appetite-for-love', cover: '/an-appetite-for-love-cover.png', author: 'Ufedo Adaji', date: 'Mar 19, 2026' },
  { id: 'dont-worry', title: "Don't Worry", category: 'flash', categoryName: 'Flash Fiction', url: '/stories/dont-worry', cover: '/dont-worry-cover.jpeg', author: 'Ufedo Adaji', date: 'Mar 19, 2026' },
  { id: 'terms-and-conditions', title: 'Terms and Conditions', category: 'short', categoryName: 'Short Story', url: '/stories/terms-and-conditions', cover: '/terms-and-conditions-cover.jpeg', author: 'Tricia Ajax', date: 'Mar 18, 2026' },
  { id: 'oscars-2026', title: 'The Oscar Showdowns', category: 'news', categoryName: 'Film', url: '/stories/oscars-2026', cover: '/oscars-2026-cover.jpeg', author: 'Chioma Okonkwo', date: 'Mar 16, 2026' },
  { id: 'how-to-make-peppersoup', title: 'How to Make Peppersoup', category: 'inspiring', categoryName: 'Inspiring', url: '/stories/how-to-make-peppersoup', cover: '/peppersoup-cover.jpeg', author: 'Ufedo Adaji', date: 'Mar 15, 2026' },
  { id: 'this-is-nigeria', title: 'This is Nigeria', category: 'news', categoryName: 'Op-Ed', url: '/stories/this-is-nigeria', cover: '/this-is-nigeria-cover.jpeg', author: 'Ikenna Okpara', date: 'Mar 13, 2026' },
  { id: 'london-tube-strike', title: 'Another London Underground Strike!', category: 'news', categoryName: 'News', url: '/stories/london-tube-strike', cover: '/london-tube-strike-cover.jpeg', author: 'Chioma Okonkwo', date: 'Mar 10, 2026' },
  { id: 'the-bride-box-office', title: 'Why The Bride Struggled at the Box Office', category: 'news', categoryName: 'News', url: '/stories/the-bride-box-office', cover: '/the-bride-box-office-cover.jpeg', author: 'Chioma Okonkwo', date: 'Mar 10, 2026' },
  { id: '1967', title: '1967', category: 'short', categoryName: 'Short Story', url: '/stories/1967', cover: '/1967-cover.jpeg', author: 'Ikenna Okpara', date: 'Mar 7, 2026' },
  { id: 'you-didnt-ask', title: "You Didn't Ask", category: 'short', categoryName: 'Short Story', url: '/stories/you-didnt-ask', cover: '/you-didnt-ask-cover.jpg', author: 'Tricia Ajax', date: 'Mar 4, 2026' },
  { id: 'macbook-neo', title: 'The All New MacBook Neo!', category: 'news', categoryName: 'Tech', url: '/stories/macbook-neo', cover: '/macbook-neo-cover.PNG', author: 'Chioma Okonkwo', date: 'Mar 5, 2026' },
  { id: 'netflix-harry-styles', title: "Netflix to Stream Harry Styles' New Album", category: 'news', categoryName: 'News', url: '/stories/netflix-harry-styles', cover: '/netflix-harry-styles-cover.jpg', author: 'Chioma Okonkwo', date: 'Mar 4, 2026' },
  { id: 'paramount-wbd-plans', title: 'Paramount Reveals Plans for the Future', category: 'news', categoryName: 'News', url: '/stories/paramount-wbd-plans', cover: '/paramount-wbd-plans-cover.jpg', author: 'Calvary', date: 'Mar 2, 2026' },
  { id: 'paramount-warner-bros-discovery', title: 'Hollywood Reacts: Paramount Moves to Take Control of WBD', category: 'news', categoryName: 'News', url: '/stories/paramount-warner-bros-discovery', cover: '/paramount-warner-bros-discovery-cover.jpg', author: 'Chioma Okonkwo', date: 'Feb 28, 2026' },
  { id: 'the-girl-who-sang-through-the-dark', title: 'The Girl Who Sang Through the Dark', category: 'inspiring', categoryName: 'Inspiring', url: '/stories/the-girl-who-sang-through-the-dark', cover: '/the-girl-who-sang-through-the-dark-cover.jpg', author: 'Tricia Ajax', date: 'Feb 26, 2026' },
  { id: 'john-davidson-bafta-tourettes', title: "The Man in the Middle: John Davidson", category: 'news', categoryName: 'News', url: '/stories/john-davidson-bafta-tourettes', cover: '/john-davidson-bafta-cover.jpeg', author: 'Chioma Okonkwo', date: 'Feb 25, 2026' },
  { id: 'bafta-2026', title: 'BAFTA 2026: Winners...', category: 'news', categoryName: 'News', url: '/stories/bafta-2026', cover: '/bafta-2026-cover.webp', author: 'Chioma Okonkwo', date: 'Feb 23, 2026' },
  { id: 'mother-and-other-poems', title: 'Mother and Other Poems', category: 'poetry', categoryName: 'Poetry', url: '/stories/mother-and-other-poems', cover: '/mother-poems-cover.PNG', author: 'Calvary', date: 'Feb 22, 2026' },
  { id: 'early', title: 'Early', category: 'short', categoryName: 'Short Story', url: '/stories/early', cover: '/early-cover.png', author: 'Calvary', date: 'Feb 18, 2026' },
  { id: 'miss-lady', title: 'Miss Lady', category: 'flash', categoryName: 'Flash Fiction', url: '/stories/miss-lady', cover: '/B4E36CD1-7C81-4ED0-BD27-63A125FDFD2D.png', author: 'Calvary', date: 'Feb 17, 2026' },
];

function parseDate(str) { return new Date(str); }
function isNew(s) { return (Date.now() - parseDate(s.date)) / 86400000 <= 7; }

function getLondonHour() {
  const now = new Date();
  return parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
}

function isSquareOpen() {
  const h = getLondonHour();
  return h >= 20 && h < 24;
}

function getCountdown() {
  const now = new Date();
  const londonTime = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const h = londonTime.getHours(), m = londonTime.getMinutes(), s = londonTime.getSeconds();
  let secs;
  if (h >= 20) {
    secs = (24 - h - 1) * 3600 + (59 - m) * 60 + (60 - s);
  } else {
    secs = (20 - h - 1) * 3600 + (59 - m) * 60 + (60 - s);
  }
  const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

const badgeStyle = {
  news: { background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' },
  flash: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  short: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  poetry: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  inspiring: { background: 'rgba(217,119,6,0.2)', color: '#fcd34d', border: '1px solid rgba(217,119,6,0.4)' },
};

const _sorted = [...stories]
  .map((s, i) => ({ ...s, _idx: i }))
  .sort((a, b) => parseDate(b.date) - parseDate(a.date) || a._idx - b._idx);
const justAdded = _sorted.slice(0, 5);

function getHourlyCarousel() {
  const h = Math.floor(Date.now() / 3600000);
  return [..._sorted].sort((a, b) => ((a.id.charCodeAt(0) * h) % 13) - ((b.id.charCodeAt(0) * h) % 13)).slice(0, 5);
}

function StoryCard({ story, width = 160, height = 240 }) {
  const [hovered, setHovered] = useState(false);
  const badge = badgeStyle[story.category] || badgeStyle.news;
  return (
    <a href={story.url}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none', flexShrink: 0, width,
        borderRadius: 8, overflow: 'hidden', display: 'block',
        position: 'relative', cursor: 'pointer',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
        transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s ease',
        boxShadow: hovered ? '0 25px 60px rgba(0,0,0,0.9), 0 0 0 1px rgba(139,92,246,0.3)' : '0 4px 20px rgba(0,0,0,0.5)',
      }}>
      <img src={story.cover} alt={story.title}
        style={{ width: '100%', height, objectFit: 'cover', display: 'block',
          filter: hovered ? 'brightness(0.75)' : 'brightness(0.9)',
          transition: 'filter 0.3s ease' }} />
      {isNew(story) && (
        <span style={{
          position: 'absolute', top: 8, left: 8,
          background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
          color: '#fff', fontSize: '0.5rem', fontWeight: 800,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          padding: '0.2rem 0.5rem', borderRadius: 3,
          boxShadow: '0 2px 8px rgba(124,58,237,0.6)',
        }}>New</span>
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.6) 55%, transparent 100%)',
        padding: '2.5rem 0.85rem 0.9rem',
      }}>
        <span style={{ ...badge, fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.15rem 0.45rem', borderRadius: 3, display: 'inline-block', marginBottom: '0.4rem' }}>
          {story.categoryName}
        </span>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff', lineHeight: 1.35, marginBottom: '0.25rem' }}>{story.title}</div>
        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.75)' }}>{story.author}</div>
      </div>
    </a>
  );
}

function JustAddedCard({ story }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a href={story.url}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.6rem 0.75rem', borderRadius: 8, flexShrink: 0,
        background: hovered ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.03)',
        border: hovered ? '1px solid rgba(139,92,246,0.25)' : '1px solid rgba(255,255,255,0.06)',
        transition: 'all 0.25s ease', width: 260, minWidth: 260,
      }}>
      <img src={story.cover} alt={story.title}
        style={{ width: 56, height: 72, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ffffff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 6 }}>
            {story.title}
          </div>
          {story.isNew && (
            <span style={{
              background: '#7c3aed', color: '#fff', fontSize: '0.6rem',
              fontWeight: 700, padding: '2px 6px', borderRadius: 3,
              letterSpacing: '0.06em', flexShrink: 0,
            }}>NEW</span>
          )}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.65)' }}>
          By {story.author} · {story.date}
        </div>
      </div>
    </a>
  );
}

function Row({ title, stories, seeAll }) {
  return (
    <section style={{ padding: '2rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0 4%' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>{title}</h3>
        <a href={seeAll}
          style={{ fontSize: '0.8rem', color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}
          onMouseEnter={e => e.target.style.color = '#c4b5fd'}
          onMouseLeave={e => e.target.style.color = '#a78bfa'}>
          See all →
        </a>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '1rem', scrollbarWidth: 'none' }}>
        {stories.map(s => <StoryCard key={s.id} story={s} />)}
      </div>
    </section>
  );
}

function Top10Card({ s, i }) {
  const [active, setActive] = useState(false);
  const CARD_WIDTH = 120;
  const CARD_HEIGHT = 180;
  const NUM_W = 60;
  const VB_H = 300;
  const strokeColor = active ? 'rgba(167,139,250,0.7)' : 'rgba(255,255,255,0.18)';
  return (
    <a href={s.url}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      style={{
        textDecoration: 'none', flexShrink: 0,
        width: CARD_WIDTH + NUM_W, height: CARD_HEIGHT,
        display: 'block', position: 'relative',
        transform: active ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
        marginRight: '0.25rem', overflow: 'visible',
      }}>
      <svg width={NUM_W} height={CARD_HEIGHT} viewBox={`0 0 ${NUM_W} ${VB_H}`}
        preserveAspectRatio="xMaxYMax meet" overflow="visible"
        style={{ position: 'absolute', left: 0, top: 0, zIndex: 1, overflow: 'visible' }}>
        <text x={NUM_W - 2} y={VB_H} textAnchor="end" dominantBaseline="text-after-edge"
          fontFamily="Georgia, serif" fontSize="120" fontWeight="900"
          fill="none" stroke={strokeColor} strokeWidth="1.5" paintOrder="stroke">
          {i + 1}
        </text>
      </svg>
      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: CARD_WIDTH, height: CARD_HEIGHT,
        borderRadius: 8, overflow: 'hidden', background: '#111',
        boxShadow: active ? '0 20px 50px rgba(0,0,0,0.9), 0 0 0 1px rgba(124,58,237,0.3)' : '0 4px 20px rgba(0,0,0,0.6)',
        transition: 'box-shadow 0.3s',
      }}>
        <img src={s.cover} alt={s.title} style={{
          width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          filter: active ? 'brightness(0.85)' : 'brightness(1)',
          transition: 'filter 0.3s',
        }} />
      </div>
    </a>
  );
}

function SquareBanner({ squareOpen, countdown }) {
  const [hovered, setHovered] = useState(false);
  return (
    <section style={{ padding: '0 4%', margin: '1.5rem 0' }}>
      <a href="/square"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
          padding: '14px 20px', borderRadius: 14, textDecoration: 'none',
          background: squareOpen
            ? hovered ? 'rgba(107,47,173,0.15)' : 'rgba(107,47,173,0.08)'
            : 'rgba(255,255,255,0.02)',
          border: squareOpen
            ? `1px solid rgba(107,47,173,${hovered ? '0.45' : '0.28'})`
            : '1px solid rgba(255,255,255,0.06)',
          transition: 'all 0.2s',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: squareOpen ? '#6b2fad' : 'rgba(107,47,173,0.15)',
            border: squareOpen ? 'none' : '1px solid rgba(107,47,173,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: squareOpen ? 'none' : 'sq-lockglow 1.8s ease-in-out infinite',
          }}>
            {squareOpen ? (
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 600, color: '#fff', lineHeight: 1 }}>S</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9b6dff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            )}
          </div>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: squareOpen ? '#f5f0e8' : 'rgba(255,255,255,0.35)', marginBottom: 3 }}>
              The Scribblings Square
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              {squareOpen ? (
                <>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1d9e75', display: 'inline-block', animation: 'sq-pulse 2s infinite' }} />
                  <span style={{ color: '#1d9e75', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Open now</span>
                  <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)' }}>Join the conversation</span>
                </>
              ) : (
                <span style={{ color: 'rgba(255,255,255,0.22)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Opens tonight at 8pm London time</span>
              )}
            </div>
          </div>
        </div>
        {squareOpen ? (
          <div style={{
            background: '#6b2fad', borderRadius: 8, padding: '7px 18px',
            fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: '#fff', flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            Enter the Square
          </div>
        ) : (
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: 'rgba(155,109,255,0.55)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {countdown}
          </div>
        )}
      </a>
    </section>
  );
}

function SquareFAB({ squareOpen, countdown }) {
  return (
    <a href="/square" style={{
      position: 'fixed', bottom: 24, right: 20, zIndex: 900,
      display: 'flex', alignItems: 'center', gap: 8,
      background: squareOpen ? '#6b2fad' : 'rgba(10,10,10,0.95)',
      border: squareOpen ? 'none' : '1px solid rgba(107,47,173,0.4)',
      borderRadius: 40,
      padding: '11px 18px 11px 14px',
      textDecoration: 'none',
      boxShadow: squareOpen
        ? '0 4px 24px rgba(107,47,173,0.5)'
        : '0 4px 24px rgba(0,0,0,0.6)',
    }}>
      {squareOpen ? (
        <div style={{
          width: 18, height: 18, borderRadius: 5,
          background: 'rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: 11, fontWeight: 600, color: '#fff', lineHeight: 1 }}>S</span>
        </div>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9b6dff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'sq-lockglow-icon 1.8s ease-in-out infinite', flexShrink: 0 }}>
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      )}
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: squareOpen ? '#fff' : 'rgba(155,109,255,0.8)',
      }}>
        {squareOpen ? 'The Square' : countdown}
      </span>
      {squareOpen && (
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#1d9e75',
          border: '1.5px solid #6b2fad',
          animation: 'sq-pulse 2s infinite',
          display: 'inline-block',
        }} />
      )}
    </a>
  );
}

export default function Home() {
  const { user, logout } = useAuth();
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroTransition, setHeroTransition] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [top10, setTop10] = useState([...stories].slice(0, 10));
  const [email, setEmail] = useState('');
  const [subscribeStatus, setSubscribeStatus] = useState('');
  const [squareOpen, setSquareOpen] = useState(false);
  const [countdown, setCountdown] = useState('');
  const heroIndexRef = useRef(0);
  const [allStories, setAllStories] = useState(stories);
  const [carousel, setCarousel] = useState(_sorted.slice(0, 5));

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Square open/closed + countdown
  useEffect(() => {
    const tick = () => {
      setSquareOpen(isSquareOpen());
      setCountdown(getCountdown());
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchCMSStories() {
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
          const data = snap.val();
          const now = new Date();
          const cmsStories = Object.entries(data)
            .map(([id, s]) => ({ ...s, id }))
            .filter(s => s.published !== false && (!s.publishAt || new Date(s.publishAt) <= now));
          setAllStories(prev => {
            const merged = [...cmsStories, ...prev].filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);
            merged.sort((a, b) => parseDate(b.date) - parseDate(a.date));
            return merged;
          });
        }
      } catch(e) { console.error('CMS merge error:', e); }
    }
    fetchCMSStories();
  }, []);

  useEffect(() => {
    setCarousel(getHourlyCarousel());
    const hourTimer = setInterval(() => {
      heroIndexRef.current = 0;
      setHeroIndex(0);
      setCarousel(getHourlyCarousel());
    }, 3600000);
    return () => clearInterval(hourTimer);
  }, []);

  useEffect(() => {
  if (allStories.length === 0) return;
  async function fetchTop10() {
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
      const snapshot = await get(ref(db, 'stories'));
      if (snapshot.exists()) {
        const data = snapshot.val();
        const withCounts = allStories.map(s => ({ ...s, hits: (data[s.id] && data[s.id].hits) || 0 }));
        setTop10(withCounts.sort((a, b) => b.hits - a.hits).slice(0, 10));
      }
    } catch (e) {
      console.error('Firebase Top 10 error:', e);
    }
  }
  fetchTop10();
}, [allStories]);

  const handleSubscribe = async () => {
    if (!email || !email.includes('@')) { setSubscribeStatus('Please enter a valid email address.'); return; }
    try {
      const res = await fetch('https://calvary-newsletter.calvarymediauk.workers.dev/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubscribeStatus("Thank you! You're now subscribed.");
        setEmail('');
      } else if (res.status === 409) {
        setSubscribeStatus('You are already subscribed.');
      } else {
        setSubscribeStatus('Something went wrong. Please try again.');
      }
    } catch (e) {
      setSubscribeStatus('Something went wrong. Please try again.');
    }
  };

  const goTo = useCallback((idx) => {
    setHeroTransition(false);
    setTimeout(() => {
      heroIndexRef.current = idx;
      setHeroIndex(idx);
      setHeroTransition(true);
    }, 300);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = (heroIndexRef.current + 1) % carousel.length;
      setHeroTransition(false);
      setTimeout(() => {
        heroIndexRef.current = next;
        setHeroIndex(next);
        setHeroTransition(true);
      }, 300);
    }, 5000);
    return () => clearInterval(timer);
  }, [carousel.length]);

  const featured = carousel[heroIndex];
  const badge = badgeStyle[featured.category] || badgeStyle.news;

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: "'Cochin', Georgia, serif" }}>
      <style>{`
        @media (max-width: 1024px) { .nav-desktop { display: none !important; } .nav-hamburger { display: flex !important; } }
        @media (min-width: 1025px) { .nav-desktop { display: flex !important; } .nav-hamburger { display: none !important; } }
        .top10-scroll { scrollbar-width: none; } .top10-scroll::-webkit-scrollbar { display: none; }
        .just-added-scroll { scrollbar-width: none; } .just-added-scroll::-webkit-scrollbar { display: none; }
        .sq-banner-desktop { display: block; }
        .sq-fab-mobile { display: none; }
        @media (max-width: 1024px) {
          .sq-banner-desktop { display: none !important; }
          .sq-fab-mobile { display: flex !important; }
        }
        @keyframes sq-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes sq-lockglow { 0%,100%{background:rgba(107,47,173,0.1)} 50%{background:rgba(107,47,173,0.22)} }
        @keyframes sq-lockglow-icon { 0%,100%{opacity:0.6} 50%{opacity:1} }
      `}</style>

      <Navbar />

      {/* Hero Carousel */}
      <section style={{ position: 'relative', height: '88vh', minHeight: 600, overflow: 'hidden' }}>
        {carousel.map((s, i) => (
          <img key={s.id} src={s.cover} alt={s.title}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center top',
              filter: 'brightness(0.55)',
              opacity: i === heroIndex ? (heroTransition ? 1 : 0) : 0,
              transition: 'opacity 0.7s ease',
              zIndex: 0,
            }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(105deg, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.5) 60%, transparent 100%)', zIndex: 1 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #0a0a0a 0%, transparent 45%)', zIndex: 1 }} />

        <div style={{
          position: 'absolute', bottom: '12%', left: '4%', maxWidth: 560, zIndex: 2,
          opacity: heroTransition ? 1 : 0,
          transform: heroTransition ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.5s ease, transform 0.5s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <span style={{ width: 3, height: 18, background: 'linear-gradient(to bottom, #7c3aed, #a855f7)', borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#c4b5fd' }}>Featured Story</span>
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 700, lineHeight: 1.1, marginBottom: '0.75rem', color: '#ffffff', textShadow: '0 2px 30px rgba(0,0,0,0.6)' }}>
            {featured.title}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.95rem', marginBottom: '1.75rem' }}>
            By {featured.author} · {featured.date}
          </p>
          <a href={featured.url} style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            background: '#fff', color: '#0a0a0a',
            padding: '0.75rem 1.75rem', borderRadius: 6, fontWeight: 700, fontSize: '0.9rem',
            textDecoration: 'none', transition: 'all 0.2s',
            boxShadow: '0 4px 20px rgba(255,255,255,0.15)',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e8e0ff'; e.currentTarget.style.transform = 'scale(1.03)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.transform = 'scale(1)'; }}>
            ▶ Read Now
          </a>
        </div>

        <div style={{ position: 'absolute', bottom: '5%', left: '4%', zIndex: 3, display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {carousel.map((_, i) => (
              <button key={i} onClick={() => goTo(i)} style={{
                width: i === heroIndex ? 24 : 8, height: 4, borderRadius: 2,
                border: 'none', cursor: 'pointer',
                background: i === heroIndex ? '#a855f7' : 'rgba(255,255,255,0.3)',
                transition: 'all 0.3s ease', padding: 0,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => goTo((heroIndex - 1 + carousel.length) % carousel.length)}
              style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.4)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.target.style.background = 'rgba(124,58,237,0.4)'; e.target.style.borderColor = 'rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.target.style.background = 'rgba(0,0,0,0.4)'; e.target.style.borderColor = 'rgba(255,255,255,0.2)'; }}>‹</button>
            <button onClick={() => goTo((heroIndex + 1) % carousel.length)}
              style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.4)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.target.style.background = 'rgba(124,58,237,0.4)'; e.target.style.borderColor = 'rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.target.style.background = 'rgba(0,0,0,0.4)'; e.target.style.borderColor = 'rgba(255,255,255,0.2)'; }}>›</button>
          </div>
        </div>

        <div style={{
          position: 'absolute', right: '3%', top: '50%', transform: 'translateY(-50%)',
          zIndex: 3, display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          {carousel.map((s, i) => (
            <button key={s.id} onClick={() => goTo(i)} style={{
              width: 56, height: 72, borderRadius: 6, overflow: 'hidden', border: 'none',
              cursor: 'pointer', padding: 0,
              opacity: i === heroIndex ? 1 : 0.45,
              transform: i === heroIndex ? 'scale(1.08)' : 'scale(1)',
              transition: 'all 0.3s ease',
              boxShadow: i === heroIndex ? '0 0 0 2px #a855f7, 0 8px 24px rgba(0,0,0,0.6)' : '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              <img src={s.cover} alt={s.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </button>
          ))}
        </div>
      </section>

      {/* Square Banner — desktop only */}
      <div className="sq-banner-desktop">
        <SquareBanner squareOpen={squareOpen} countdown={countdown} />
      </div>

      {/* Just Added */}
      <section style={{ padding: '2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#7c3aed', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '4%' }}>
          <span style={{ width: 6, height: 6, background: '#7c3aed', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 8px rgba(124,58,237,0.8)' }} />
          Just Added
        </h3>
        <div className="just-added-scroll" style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '1rem', scrollbarWidth: 'none' }}>
          {[...allStories].sort((a,b) => parseDate(b.date)-parseDate(a.date)).slice(0,5).map(s => <JustAddedCard key={s.id} story={s} />)}
        </div>
      </section>

      {/* Top 10 */}
      <section style={{ padding: '2.5rem 0' }}>
        <div style={{ padding: '0 4%', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>🔥 Top 10 Stories</h3>
          <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.3rem', letterSpacing: '0.05em' }}>Ranked by reads</p>
        </div>
        <div className="top10-scroll" style={{ display: 'flex', gap: '0', overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '1rem' }}>
          {top10.map((s, i) => <Top10Card key={s.id} s={s} i={i} />)}
        </div>
      </section>

      <Row title="⚡ Flash Fiction" stories={allStories.filter(s => s.category === 'flash')} seeAll="/flash" />
      <Row title="📖 Short Stories" stories={allStories.filter(s => s.category === 'short')} seeAll="/short" />
      <Row title="🖊️ Poetry" stories={allStories.filter(s => s.category === 'poetry')} seeAll="/poetry" />
      <Row title="🗞️ News & Updates" stories={allStories.filter(s => s.category === 'news')} seeAll="/news" />
      <Row title="✨ Inspiring Stories" stories={allStories.filter(s => s.category === 'inspiring')} seeAll="/inspiring" />

      {/* Subscribe */}
      <section id="subscribe" style={{
        padding: '6rem 4%', textAlign: 'center',
        background: 'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(168,85,247,0.06) 100%)',
        borderTop: '1px solid rgba(124,58,237,0.15)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '0.85rem', color: '#ffffff', lineHeight: 1.2 }}>Never Miss a Story</h2>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '1rem', marginBottom: '2.5rem', lineHeight: 1.7 }}>
            Subscribe to our newsletter and get the latest stories delivered to your inbox.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <input type="email" placeholder="Enter your email address" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubscribe()}
              style={{ flex: 1, minWidth: 250, padding: '0.85rem 1.25rem', borderRadius: 6, border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)', color: '#fff', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={handleSubscribe}
              style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', padding: '0.85rem 1.75rem', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 20px rgba(124,58,237,0.4)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.target.style.transform = 'scale(1.04)'; e.target.style.boxShadow = '0 6px 28px rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.target.style.transform = 'scale(1)'; e.target.style.boxShadow = '0 4px 20px rgba(124,58,237,0.4)'; }}>
              Subscribe
            </button>
          </div>
          {subscribeStatus && (
            <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: subscribeStatus.includes('Thank') ? '#a3e635' : '#f87171' }}>
              {subscribeStatus}
            </p>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: '#111111', padding: '4rem 4% 2rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '3rem', marginBottom: '3rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <img src="/logo-header.jpg" alt="CS" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
              <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem', lineHeight: 1.7 }}>
              A Calvary Media UK publication. Stories that inspire, inform, and illuminate.
            </p>
          </div>
          {[
            { title: 'Explore', links: [['Flash Fiction', '/flash'], ['Short Stories', '/short'], ['Poetry', '/poetry'], ['News & Updates', '/news'], ['Inspiring Stories', '/inspiring'], ['Serial Stories', '/serial']] },
            { title: 'Connect', links: [['Newsletter', 'https://calvaryscribblings.co.uk/#subscribe'], ['Contact Us', '/contact'], ['About Us', '/about']] },
          ].map(({ title, links }) => (
            <div key={title}>
              <h5 style={{ color: '#a78bfa', marginBottom: '1rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{title}</h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {links.map(([label, href]) => (
                  <a key={href} href={href}
                    style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none', fontSize: '0.875rem', transition: 'color 0.2s' }}
                    onMouseEnter={e => e.target.style.color = '#c4b5fd'}
                    onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.55)'}>
                    {label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem' }}>
          © 2026 Calvary Scribblings. A Calvary Media UK Publication. All rights reserved.
        </div>
      </footer>

      {/* FAB — mobile only */}
      <div className="sq-fab-mobile">
        <SquareFAB squareOpen={squareOpen} countdown={countdown} />
      </div>
    </div>
  );
}