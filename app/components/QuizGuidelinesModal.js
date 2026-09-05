'use client';

import { useEffect } from 'react';

const TIER_TABLE = {
  story: { platinum: 50, gold: 45, silver: 40, bronze: 25 },
  reader: { platinum: 100, gold: 90, silver: 80, bronze: 70 },
};

export default function QuizGuidelinesModal({ onBegin, onCancel, mode = 'story' }) {
  const rewards = TIER_TABLE[mode] || TIER_TABLE.story;
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(10,10,10,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
    }}
    onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@400;500;600&display=swap');
        @keyframes qg-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div style={{
        background: '#12091e',
        border: '1px solid rgba(107,47,173,0.6)',
        borderRadius: 16,
        maxWidth: 540,
        width: '100%',
        maxHeight: 'min(90vh, 720px)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'qg-rise 0.35s ease-out',
        boxShadow: '0 24px 80px rgba(107,47,173,0.3)',
      }}>
        <div style={{
          flexShrink: 0,
          padding: 'clamp(1.5rem, 4vw, 2.5rem) clamp(1.5rem, 5vw, 3rem) 0',
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: 'clamp(1.1rem, 3vw, 1.4rem)',
          color: '#f5f0e8',
          textAlign: 'center',
          letterSpacing: '0.06em',
          marginBottom: '1.5rem',
        }}>
          ✦ Before you begin ✦
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 clamp(1.5rem, 5vw, 3rem) 1.5rem',
          fontFamily: 'Cormorant Garamond, Georgia, serif',
          fontSize: 'clamp(1rem, 2.5vw, 1.15rem)',
          color: 'rgba(240,234,216,0.9)',
          lineHeight: 1.85,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}>
          <p style={{ margin: 0 }}>One attempt. The comprehension check alone allows two.</p>

          {mode === 'reader' && (
            <p style={{ margin: 0, color: 'rgba(240,234,216,0.75)' }}>
              Long-form stories carry larger rewards. Every passing tier earns at least {rewards.bronze} Scribbles.
            </p>
          )}

          <p style={{ margin: 0 }}>
            Your answers are scored:<br />
            <span style={{ color: '#e8f0f8' }}>100%</span> = Platinum ({rewards.platinum} Scribbles) &nbsp;·&nbsp;
            <span style={{ color: '#c9a44c' }}>90%</span> = Gold ({rewards.gold}) &nbsp;·&nbsp;
            <span style={{ color: '#c0c0c8' }}>80%</span> = Silver ({rewards.silver}) &nbsp;·&nbsp;
            <span style={{ color: '#c97c2f' }}>60%</span> = Bronze ({rewards.bronze})<br />
            Below 60% = no tier
          </p>

          <p style={{ margin: 0 }}>
            You earn Scribbles for every quiz you pass. Scribbles never expire. They unlock
            perks: exclusive stories, signed prints, member-only events, and more.
          </p>

          {/* ⚠ R9.1 — THE DATE CAME OUT, BY RULING. This read "opens September 2026" until
              5 Sept 2026, when it was September 2026, the catalogue had not opened, and
              nothing on the board opened it. A date that has ARRIVED WITHOUT THE THING is
              worse than no date: it stops being a promise and becomes a claim about the
              present that the reader can check and find false.
              The promise stays; only the date goes. It comes back when there is a real one.
              ⚠ THIS SENTENCE IS PAIRED with app/rewards/page.js — same wording, same ruling.
              Change one, change the other. This is NOT one of the launch-date sites:
              the Scribbles catalogue has no announced date and does not open on 30 September,
              so it must NOT be wired to app/lib/launch.js. */}
          <p style={{ margin: 0 }}>The Scribbles catalogue — what you can spend them on — is coming soon.</p>

          <p style={{ margin: 0 }}>
            The first question is a close-reading comprehension check — and it is strict.
            Your answer must use specific words from the story. Don't paraphrase: name the
            thing the way the writer named it. One small word out of place can mark you wrong.
            You have two attempts. Fail both and the quiz locks — though the Discussion
            remains open.
          </p>

          <p style={{ margin: 0, fontStyle: 'italic', color: 'rgba(240,234,216,0.6)' }}>
            This isn't a race. Take your time.
          </p>
        </div>

        <div style={{
          flexShrink: 0,
          display: 'flex',
          gap: '0.75rem',
          padding: 'clamp(1rem, 3vw, 1.5rem) clamp(1.5rem, 5vw, 3rem)',
          borderTop: '1px solid rgba(107,47,173,0.2)',
          flexWrap: 'wrap',
        }}>
          <button
            onClick={onBegin}
            style={{
              flex: 1,
              background: '#6b2fad',
              border: 'none',
              borderRadius: 9,
              padding: '0.9rem 1.5rem',
              color: '#fff',
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '0.85rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'background 0.2s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#7c3aed'}
            onMouseLeave={e => e.currentTarget.style.background = '#6b2fad'}
          >
            I understand — begin
          </button>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: '1px solid rgba(107,47,173,0.4)',
              borderRadius: 9,
              padding: '0.9rem 1.5rem',
              color: '#a78bfa',
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '0.85rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(107,47,173,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
