'use client';

import { useState } from 'react';
import { scoreHardball } from '../lib/quizScoring';

export default function QuizHardball({ hardball, onPass, onFail, passed }) {
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'checking' | 'failed'
  const [attempts, setAttempts] = useState(0);

  if (passed) {
    return (
      <div style={{
        background: '#0a0a0a',
        maxWidth: 680,
        margin: '0 auto',
        padding: '0 2rem 0',
      }}>
        <div style={{
          borderTop: '1px solid rgba(29,158,117,0.25)',
          padding: '1.25rem 0',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
        }}>
          <span style={{ color: '#1d9e75', fontSize: '1rem' }}>✓</span>
          <span style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#1d9e75',
          }}>
            Comprehension Check Passed
          </span>
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!answer.trim()) return;
    setStatus('checking');

    const passed = scoreHardball(answer, hardball);

    if (passed) {
      onPass();
    } else {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 2) {
        setStatus('failed');
        setTimeout(() => onFail(), 3000);
      } else {
        setStatus('idle');
      }
    }
  }

  if (status === 'failed') {
    return (
      <div style={{ background: '#0a0a0a', maxWidth: 680, margin: '0 auto', padding: '0 2rem 2rem' }}>
        <div style={{
          border: '1px solid rgba(220,38,38,0.2)',
          borderRadius: 12,
          padding: '1.5rem',
          background: 'rgba(220,38,38,0.04)',
        }}>
          <div style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(220,38,38,0.7)',
            fontFamily: 'Inter, sans-serif',
            marginBottom: '0.75rem',
          }}>
            HARDBALL — Comprehension Check
          </div>
          <p style={{
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontSize: '1.05rem',
            color: 'rgba(240,234,216,0.6)',
            lineHeight: 1.7,
            margin: 0,
          }}>
            Your answer didn't show enough close reading — the quiz is locked, but you can still join the discussion in the comments below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#0a0a0a', maxWidth: 680, margin: '0 auto', padding: '0 2rem 2rem' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@400;500;600&display=swap');
      `}</style>

      <div style={{
        borderTop: '1px solid rgba(107,47,173,0.2)',
        paddingTop: '2rem',
      }}>
        <div style={{
          fontSize: '0.68rem',
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#9b6dff',
          fontFamily: 'Inter, sans-serif',
          marginBottom: '1.5rem',
        }}>
          HARDBALL — Comprehension Check
        </div>

        {hardball.helperText && (
          <p style={{
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontSize: '1rem',
            fontStyle: 'italic',
            color: 'rgba(240,234,216,0.45)',
            marginBottom: '1rem',
            lineHeight: 1.7,
          }}>
            {hardball.helperText}
          </p>
        )}

        <p style={{
          fontFamily: 'Cormorant Garamond, Georgia, serif',
          fontSize: '1.2rem',
          color: '#f5f0e8',
          lineHeight: 1.65,
          marginBottom: '1.25rem',
        }}>
          {hardball.question}
        </p>

        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          disabled={status === 'checking'}
          rows={5}
          placeholder="Write your answer here…"
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(107,47,173,0.25)',
            borderRadius: 10,
            padding: '0.85rem 1rem',
            fontSize: '1rem',
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            color: '#e8e0d4',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            lineHeight: 1.7,
            opacity: status === 'checking' ? 0.5 : 1,
          }}
          onFocus={e => e.currentTarget.style.borderColor = 'rgba(107,47,173,0.5)'}
          onBlur={e => e.currentTarget.style.borderColor = 'rgba(107,47,173,0.25)'}
        />

        {attempts === 1 && (
          <div style={{
            marginTop: '0.75rem',
            padding: '0.7rem 1rem',
            background: 'rgba(201,164,76,0.05)',
            border: '1px solid rgba(201,164,76,0.2)',
            borderRadius: 8,
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontSize: '0.98rem',
            fontStyle: 'italic',
            color: 'rgba(201,164,76,0.8)',
            lineHeight: 1.6,
          }}>
            That's not quite the word the story uses. One more try.
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!answer.trim() || status === 'checking'}
          style={{
            marginTop: '1rem',
            background: '#6b2fad',
            border: 'none',
            borderRadius: 8,
            padding: '0.8rem 2rem',
            color: '#fff',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            opacity: !answer.trim() || status === 'checking' ? 0.45 : 1,
            transition: 'background 0.2s, opacity 0.2s',
          }}
          onMouseEnter={e => { if (answer.trim() && status === 'idle') e.currentTarget.style.background = '#7c3aed'; }}
          onMouseLeave={e => e.currentTarget.style.background = '#6b2fad'}
        >
          {status === 'checking' ? 'Checking…' : 'Check my answer'}
        </button>
      </div>
    </div>
  );
}
