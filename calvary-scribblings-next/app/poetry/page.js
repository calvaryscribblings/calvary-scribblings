'use client';
import { useState } from 'react';
import { stories, isNew, badgeStyle, categoryMeta } from '../lib/stories';

const cat = 'poetry';
const meta = categoryMeta[cat];
const filtered = stories.filter(s => s.category === cat).sort((a,b) => new Date(b.date) - new Date(a.date));

function StoryCard({ story }) {
  const [hovered, setHovered] = useState(false);
  const badge = badgeStyle[story.category] || badgeStyle.news;
  return (
    <a href={story.url} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ textDecoration: 'none', borderRadius: 10, overflow: 'hidden', display: 'block', position: 'relative', cursor: 'pointer', transform: hovered ? 'scale(1.03)' : 'scale(1)', transition: 'transform 0.3s ease, box-shadow 0.3s ease', boxShadow: hovered ? '0 20px 50px rgba(0,0,0,0.8)' : '0 4px 20px rgba(0,0,0,0.4)', background: '#111' }}>
      <img src={story.cover} alt={story.title} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', filter: hovered ? 'brightness(0.7)' : 'brightness(0.85)', transition: 'filter 0.3s ease' }} />
      {isNew(story) && <span style={{ position: 'absolute', top: 10, left: 10, background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0.2rem 0.5rem', borderRadius: 3 }}>New</span>}
      <div style={{ padding: '1.25rem' }}>
        <span style={{ ...badge, fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.2rem 0.5rem', borderRadius: 3, display: 'inline-block', marginBottom: '0.6rem' }}>{story.categoryName}</span>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e5e5', lineHeight: 1.4, marginBottom: '0.5rem' }}>{story.title}</h3>
        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>By {story.author} · {story.date}</p>
      </div>
    </a>
  );
}

export default function PoetryPage() {
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
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>{meta.emoji}</div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 700, color: '#fff', marginBottom: '0.75rem' }}>{meta.label}</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '1rem' }}>{filtered.length} collections</p>
      </section>
      <section style={{ padding: '3rem 4%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
          {filtered.map(s => <StoryCard key={s.id} story={s} />)}
        </div>
      </section>
    </div>
  );
}
