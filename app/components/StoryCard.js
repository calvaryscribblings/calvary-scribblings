'use client';
import { useState } from 'react';
import { isNew } from '../lib/stories';
import QuizPill from './QuizPill';

export default function StoryCard({ story, userTier = null, scorePct, rank = null }) {
  const [hovered, setHovered] = useState(false);

  return (
    <a href={story.url || '/stories/' + story.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none',
        display: 'block',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(107,47,173,0.25)',
        borderRadius: 16,
        overflow: 'hidden',
        transition: 'border-color 0.2s',
        borderColor: hovered ? 'rgba(107,47,173,0.6)' : 'rgba(107,47,173,0.25)',
      }}>
      {/* Cover */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '3/4', overflow: 'hidden', background: '#1a1030' }}>
        <img
          src={story.cover}
          alt={story.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {isNew(story) && (
          <span style={{
            position: 'absolute', top: 10, left: 10,
            background: '#c9a84c', color: '#080610',
            fontSize: '0.5rem', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: 4,
          }}>New</span>
        )}
        <QuizPill
          hasQuiz={story.quizMeta?.hasQuiz || false}
          userTier={userTier}
          scribblesReward={story.quizMeta?.scribblesReward || 50}
          scorePct={scorePct}
        />
      </div>

      {/* Text block */}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 116 }}>
        {/* Title */}
        <h3 style={{
          fontFamily: 'Cochin, "Cormorant Garamond", Georgia, serif',
          fontSize: 15,
          fontWeight: 600,
          color: '#f5f0e8',
          lineHeight: '20px',
          minHeight: 40,
          margin: 0,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>{story.title}</h3>

        {/* Author */}
        <p style={{
          fontFamily: 'Cochin, Georgia, serif',
          fontStyle: 'italic',
          fontSize: 12,
          color: 'rgba(245,240,232,0.45)',
          margin: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>by {story.author}</p>

        {/* Read count + rank badge row */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        }}>
          <span style={{ fontSize: 11, color: 'rgba(245,240,232,0.28)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', letterSpacing: '0.03em' }}>
              {(story.hits || 0).toLocaleString()}
            </span>
            {' '}reads
          </span>
          {rank !== null && (
            <span style={{
              width: 28, height: 28, borderRadius: 14,
              background: '#c9a84c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#080610',
              flexShrink: 0,
            }}>{rank}</span>
          )}
        </div>
      </div>
    </a>
  );
}
