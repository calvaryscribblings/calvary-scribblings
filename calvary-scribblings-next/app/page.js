'use client';
import { useState, useEffect, useCallback } from 'react';

const stories = [
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

const badgeStyle = {
  news: { background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' },
  flash: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  short: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  poetry: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  inspiring: { background: 'rgba(217,119,6,0.2)', color: '#fcd34d', border: '1px solid rgba(217,119,6,0.4)' },
};

function StoryCard({ story, width = 190, height = 270 }) {
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
        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)' }}>{story.author}</div>
      </div>
    </a>
  );
}

function JustAddedCard({ story }) {
  const [hovered, setHovered] = useState(false);
  const badge = badgeStyle[story.category] || badgeStyle.news;
  return (
    <a href={story.url}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.85rem',
        padding: '0.65rem 0.75rem', borderRadius: 8,
        background: hovered ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.03)',
        border: hovered ? '1px solid rgba(139,92,246,0.25)' : '1px solid rgba(255,255,255,0.06)',
        transition: 'all 0.25s ease', cursor: 'pointer',
      }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img src={story.cover} alt={story.title}
          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, display: 'block', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }} />
        {isNew(story) && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
            color: '#fff', fontSize: '0.45rem', fontWeight: 800,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '0.15rem 0.35rem', borderRadius: 2,
          }}>New</span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <span style={{ ...badge, fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.1rem 0.35rem', borderRadius: 2, display: 'inline-block', marginBottom: '0.3rem' }}>
          {story.categoryName}
        </span>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e5e5e5', lineHeight: 1.3, marginBottom: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {story.title}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)' }}>{story.author} · {story.date}</div>
      </div>
    </a>
  );
}

