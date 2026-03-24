'use client';

import { useEffect, useState, useRef } from 'react';
import { stories } from '../../lib/stories';
import { use } from 'react';
import { storyContent } from '../../lib/storyContent';
export default function StoryPage({ params }) {
  const { slug } = use(params);
  const story = stories.find(s => s.id === slug);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [readingTime, setReadingTime] = useState(0);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [hitCount, setHitCount] = useState(null);
  const articleRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      setScrollProgress(Math.min(progress, 100));
      setIsHeaderVisible(scrollTop < lastScrollY || scrollTop < 100);
      setLastScrollY(scrollTop);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    if (articleRef.current) {
      const text = articleRef.current.innerText || '';
      const words = text.trim().split(/\s+/).length;
      setReadingTime(Math.ceil(words / 220));
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    async function trackHit() {
      try {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getDatabase, ref, runTransaction, onValue } = await import('firebase/database');
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
        const hitRef = ref(db, `hits/${slug}`);
        await runTransaction(hitRef, count => (count || 0) + 1);
        onValue(hitRef, snap => setHitCount(snap.val()));
      } catch (e) {
        console.error('Firebase error:', e);
      }
    }
    trackHit();
  }, [slug]);

  if (!story) {
    return (
      <div style={{ background: '#0a0a0a', color: '#e8e0d4', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontSize: '1.2rem' }}>
        Story not found.
      </div>
    );
  }

  const categoryColors = {
    news: '#ef4444',
    flash: '#7c3aed',
    short: '#7c3aed',
    poetry: '#7c3aed',
    inspiring: '#d97706',
    serial: '#7c3aed',
  };
  const accentColor = categoryColors[story.category] || '#7c3aed';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0a; color: #e8e0d4; font-family: 'Cormorant Garamond', 'Cochin', Georgia, serif; overflow-x: hidden; }

        .reading-progress { position: fixed; top: 0; left: 0; height: 2px; background: linear-gradient(90deg, ${accentColor}, #c4b5fd); z-index: 1000; transition: width 0.1s linear; }

        .story-nav { position: fixed; top: 2px; left: 0; right: 0; z-index: 999; display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; background: rgba(10,10,10,0.85); backdrop-filter: blur(16px); border-bottom: 1px solid rgba(255,255,255,0.04); transition: transform 0.3s ease; }
        .story-nav.hidden { transform: translateY(-100%); }
        .nav-logo { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.1rem; font-weight: 600; letter-spacing: 0.05em; color: #e8e0d4; text-decoration: none; }
        .nav-logo span { color: ${accentColor}; }
        .nav-meta { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(232,224,212,0.4); }

        .story-hero { position: relative; height: 92vh; min-height: 560px; display: flex; align-items: flex-end; overflow: hidden; }
        .hero-cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; animation: heroZoom 12s ease-out forwards; }
        @keyframes heroZoom { from { transform: scale(1.06); } to { transform: scale(1.0); } }
        .hero-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0.75) 40%, rgba(10,10,10,0.15) 100%); }
        .hero-content { position: relative; z-index: 2; padding: 3rem 2rem 3.5rem; max-width: 820px; animation: heroUp 1s cubic-bezier(0.22,1,0.36,1) 0.3s both; }
        @keyframes heroUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }

        .story-badge { display: inline-block; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.3em 0.85em; border: 1px solid ${accentColor}; color: ${accentColor}; border-radius: 2px; margin-bottom: 1.2rem; }
        .story-title { font-size: clamp(2.4rem, 6vw, 4.2rem); font-weight: 300; line-height: 1.08; color: #f5f0e8; margin-bottom: 1.2rem; }
        .story-byline { display: flex; align-items: center; gap: 1.5rem; font-size: 0.82rem; letter-spacing: 0.08em; color: rgba(232,224,212,0.55); }
        .byline-dot { width: 3px; height: 3px; border-radius: 50%; background: ${accentColor}; opacity: 0.6; }

        .story-body { max-width: 680px; margin: 0 auto; padding: 4rem 2rem 6rem; }
        .reading-meta { display: flex; align-items: center; gap: 1rem; margin-bottom: 3.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(232,224,212,0.35); }
        .reading-meta-pill { display: inline-flex; align-items: center; gap: 0.4em; padding: 0.3em 0.8em; background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.2); border-radius: 20px; color: #a78bfa; }
        .back-link { display: inline-flex; align-items: center; gap: 0.5em; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(232,224,212,0.35); text-decoration: none; transition: color 0.2s; }
        .back-link:hover { color: ${accentColor}; }

        .prose { font-size: 1.22rem; line-height: 1.85; color: #e8e0d4; font-weight: 400; }
        .prose p { margin-bottom: 1.8em; }
        .prose > p:first-of-type::first-letter { font-size: 4.5em; font-weight: 600; float: left; line-height: 0.78; margin: 0.06em 0.12em 0 0; color: ${accentColor}; font-family: 'Cormorant Garamond', Georgia, serif; }
        .prose em { font-style: italic; color: #c4b5a0; }
        .prose strong { font-weight: 600; color: #f0ebe2; }
        .prose hr { border: none; text-align: center; margin: 3em 0; color: rgba(232,224,212,0.2); letter-spacing: 0.4em; }
        .prose hr::after { content: '· · ·'; } .prose .poem-collection-intro { font-style: italic; font-family: 'Times New Roman', serif; }
        .prose .poem-contents { border-left: 3px solid ${accentColor}; padding-left: 1.5em; margin: 1.5em 0; }
        .prose .poem-contents ol, .prose .poem-contents li { font-style: italic; }
        .prose .poem-stanza { font-family: 'Cormorant Garamond', Cochin, Georgia, serif; margin-bottom: 2em; }
        .prose .poem-stanza p { margin-bottom: 0.3em; line-height: 1.7; }
        .prose .poem-stanza p::first-letter { all: unset; }
        .prose h3 { font-size: 1.2rem; font-style: italic; color: #c4b5a0; margin: 2em 0 0.5em; font-weight: 400; }
        .prose > p:first-of-type::first-letter { ${story.category === 'poetry' ? 'all: unset;' : ''} }
        .prose blockquote { margin: 2.5em 0; padding: 1.5em 2em; border-left: 3px solid ${accentColor}; background: rgba(124,58,237,0.06); font-size: 1.3rem; font-style: italic; color: #c4b5a0; line-height: 1.7; border-radius: 0 4px 4px 0; }

        .story-footer { max-width: 680px; margin: 0 auto; padding: 2rem; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(232,224,212,0.6); gap: 1rem; flex-wrap: wrap; }
        .hit-counter { display: flex; align-items: center; gap: 0.5em; }
        .hit-dot { width: 6px; height: 6px; border-radius: 50%; background: ${accentColor}; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }

        .disqus-wrap { max-width: 680px; margin: 0 auto 6rem; padding: 0 2rem; }
        .disqus-divider { display: flex; align-items: center; gap: 1rem; margin-bottom: 2.5rem; font-size: 0.72rem; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(232,224,212,0.25); }
        .disqus-divider::before, .disqus-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.06); }

        @media (max-width: 640px) {
          .story-body { padding: 3rem 1.25rem 4rem; }
          .hero-content { padding: 2rem 1.25rem 2.5rem; }
          .prose { font-size: 1.08rem; }
          .story-nav { padding: 0.85rem 1.25rem; }
        }
      `}</style>

      <div className="reading-progress" style={{ width: `${scrollProgress}%` }} />

      <nav className={`story-nav${isHeaderVisible ? '' : ' hidden'}`}>
        <a href="/" className="nav-logo">Calvary <span>Scribblings</span></a>
        <span className="nav-meta">{story.categoryName}</span>
      </nav>

      <header className="story-hero">
        <img className="hero-cover" src={story.cover} alt={story.title} />
        <div className="hero-overlay" />
        <div className="hero-content">
          <div className="story-badge">{story.categoryName}</div>
          <h1 className="story-title">{story.title}</h1>
          <div className="story-byline">
            <span>{story.author}</span>
            <div className="byline-dot" />
            <span>{story.date}</span>
            {readingTime > 0 && <><div className="byline-dot" /><span>{readingTime} min read</span></>}
          </div>
        </div>
      </header>

      <main>
        <article className="story-body" ref={articleRef}>
          <div className="reading-meta">
            <a href={`/${story.category}`} className="back-link">← {story.categoryName}</a>
            <div style={{ flex: 1 }} />
            {readingTime > 0 && <span className="reading-meta-pill">⏱ {readingTime} min read</span>}
          </div>
<div className="prose" id="story-content" dangerouslySetInnerHTML={{ __html: storyContent[slug] || story.content || '<p>Content coming soon.</p>' }} />        </article>

        <div className="story-footer">
          <span>{story.author} · {story.date}</span>
          <span className="hit-counter">
            <span className="hit-dot" />
            {hitCount !== null ? `${hitCount.toLocaleString()} reads` : '— reads'}
          </span>
          <span className="story-badge" style={{ margin: 0 }}>{story.categoryName}</span>
        </div>

        <div className="disqus-wrap">
          <div className="disqus-divider">Discussion</div>
          <div id="disqus_thread" />
        </div>
      </main>
    </>
  );
}
export async function generateStaticParams() {
  const { stories } = await import('../../lib/stories');
  return stories.map((s) => ({ slug: s.id }));
}
