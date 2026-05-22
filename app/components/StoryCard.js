'use client';
import { useState } from 'react';
import { isNew, badgeStyle } from '../lib/stories';
import QuizPill from './QuizPill';

export default function StoryCard({ story, userTier = null, scorePct }) {
  const [hovered, setHovered] = useState(false);
  const badge = badgeStyle[story.category] || badgeStyle.news;
  return (
    <a href={story.url} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ textDecoration: 'none', borderRadius: 10, overflow: 'hidden', display: 'block', position: 'relative', cursor: 'pointer', transform: hovered ? 'scale(1.03)' : 'scale(1)', transition: 'transform 0.3s ease, box-shadow 0.3s ease', boxShadow: hovered ? '0 20px 50px rgba(0,0,0,0.8)' : '0 4px 20px rgba(0,0,0,0.4)', background: '#111' }}>
      <img src={story.cover} alt={story.title} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', filter: hovered ? 'brightness(0.7)' : 'brightness(0.85)', transition: 'filter 0.3s ease' }} />
      {isNew(story) && <span style={{ position: 'absolute', top: 10, left: 10, background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0.2rem 0.5rem', borderRadius: 3 }}>New</span>}
      <QuizPill hasQuiz={story.quizMeta?.hasQuiz || false} userTier={userTier} scribblesReward={story.quizMeta?.scribblesReward || 50} scorePct={scorePct} />
      <div style={{ padding: '1.25rem' }}>
        <span style={{ ...badge, fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.2rem 0.5rem', borderRadius: 3, display: 'inline-block', marginBottom: '0.6rem' }}>{story.categoryName}</span>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e5e5', lineHeight: 1.4, marginBottom: '0.5rem' }}>{story.title}</h3>
        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>By {story.author} · {story.date}</p>
      </div>
    </a>
  );
}