function Row({ title, stories, seeAll }) {
  return (
    <section style={{ padding: '1.5rem 0', marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0 4%' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e5e5e5', margin: 0 }}>{title}</h3>
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

export default function Home() {
  const [scrolled, setScrolled] = useState(false);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroTransition, setHeroTransition] = useState(true);

  const sorted = [...stories].map((s,i) => ({...s,_idx:i})).sort((a,b) => parseDate(b.date)-parseDate(a.date)||a._idx-b._idx);
  const carouselStories = sorted.filter(s => s.category === 'news' || s.category === 'inspiring' || s.category === 'short').slice(0, 5);
  const justAdded = sorted.slice(0, 5);
  const top10 = [...stories].slice(0, 10);

  const goTo = useCallback((idx) => {
    setHeroTransition(false);
    setTimeout(() => {
      setHeroIndex(idx);
      setHeroTransition(true);
    }, 300);
  }, []);

  const next = useCallback(() => {
    goTo((heroIndex + 1) % carouselStories.length);
  }, [heroIndex, carouselStories.length, goTo]);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => {
    const timer = setInterval(next, 6000);
    return () => clearInterval(timer);
  }, [next]);

  const featured = carouselStories[heroIndex];
  const badge = badgeStyle[featured.category] || badgeStyle.news;

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: "'Cochin', Georgia, serif" }}>

      {/* Navbar */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        padding: '0 4%', height: 68,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(10,10,10,0.96)' : 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.05)' : 'none',
        transition: 'all 0.35s ease',
      }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <img src="/logo-header.jpg" alt="CS" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</div>
            <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>A Calvary Media UK Publication</div>
          </div>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          {['Home', 'About', 'Subscribe', 'Contact'].map(link => (
            <a key={link} href={link === 'Home' ? '/' : `/#${link.toLowerCase()}`}
              style={{ color: 'rgba(255,255,255,0.65)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500, transition: 'color 0.2s' }}
              onMouseEnter={e => e.target.style.color = '#fff'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.65)'}>
              {link}
            </a>
          ))}
          <div style={{ position: 'relative' }}
            onMouseEnter={() => setStoriesOpen(true)}
            onMouseLeave={() => setStoriesOpen(false)}>
            <span style={{ color: storiesOpen ? '#c4b5fd' : 'rgba(255,255,255,0.65)', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer', transition: 'color 0.2s' }}>
              Stories ▾
            </span>
            {storiesOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 12px)', left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(15,15,15,0.98)', backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12,
                padding: '0.6rem 0', minWidth: 220,
                boxShadow: '0 24px 64px rgba(0,0,0,0.9)',
              }}>
                {[['News & Updates', '/news'], ['Inspiring Stories', '/inspiring']].map(([label, href]) => (
                  <a key={href} href={href}
                    style={{ display: 'block', padding: '0.6rem 1.25rem', color: 'rgba(255,255,255,0.75)', textDecoration: 'none', fontSize: '0.875rem', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.target.style.background = 'rgba(124,58,237,0.15)'; e.target.style.color = '#c4b5fd'; }}
                    onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'rgba(255,255,255,0.75)'; }}>
                    {label}
                  </a>
                ))}
                <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0.4rem 0' }} />
                <div style={{ padding: '0.3rem 1.25rem 0.2rem', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)' }}>Creative Writing</div>
                {[['Flash Fiction', '/flash'], ['Short Stories', '/short'], ['Serial Stories', '/serial'], ['Poetry', '/poetry']].map(([label, href]) => (
                  <a key={href} href={href}
                    style={{ display: 'block', padding: '0.5rem 1.75rem', color: 'rgba(255,255,255,0.65)', textDecoration: 'none', fontSize: '0.85rem', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.target.style.background = 'rgba(124,58,237,0.15)'; e.target.style.color = '#c4b5fd'; }}
                    onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'rgba(255,255,255,0.65)'; }}>
                    — {label}
                  </a>
                ))}
              </div>
            )}
          </div>
          <a href="/search"
            style={{ color: 'rgba(255,255,255,0.65)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', transition: 'color 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.65)'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Search
          </a>
        </div>
      </nav>

      {/* Hero Carousel */}
      <section style={{ position: 'relative', height: '88vh', minHeight: 600, overflow: 'hidden' }}>

        {/* Background images — all preloaded, only active one is visible */}
        {carouselStories.map((s, i) => (
          <img key={s.id} src={s.cover} alt={s.title}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center top',
              filter: 'brightness(0.35)',
              opacity: i === heroIndex ? (heroTransition ? 1 : 0) : 0,
              transition: 'opacity 0.7s ease',
              zIndex: 0,
            }} />
        ))}

        {/* Gradients */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(105deg, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.5) 60%, transparent 100%)', zIndex: 1 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #0a0a0a 0%, transparent 45%)', zIndex: 1 }} />

        {/* Content */}
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
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 700, lineHeight: 1.1, marginBottom: '0.75rem', color: '#fff', textShadow: '0 2px 30px rgba(0,0,0,0.6)' }}>
            {featured.title}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.95rem', marginBottom: '1.75rem' }}>
            By {featured.author} · {featured.date}
          </p>
          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
        </div>

        {/* Carousel dots + prev/next */}
        <div style={{ position: 'absolute', bottom: '5%', left: '4%', zIndex: 3, display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {carouselStories.map((_, i) => (
              <button key={i} onClick={() => goTo(i)} style={{
                width: i === heroIndex ? 24 : 8,
                height: 4, borderRadius: 2, border: 'none', cursor: 'pointer',
                background: i === heroIndex ? '#a855f7' : 'rgba(255,255,255,0.3)',
                transition: 'all 0.3s ease', padding: 0,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => goTo((heroIndex - 1 + carouselStories.length) % carouselStories.length)}
              style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.4)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.target.style.background = 'rgba(124,58,237,0.4)'; e.target.style.borderColor = 'rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.target.style.background = 'rgba(0,0,0,0.4)'; e.target.style.borderColor = 'rgba(255,255,255,0.2)'; }}>
              ‹
            </button>
            <button onClick={next}
              style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.4)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.target.style.background = 'rgba(124,58,237,0.4)'; e.target.style.borderColor = 'rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.target.style.background = 'rgba(0,0,0,0.4)'; e.target.style.borderColor = 'rgba(255,255,255,0.2)'; }}>
              ›
            </button>
          </div>
        </div>

        {/* Thumbnail strip — right side */}
        <div style={{
          position: 'absolute', right: '3%', top: '50%', transform: 'translateY(-50%)',
          zIndex: 3, display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          {carouselStories.map((s, i) => (
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

      {/* Just Added */}
      <section style={{ padding: '2rem 4%', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#7c3aed', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 6, height: 6, background: '#7c3aed', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 8px rgba(124,58,237,0.8)' }} />
          Just Added
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
          {justAdded.map(s => <JustAddedCard key={s.id} story={s} />)}
        </div>
      </section>

      {/* Top 10 */}
      <section style={{ padding: '2.5rem 0' }}>
        <div style={{ padding: '0 4%', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e5e5e5', margin: 0 }}>🔥 Top 10 Stories</h3>
        </div>
        <div style={{ display: 'flex', gap: '0rem', overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '1rem', scrollbarWidth: 'none' }}>
          {top10.map((s, i) => {
            const [hov, setHov] = useState(false);
            return (
              <a key={s.id} href={s.url}
                onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
                style={{
                  textDecoration: 'none', flexShrink: 0, width: 200,
                  display: 'flex', alignItems: 'flex-end', position: 'relative',
                  transform: hov ? 'scale(1.04)' : 'scale(1)',
                  transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
                  marginRight: '-1.5rem',
                }}>
                <span style={{
                  fontSize: '7rem', fontWeight: 900, color: 'transparent',
                  WebkitTextStroke: hov ? '2px rgba(167,139,250,0.5)' : '2px rgba(255,255,255,0.1)',
                  lineHeight: 1, zIndex: 1, flexShrink: 0, width: 80,
                  transition: 'all 0.3s', fontFamily: 'Georgia, serif',
                  textShadow: hov ? '0 0 30px rgba(124,58,237,0.3)' : 'none',
                }}>{i + 1}</span>
                <div style={{
                  borderRadius: 6, overflow: 'hidden', flex: 1,
                  boxShadow: hov ? '0 20px 50px rgba(0,0,0,0.9), 0 0 0 1px rgba(124,58,237,0.3)' : '0 4px 20px rgba(0,0,0,0.6)',
                  transition: 'box-shadow 0.3s',
                }}>
                  <img src={s.cover} alt={s.title} style={{ width: '100%', height: 260, objectFit: 'cover', display: 'block',
                    filter: hov ? 'brightness(0.8)' : 'brightness(0.95)', transition: 'filter 0.3s' }} />
                </div>
              </a>
            );
          })}
        </div>
      </section>

      {/* Category Rows */}
      <Row title="📰 News & Updates" stories={stories.filter(s => s.category === 'news')} seeAll="/news" />
      <Row title="✨ Inspiring Stories" stories={stories.filter(s => s.category === 'inspiring')} seeAll="/inspiring" />
      <Row title="⚡ Flash Fiction" stories={stories.filter(s => s.category === 'flash')} seeAll="/flash" />
      <Row title="📖 Short Stories" stories={stories.filter(s => s.category === 'short')} seeAll="/short" />
      <Row title="✍️ Poetry" stories={stories.filter(s => s.category === 'poetry')} seeAll="/poetry" />

      {/* Subscribe */}
      <section id="subscribe" style={{
        padding: '6rem 4%', textAlign: 'center',
        background: 'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(168,85,247,0.06) 100%)',
        borderTop: '1px solid rgba(124,58,237,0.15)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '0.85rem', color: '#fff', lineHeight: 1.2 }}>Never Miss a Story</h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '1rem', marginBottom: '2.5rem', lineHeight: 1.7 }}>
            Subscribe to our newsletter and get the latest stories delivered to your inbox.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <input type="email" placeholder="Enter your email address" style={{
              flex: 1, minWidth: 250, padding: '0.85rem 1.25rem', borderRadius: 6,
              border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)',
              color: '#fff', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit',
            }} />
            <button style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              color: '#fff', padding: '0.85rem 1.75rem', borderRadius: 6,
              border: 'none', fontWeight: 700, fontSize: '0.9rem',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.target.style.transform = 'scale(1.04)'; e.target.style.boxShadow = '0 6px 28px rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.target.style.transform = 'scale(1)'; e.target.style.boxShadow = '0 4px 20px rgba(124,58,237,0.4)'; }}>
              Subscribe
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: '#060606', padding: '4rem 4% 2rem', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '3rem', marginBottom: '3rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <img src="/logo-header.jpg" alt="CS" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
              <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem', lineHeight: 1.7 }}>
              A Calvary Media UK publication. Stories that inspire, inform, and illuminate.
            </p>
          </div>
          {[
            { title: 'Explore', links: [['News & Updates', '/news'], ['Inspiring Stories', '/inspiring'], ['Creative Writing', '/creative']] },
            { title: 'Creative Writing', links: [['Flash Fiction', '/flash'], ['Short Stories', '/short'], ['Serial Stories', '/serial'], ['Poetry', '/poetry']] },
            { title: 'Connect', links: [['Newsletter', '/#subscribe'], ['Contact Us', '/#contact'], ['About Us', '/#about']] },
          ].map(({ title, links }) => (
            <div key={title}>
              <h5 style={{ color: '#a78bfa', marginBottom: '1rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{title}</h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {links.map(([label, href]) => (
                  <a key={href} href={href}
                    style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'none', fontSize: '0.875rem', transition: 'color 0.2s' }}
                    onMouseEnter={e => e.target.style.color = '#c4b5fd'}
                    onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}>
                    {label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem' }}>
          © 2026 Calvary Scribblings. A Calvary Media UK Publication. All rights reserved.
        </div>
      </footer>

    </div>
  );
}