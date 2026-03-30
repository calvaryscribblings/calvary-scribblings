'use client';

import { useEffect, useState, useRef } from 'react';
import { stories } from '../../lib/stories';
import { use } from 'react';
import { storyContent } from '../../lib/storyContent';

export default function StoryPage({ params }) {
  const { slug } = use(params);
  const [story, setStory] = useState(stories.find(s => s.id === slug) || null);
  const [storyReady, setStoryReady] = useState(!!stories.find(s => s.id === slug));
  useEffect(() => { const t = setTimeout(() => setStoryReady(true), 3000); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (story && storyReady) return;
    if (story) { setStoryReady(true); return; }
    async function fetchFromCMS() {
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
        const snap = await get(ref(db, 'cms_stories/' + slug));
        if (snap.exists()) {
          setStory({ id: slug, ...snap.val() });
          setStoryReady(true);
        }
      } catch(e) { console.error('CMS fetch error:', e); }
    }
    fetchFromCMS();
  }, [slug]);

  const [scrollProgress, setScrollProgress] = useState(0);
  const [readingTime, setReadingTime] = useState(0);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [hitCount, setHitCount] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const articleRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      setScrollProgress(Math.min(progress, 100));
      setIsHeaderVisible(scrollTop < lastScrollY || scrollTop < 100);
      setShowBackToTop(scrollTop > 600);
      setLastScrollY(scrollTop);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    if (articleRef.current && story) {
      setTimeout(() => {
        const text = articleRef.current ? articleRef.current.innerText || "" : "";
        const words = text.trim().split(/\s+/).length;
        setReadingTime(Math.ceil(words / 220));
      }, 100);
    }
  }, [story]);

  useEffect(() => {
    if (!slug) return;
    async function trackHit() {
      const base = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
      const auth = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
      const url = `${base}/stories/${slug}/hits.json?auth=${auth}`;
      // Atomic increment via REST using optimistic concurrency (ETag loop)
      // Works on all devices including mobile
      let incremented = false;
      for (let attempt = 0; attempt < 10 && !incremented; attempt++) {
        try {
          const getRes = await fetch(url, { cache: 'no-store' });
          const etag = getRes.headers.get('etag') || getRes.headers.get('ETag');
          const current = await getRes.json();
          const newCount = (typeof current === 'number' ? current : 0) + 1;
          const putHeaders = { 'Content-Type': 'application/json' };
          if (etag) putHeaders['if-match'] = etag;
          const putRes = await fetch(url, {
            method: 'PUT',
            body: JSON.stringify(newCount),
            headers: putHeaders,
          });
          if (putRes.status === 200) {
            setHitCount(newCount);
            incremented = true;
          } else if (putRes.status === 412) {
            // Conflict — retry after short delay
            await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
          } else {
            break;
          }
        } catch(e) { break; }
      }
      // If increment failed, at least show current count
      if (!incremented) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          const val = await res.json();
          if (typeof val === 'number') setHitCount(val);
        } catch(e) {}
      }
    }
    trackHit();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    window.disqus_config = function () {
      this.page.url = `https://calvaryscribblings.co.uk/stories/${slug}`;
      this.page.identifier = slug;
      this.page.colorScheme = 'light';
    };
    const script = document.createElement('script');
    script.src = 'https://calvaryscribblings.disqus.com/embed.js';
    script.setAttribute('data-timestamp', +new Date());
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
      delete window.disqus_config;
      if (window.DISQUS) window.DISQUS.reset({ reload: false });
    };
  }, [slug]);

  const categoryColors = {
    news: '#ef4444',
    flash: '#6b46c1',
    short: '#6b46c1',
    poetry: '#6b46c1',
    inspiring: '#d97706',
    serial: '#6b46c1',
  };

  if (!story) return <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />;

  const accentColor = categoryColors[story.category] || '#6b46c1';
  const isPoetry = story.category === 'poetry';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
        @keyframes storyFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { background: #0a0a0a; }
        body { background: #0a0a0a; color: #e8e0d4; font-family: Cochin, Georgia, serif; overflow-x: hidden; }
        .story-fade-in { animation: storyFadeIn 0.7s ease forwards; }
        .reading-progress { position: fixed; top: 0; left: 0; height: 3px; background: linear-gradient(90deg, ${accentColor}, #a855f7); z-index: 1000; transition: width 0.1s linear; }
        .story-nav { position: fixed; top: 3px; left: 0; right: 0; z-index: 999; display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; background: rgba(10,10,10,0.88); backdrop-filter: blur(16px); border-bottom: 1px solid rgba(255,255,255,0.06); transition: transform 0.3s ease; }
        .story-nav.hidden { transform: translateY(-100%); }
        .nav-logo { font-family: Cochin, Georgia, serif; font-size: 1.05rem; font-weight: 600; color: #f0ead8; text-decoration: none; letter-spacing: 0.02em; }
        .nav-logo span { color: ${accentColor}; }
        .nav-meta { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(232,224,212,0.45); }
        .story-hero { position: relative; height: 88vh; min-height: 520px; display: flex; align-items: flex-end; overflow: hidden; background: #0a0a0a; }
        .hero-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; animation: heroZoom 12s ease-out forwards; filter: brightness(0.55); }
        @keyframes heroZoom { from { transform: scale(1.06); } to { transform: scale(1.0); } }
        .hero-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0.72) 45%, rgba(10,10,10,0.15) 100%); }
        .hero-cover-panel { display: block; position: absolute; bottom: 0; right: 4%; width: 180px; height: 260px; object-fit: cover; border-radius: 4px 8px 0 0; box-shadow: -8px 0 30px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06); z-index: 3; transform: perspective(600px) rotateY(-4deg); transform-origin: bottom right; }
        .hero-mobile-cover { display: none; position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; }
        .hero-mobile-overlay { display: none; position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0.5) 50%, transparent 100%); }
        .hero-content { position: relative; z-index: 2; padding: 3rem 2rem 3.5rem; max-width: 680px; animation: heroUp 1s cubic-bezier(0.22,1,0.36,1) 0.3s both; }
        @keyframes heroUp { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
        .story-badge-hero { display: inline-block; font-size: 0.64rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.3em 0.9em; border: 1px solid ${accentColor}; color: ${accentColor}; border-radius: 2px; margin-bottom: 1.1rem; font-family: Cochin, Georgia, serif; }
        .story-title { font-size: clamp(2.2rem, 5.5vw, 3.8rem); font-weight: 300; line-height: 1.1; color: #f0ead8; margin-bottom: 1.1rem; font-family: 'Cormorant Garamond', Cochin, Georgia, serif; }
        .story-byline { display: flex; align-items: center; gap: 1.4rem; font-size: 0.82rem; letter-spacing: 0.06em; color: rgba(232,224,212,0.55); flex-wrap: wrap; }
        .byline-dot { width: 3px; height: 3px; border-radius: 50%; background: ${accentColor}; opacity: 0.7; }
        .byline-by { font-style: italic; font-family: 'Cormorant Garamond', Georgia, serif; margin-right: -0.8rem; }
        .story-body-wrap { background: #f0ead8; }
        .story-body { max-width: 680px; margin: 0 auto; padding: 3rem 2rem 5rem; }
        .back-link-row { margin-bottom: 2.2rem; padding-bottom: 1.2rem; border-bottom: 1px solid #e0dbd2; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
        .back-link { display: inline-flex; align-items: center; gap: 0.4em; font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: ${accentColor}; text-decoration: none; font-family: Cochin, Georgia, serif; }
        .back-link:hover { text-decoration: underline; }
        .prose { font-size: 1.15rem; line-height: 1.85; color: #1a1a1a; font-family: Cochin, Georgia, serif; font-weight: 400; }
        .prose p { margin-bottom: 0; } .prose p + p { text-indent: 1.5em; }
        .prose.has-dropcap > p:first-of-type::first-letter { font-size: 4.2em; font-weight: 600; float: left; line-height: 0.78; margin: 0.06em 0.12em 0 0; color: ${accentColor}; font-family: 'Cormorant Garamond', Cochin, Georgia, serif; }
        .prose h2 { font-size: 1.45rem; font-weight: 700; color: #1a1a1a; margin: 2.2em 0 0.7em; font-family: Cochin, Georgia, serif; line-height: 1.3; }
        .prose h3 { font-size: 1.15rem; font-style: italic; color: ${accentColor}; margin: 2em 0 0.5em; font-weight: 400; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose h4 { font-size: 1rem; font-weight: 700; color: #1a1a1a; margin: 1.5em 0 0.4em; font-family: Cochin, Georgia, serif; }
        .prose img { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 4px; margin: 2em 0 0.5em; }
        .prose .article-image { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 8px; margin: 2em 0 0.5em; }
        .prose figure { margin: 2em 0; }
        .prose figcaption { font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: 0.5em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose img + em { display: block; font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: -1em; margin-bottom: 2em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose .image-caption { display: block; font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: 0.5em; margin-bottom: 2em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose .inline-image-caption { display: block; font-size: 0.82rem; color: #888; font-style: italic; text-align: right; margin-top: 0.4em; margin-bottom: 2em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose .features-list { background: #e8e0f5; border-left: 4px solid ${accentColor}; border-radius: 0 8px 8px 0; padding: 1.25rem 1.5rem; margin: 1.5em 0 2em; }
        .prose .features-list ul { background: transparent; border: none; padding: 0; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
        .prose .features-list ul li { padding-left: 1.2rem; position: relative; font-size: 1.05rem; line-height: 1.6; color: #1a1a1a; }
        .prose .features-list ul li::before { content: '•'; position: absolute; left: 0; color: ${accentColor}; font-weight: 700; }
        .prose blockquote { margin: 2.2em 0; padding: 1.2em 1.6em; border-left: 4px solid ${accentColor}; background: rgba(107,70,193,0.07); font-size: 1.1rem; font-style: italic; color: ${accentColor}; line-height: 1.7; border-radius: 0 4px 4px 0; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose blockquote p { margin-bottom: 0; color: ${accentColor}; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose ul { margin: 1.8em 0; padding: 1.2em 1.5em 1.2em 2em; background: #ede6f5; border-left: 4px solid ${accentColor}; border-radius: 0 4px 4px 0; list-style: disc; }
        .prose ul li { margin-bottom: 0.55em; color: #1a1a1a; font-size: 1.05rem; line-height: 1.75; }
        .prose ul li::marker { color: ${accentColor}; }
        .prose ol { margin: 1.5em 0; padding-left: 1.8em; }
        .prose ol li { margin-bottom: 0.5em; color: #1a1a1a; }
        .prose hr { border: none; height: 2px; background: linear-gradient(90deg, transparent, ${accentColor}, transparent); width: 100px; margin: 3em auto; display: block; }
        .prose em { font-style: italic; color: inherit; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose i { font-style: italic; color: inherit; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose strong { font-weight: 700; color: #1a1a1a; }
        .prose .poem-collection-intro { font-style: italic; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; color: #555; margin-bottom: 1.5em; display: block; font-size: 1.1rem; }
        .prose .poem-contents { border-left: 4px solid ${accentColor}; padding: 0.8em 1.2em; margin: 1.5em 0; background: #ede6f5; border-radius: 0 4px 4px 0; }
        .prose .poem-contents p { margin-bottom: 0.5em; font-weight: 600; color: #1a1a1a; }
        .prose .poem-contents ol, .prose .poem-contents ul { background: transparent; border: none; padding: 0 0 0 1.2em; margin: 0; }
        .prose .poem-contents li { font-style: italic; color: #444; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; font-size: 1.1rem; }
        .prose .poem-block { margin-bottom: 3.5em; display: block; }
        .prose .poem-title { font-size: 1.5rem; font-style: normal; color: ${accentColor}; margin-bottom: 1.2em; display: block; font-family: Cochin, Georgia, serif; font-weight: 700; }
        .prose .poem-stanza { font-family: Cochin, Georgia, serif; margin-bottom: 1.8em; display: block; white-space: pre-line; line-height: 1.75; color: #1a1a1a; font-size: 1.15rem; }
        .prose .poem-stanza p { margin-bottom: 0.25em; line-height: 1.75; color: #1a1a1a; white-space: pre-line; }
        .prose .poem-stanza p::first-letter { all: unset; }
        .prose .poem-stanza br { display: block; }
        .hit-counter-row { text-align: center; padding: 1.8rem 2rem 1.5rem; color: #888; font-size: 0.9rem; font-family: Cochin, Georgia, serif; border-top: 1px solid #e0dbd2; max-width: 680px; margin: 0 auto; background: #f0ead8; }
        .story-footer { background: #f0ead8; max-width: 680px; margin: 0 auto; padding: 1rem 2rem 2rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: #888; gap: 1rem; flex-wrap: wrap; font-family: Cochin, Georgia, serif; border-top: 1px solid #e0dbd2; }
        .story-badge-footer { display: inline-block; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; padding: 0.25em 0.8em; border: 1px solid ${accentColor}; color: ${accentColor}; border-radius: 2px; }
        .disqus-wrap { background: #f0ead8; max-width: 680px; margin: 0 auto; padding: 2rem 2rem 6rem; }
        .disqus-divider { display: flex; align-items: center; gap: 1rem; margin-bottom: 2.5rem; font-size: 0.72rem; letter-spacing: 0.15em; text-transform: uppercase; color: #bbb; }
        .disqus-divider::before, .disqus-divider::after { content: ''; flex: 1; height: 1px; background: #e0dbd2; }
        .back-to-top { position: fixed; bottom: 2rem; right: 2rem; width: 44px; height: 44px; border-radius: 50%; background: rgba(124,58,237,0.85); border: 1px solid rgba(168,85,247,0.4); color: #fff; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); transition: opacity 0.3s ease, transform 0.3s ease; z-index: 998; box-shadow: 0 4px 20px rgba(124,58,237,0.4); }
        .back-to-top:hover { background: rgba(124,58,237,1); transform: translateY(-2px); }
        .back-to-top.hidden { opacity: 0; pointer-events: none; transform: translateY(8px); }
        @media (max-width: 640px) {
          .hero-cover-panel { width: 100px; height: 145px; bottom: 0; right: 4%; z-index: 0; }
          .story-body { padding: 2.5rem 1.2rem 4rem; }
          .hero-content { padding: 2rem 1.2rem 2.5rem 1.2rem; padding-right: 120px; }
          .prose { font-size: 1.05rem; }
          .story-nav { padding: 0.85rem 1.2rem; }
          .hit-counter-row { padding: 1.5rem 1.2rem; }
          .disqus-wrap { padding: 1.5rem 1.2rem 4rem; }
        }
      `}</style>

      <div className="reading-progress" style={{ width: `${scrollProgress}%` }} />
      <div className={storyReady ? 'story-fade-in' : ''} style={{ opacity: storyReady ? undefined : 0 }}>
        <nav className={`story-nav${isHeaderVisible ? '' : ' hidden'}`}>
          <a href="/" className="nav-logo">Calvary <span>Scribblings</span></a>
          <span className="nav-meta">{story.categoryName}</span>
        </nav>

        <header className="story-hero">
          <img className="hero-bg" src={story.cover} alt="" aria-hidden="true" />
          <div className="hero-overlay" />
          <img className="hero-mobile-cover" src={story.cover} alt={story.title} />
          <div className="hero-mobile-overlay" />
          <img className="hero-cover-panel" src={story.cover} alt={story.title} />
          <div className="hero-content">
            <div className="story-badge-hero">{story.categoryName}</div>
            <h1 className="story-title">{story.title}</h1>
            <div className="story-byline">
              <span className="byline-by">by</span>
              <span>{story.author}</span>
              <div className="byline-dot" />
              <span>{story.date}</span>
              {readingTime > 0 && (
                <>
                  <div className="byline-dot" />
                  <span>⏱ {readingTime} MIN. READ</span>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="story-body-wrap">
          <main>
            <article className="story-body" ref={articleRef}>
              <div className="back-link-row">
                <a href={`/${story.category}`} className="back-link">← {story.categoryName}</a>
              </div>
              <div
                className={`prose${isPoetry ? '' : ' has-dropcap'}`}
                id="story-content"
                dangerouslySetInnerHTML={{ __html: storyContent[slug] || story.content || '<p>Content coming soon.</p>' }}
              />
            </article>

            <div className="hit-counter-row">
              {hitCount !== null ? `${hitCount.toLocaleString()} Reads` : '— Reads'}
            </div>

            <div className="story-footer">
              <span>By {story.author} · {story.date}</span>
              <span className="story-badge-footer">{story.categoryName}</span>
            </div>

            <div className="disqus-wrap">
              <div className="disqus-divider">Discussion</div>
              <div id="disqus_thread" />
            </div>
          </main>
        </div>
      </div>
      <button
        className={showBackToTop ? 'back-to-top' : 'back-to-top hidden'}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top">
        ↑
      </button>
    </>
  );
}