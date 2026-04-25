'use client';

import { useState, useEffect } from 'react';
import { stories } from '../lib/stories';
import Navbar from '../components/Navbar';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

async function getApp() {
  const { initializeApp, getApps } = await import('firebase/app');
  return getApps().length ? getApps()[0] : initializeApp(FB);
}
async function getDB() { const { getDatabase } = await import('firebase/database'); return getDatabase(await getApp()); }

const FOUNDER_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const BADGE_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";

function getBadge(readCount, uid) {
  if (uid === FOUNDER_UID) return { color: '#c8daea', isFounder: true };
  if (readCount >= 1000) return { color: '#9b6dff' };
  if (readCount >= 150) return { color: '#d4537e' };
  if (readCount >= 90) return { color: '#d4941a' };
  if (readCount >= 60) return { color: '#1d9e75' };
  if (readCount >= 25) return { color: '#b4b2a9' };
  return null;
}

function BadgeIcon({ color, isFounder = false }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="srPlat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8"/><stop offset="50%" stopColor="#c8daea"/><stop offset="100%" stopColor="#a8c0d6"/>
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#srPlat)' : color} d={BADGE_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

const suggestions = ['Nigeria', 'London', '1967', 'Calvary', 'Tricia Ajax', 'Ikenna Okpara', 'Poetry', 'Flash Fiction', 'BAFTA', 'Oscars'];

function highlight(text, term) {
  if (!term) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp('(' + escaped + ')', 'gi'), '<mark>$1</mark>');
}

function getBadgeClass(cat) {
  const map = { news: 'badge-news', short: 'badge-short', flash: 'badge-flash', poetry: 'badge-poetry', inspiring: 'badge-inspiring', serial: 'badge-short' };
  return map[cat] || 'badge-news';
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [storyResults, setStoryResults] = useState([]);
  const [userResults, setUserResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searchingUsers, setSearchingUsers] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const preQuery = params.get('q');
      if (preQuery) setQuery(preQuery);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setSearched(false);
      setStoryResults([]);
      setUserResults([]);
      return;
    }
    setSearched(true);

    // Strip @ for username matching
    const raw = query.trim();
    const q = raw.startsWith('@') ? raw.slice(1).toLowerCase() : raw.toLowerCase();

    // Story search — instant from local data
    const matchedStories = stories.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.author.toLowerCase().includes(q) ||
      (s.categoryName || '').toLowerCase().includes(q) ||
      (s.date || '').toLowerCase().includes(q)
    );
    setStoryResults(matchedStories);

    // User search — from Firebase
    setSearchingUsers(true);
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'users'));
        if (snap.exists()) {
          const allUsers = snap.val();
          const matched = Object.entries(allUsers)
            .filter(([uid, data]) => {
              const name = (data.displayName || '').toLowerCase();
              const username = (data.username || '').toLowerCase();
              const bio = (data.bio || '').toLowerCase();
              return name.includes(q) || username.includes(q) || bio.includes(q);
            })
            .map(([uid, data]) => ({ uid, ...data }));
          setUserResults(matched);
        } else { setUserResults([]); }
      } catch (e) { setUserResults([]); }
      setSearchingUsers(false);
    })();
  }, [query]);

  const totalResults = storyResults.length + userResults.length;

  const SearchIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&family=Inter:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #faf9f7; font-family: 'DM Sans', sans-serif; }
        .search-page { min-height: 100vh; background: #faf9f7; }
        .search-hero { background: #1a1a2e; padding: 7rem 2rem 4rem; text-align: center; position: relative; overflow: hidden; }
        .search-hero::before { content: ''; position: absolute; top: -60px; left: 50%; transform: translateX(-50%); width: 600px; height: 600px; background: radial-gradient(circle, rgba(107,70,193,0.25) 0%, transparent 70%); pointer-events: none; }
        .search-hero-eyebrow { font-size: 0.75rem; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: #8b5cf6; margin-bottom: 1rem; }
        .search-hero h1 { font-family: 'Cormorant Garamond', Georgia, serif; font-size: clamp(2.5rem, 6vw, 4.5rem); font-weight: 700; color: #fff; margin-bottom: 0.5rem; line-height: 1.1; }
        .search-hero h1 em { font-style: italic; color: #c4b5fd; }
        .search-hero p { font-size: 1rem; color: rgba(255,255,255,0.5); margin-bottom: 2.5rem; }
        .search-input-wrap { position: relative; max-width: 640px; margin: 0 auto; }
        .search-input { width: 100%; padding: 1.1rem 3.5rem 1.1rem 1.5rem; font-family: 'DM Sans', sans-serif; font-size: 1.05rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: #fff; outline: none; transition: border-color 0.2s, background 0.2s, box-shadow 0.2s; caret-color: #8b5cf6; }
        .search-input::placeholder { color: rgba(255,255,255,0.3); }
        .search-input:focus { border-color: #8b5cf6; background: rgba(255,255,255,0.09); box-shadow: 0 0 0 4px rgba(139,92,246,0.15); }
        .search-icon-wrap { position: absolute; right: 1.1rem; top: 50%; transform: translateY(-50%); color: rgba(255,255,255,0.3); pointer-events: none; }
        .search-body { max-width: 860px; margin: 0 auto; padding: 3rem 2rem 5rem; }
        .results-meta { font-size: 0.85rem; color: #999; margin-bottom: 2rem; }
        .results-meta strong { color: #6b46c1; }
        .section-label { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #bbb; margin: 2rem 0 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid #ede9f7; font-family: 'Inter', sans-serif; }
        .result-card { display: flex; gap: 1.25rem; align-items: center; padding: 1.25rem 1rem; border-bottom: 1px solid #ede9f7; text-decoration: none; transition: background 0.15s; border-radius: 8px; margin: 0 -1rem; animation: fadeSlideIn 0.2s ease both; }
        .result-card:hover { background: #f3f0ff; }
        .result-card:hover .result-title { color: #6b46c1; }
        .result-thumb-wrap { width: 80px; min-width: 80px; height: 60px; border-radius: 6px; overflow: hidden; flex-shrink: 0; }
        .result-thumb { width: 100%; height: 100%; object-fit: cover; object-position: center top; display: block; transition: transform 0.3s ease; }
        .result-card:hover .result-thumb { transform: scale(1.05); }
        .result-body { flex: 1; min-width: 0; }
        .result-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.05rem; font-weight: 700; color: #1a1a2e; line-height: 1.35; margin-bottom: 0.3rem; transition: color 0.15s; }
        .result-title mark { background: #ede9ff; color: #6b46c1; border-radius: 2px; padding: 0 2px; }
        .result-meta { font-size: 0.8rem; color: #999; display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
        .result-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        .badge-news { background: #fee2e2; color: #991b1b; }
        .badge-short { background: #fef3c7; color: #92400e; }
        .badge-flash { background: #fee2e2; color: #991b1b; }
        .badge-poetry { background: #ede9fe; color: #5b21b6; }
        .badge-inspiring { background: #fef3c7; color: #92400e; }
        .user-card { display: flex; align-items: center; gap: 1rem; padding: 0.85rem 1rem; border-bottom: 1px solid #ede9f7; text-decoration: none; transition: background 0.15s; border-radius: 8px; margin: 0 -1rem; animation: fadeSlideIn 0.2s ease both; }
        .user-card:hover { background: #f3f0ff; }
        .user-avatar { width: 44px; height: 44px; border-radius: 50%; background: rgba(107,47,173,0.12); border: 1.5px solid rgba(107,47,173,0.2); display: flex; align-items: center; justify-content: center; font-size: 15px; color: #7c3aed; overflow: hidden; flex-shrink: 0; font-family: 'Cormorant Garamond', Georgia, serif; }
        .user-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .user-info { flex: 1; min-width: 0; }
        .user-name { font-size: 0.95rem; font-weight: 500; color: #1a1a2e; font-family: 'Inter', sans-serif; }
        .user-handle { font-size: 0.78rem; color: #8b5cf6; font-family: 'Inter', sans-serif; }
        .state-message { text-align: center; padding: 4rem 1rem; }
        .state-icon { font-size: 3rem; margin-bottom: 1rem; display: block; opacity: 0.4; }
        .state-message p { font-size: 1rem; color: #aaa; }
        .state-message strong { color: #6b46c1; }
        .suggestions { margin-top: 2rem; }
        .suggestions-label { font-size: 0.75rem; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: #bbb; margin-bottom: 0.75rem; }
        .suggestion-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .suggestion-pill { font-size: 0.85rem; padding: 0.4rem 0.9rem; background: #f3f0ff; color: #6b46c1; border-radius: 50px; cursor: pointer; border: 1px solid #ddd6fe; transition: all 0.15s; }
        .suggestion-pill:hover { background: #6b46c1; color: #fff; border-color: #6b46c1; }
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 600px) {
          .search-hero { padding: 6rem 1.5rem 3rem; }
          .result-thumb-wrap { width: 60px; min-width: 60px; height: 48px; }
          .result-title { font-size: 0.95rem; }
        }
      `}</style>
      <Navbar />

      <div className="search-page">
        <div className="search-hero">
          <div className="search-hero-eyebrow">Calvary Scribblings</div>
          <h1>Search <em>everything</em></h1>
          <p>Stories, readers, authors — all in one place</p>
          <div className="search-input-wrap">
            <input
              type="text"
              className="search-input"
              placeholder="Try @byokpara, Nigeria, Tricia Ajax..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck="false"
              autoFocus
            />
            <div className="search-icon-wrap"><SearchIcon /></div>
          </div>
        </div>

        <div className="search-body">
          {!searched ? (
            <>
              <div className="state-message">
                <span className="state-icon">🔍</span>
                <p>Search stories, authors, and readers — type to begin</p>
              </div>
              <div className="suggestions">
                <div className="suggestions-label">Try searching for</div>
                <div className="suggestion-pills">
                  {suggestions.map(s => (
                    <span key={s} className="suggestion-pill" onClick={() => setQuery(s)}>{s}</span>
                  ))}
                </div>
              </div>
            </>
          ) : (searchingUsers && storyResults.length === 0) ? (
            <div className="state-message">
              <span className="state-icon">🔍</span>
              <p>Searching…</p>
            </div>
          ) : (totalResults === 0 && !searchingUsers) ? (
            <div className="state-message">
              <span className="state-icon">📭</span>
              <p>Nothing found for <strong>{query}</strong>. Try a different keyword.</p>
            </div>
          ) : (
            <>
              <div className="results-meta">
                {!searchingUsers
                  ? <><strong>{totalResults}</strong> result{totalResults !== 1 ? 's' : ''} for <strong>{query}</strong></>
                  : <><strong>{storyResults.length}</strong> stor{storyResults.length !== 1 ? 'ies' : 'y'} · searching readers…</>
                }
              </div>

              {userResults.length > 0 && (
                <>
                  <div className="section-label">Readers</div>
                  {userResults.map((u, i) => {
                    const initials = (u.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                    const badge = getBadge(u.readCount || 0, u.uid);
                    return (
                      <a key={u.uid} href={`/user?id=${u.uid}`} className="user-card" style={{ animationDelay: (i * 0.02) + 's' }}>
                        <div className="user-avatar">
                          {u.avatarUrl ? <img src={u.avatarUrl} alt={initials} /> : initials}
                        </div>
                        <div className="user-info">
                          <div className="user-name">{u.displayName || 'Reader'}</div>
                          {u.username && <div className="user-handle">@{u.username}</div>}
                        </div>
                        {badge && <BadgeIcon color={badge.color} isFounder={badge.isFounder} />}
                      </a>
                    );
                  })}
                </>
              )}

              {storyResults.length > 0 && (
                <>
                  <div className="section-label">Stories</div>
                  {storyResults.map((s, i) => (
                    <a key={s.id} href={'/stories/' + s.id} className="result-card" style={{ animationDelay: (i * 0.02) + 's' }}>
                      <div className="result-thumb-wrap">
                        <img src={s.cover} alt={s.title} className="result-thumb" />
                      </div>
                      <div className="result-body">
                        <div className="result-title" dangerouslySetInnerHTML={{ __html: highlight(s.title, query) }} />
                        <div className="result-meta">
                          <span className={'result-badge ' + getBadgeClass(s.category)}>{s.categoryName}</span>
                          <span dangerouslySetInnerHTML={{ __html: highlight(s.author, query) }} />
                          <span>{s.date}</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}