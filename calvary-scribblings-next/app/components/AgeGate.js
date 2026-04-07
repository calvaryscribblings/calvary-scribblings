'use client';

import { useState, useEffect } from 'react';

const WORKER_URL = 'https://calvary-age-verify.calvarymediauk.workers.dev';
const VERIFIED_KEY = 'cs_age_verified';

export default function AgeGate({ children, story }) {
  const [verified, setVerified] = useState(null); // null = checking, true = verified, false = not verified
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check if already verified
  useEffect(() => {
    if (!story?.ageRestricted) { setVerified(true); return; }
    const v = localStorage.getItem(VERIFIED_KEY);
    if (v === 'true') { setVerified(true); return; }
    // Check for returning sessionId from Yoti callback
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');
    if (sessionId) {
      checkSession(sessionId);
    } else {
      setVerified(false);
    }
  }, [story]);

  async function checkSession(sessionId) {
    setLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/check-session?sessionId=${sessionId}`);
      const data = await res.json();
      if (data.passed) {
        localStorage.setItem(VERIFIED_KEY, 'true');
        setVerified(true);
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        setVerified(false);
        setError('Age verification was not completed. Please try again.');
      }
    } catch (e) {
      setVerified(false);
      setError('Could not verify your age. Please try again.');
    }
    setLoading(false);
  }

  async function startVerification() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${WORKER_URL}/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference_id: story?.id || 'unknown' }),
      });
      const data = await res.json();
      if (data.launchUrl) {
        // Save return URL so we can come back after verification
        localStorage.setItem('cs_age_return', window.location.href);
        // Redirect in same tab — avoids Safari popup blocker
        window.location.href = data.launchUrl;
      } else {
        setError('Could not start verification. Please try again.');
        setLoading(false);
      }
    } catch (e) {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  // Still checking
  if (verified === null) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />
    );
  }

  // Verified — show content
  if (verified === true) {
    return <>{children}</>;
  }

  // Not verified — show age gate
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Cinzel:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0a; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(107,47,173,0.18) 0%, transparent 70%)',
        }} />

        <div style={{
          position: 'relative', zIndex: 1,
          maxWidth: 480, width: '100%',
          textAlign: 'center',
          animation: 'fadeUp 0.7s ease forwards',
        }}>
          {/* Logo */}
          <div style={{
            fontFamily: "'Cinzel', serif",
            fontSize: '0.6rem', letterSpacing: '0.24em',
            color: 'rgba(107,47,173,0.6)',
            textTransform: 'uppercase',
            marginBottom: '2.5rem',
          }}>
            Calvary Scribblings
          </div>

          {/* Lock icon */}
          <div style={{
            width: 72, height: 72,
            borderRadius: '50%',
            background: 'rgba(107,47,173,0.12)',
            border: '1px solid rgba(107,47,173,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 2rem',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(107,47,173,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>

          {/* Title */}
          <h1 style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
            fontWeight: 300, color: '#f0ead8',
            lineHeight: 1.2, marginBottom: '1rem',
          }}>
            Age Verification Required
          </h1>

          {/* Story info */}
          {story?.title && (
            <p style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: '1rem', fontStyle: 'italic',
              color: 'rgba(240,234,216,0.45)',
              marginBottom: '1.5rem',
            }}>
              "{story.title}" contains content intended for adults only.
            </p>
          )}

          {/* Description */}
          <p style={{
            fontSize: '0.88rem',
            color: 'rgba(255,255,255,0.4)',
            lineHeight: 1.75,
            marginBottom: '2.5rem',
            fontFamily: "'Cormorant Garamond', serif",
          }}>
            You must be 18 or over to access this content. We use Yoti's secure, privacy-preserving age verification — your identity is never stored by Calvary Scribblings.
          </p>

          {/* Error message */}
          {error && (
            <div style={{
              background: 'rgba(220,38,38,0.1)',
              border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 8, padding: '0.75rem 1rem',
              fontSize: '0.82rem', color: '#f87171',
              fontFamily: "'Cormorant Garamond', serif",
              marginBottom: '1.5rem',
            }}>
              {error}
            </div>
          )}

          {/* Verify button */}
          <button
            onClick={startVerification}
            disabled={loading}
            style={{
              background: loading ? 'rgba(107,47,173,0.3)' : '#6b2fad',
              border: 'none', borderRadius: 6,
              padding: '0.9rem 2.5rem',
              color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: "'Cinzel', serif",
              fontSize: '0.65rem', letterSpacing: '0.2em',
              textTransform: 'uppercase',
              display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
              transition: 'all 0.2s',
              marginBottom: '1.5rem',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#7c3aed'; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#6b2fad'; }}
          >
            {loading ? (
              <>
                <div style={{
                  width: 14, height: 14,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                {loading && !error ? 'Waiting for verification…' : 'Verifying…'}
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                Verify My Age with Yoti
              </>
            )}
          </button>

          {loading && (
            <p style={{
              fontSize: '0.78rem',
              color: 'rgba(255,255,255,0.25)',
              fontFamily: "'Cormorant Garamond', serif",
              fontStyle: 'italic',
              marginBottom: '1.5rem',
            }}>
              Complete verification in the window that opened, then return here.
            </p>
          )}

          {/* Back link */}
          <div>
            <a href="/" style={{
              fontSize: '0.72rem',
              color: 'rgba(255,255,255,0.2)',
              textDecoration: 'none',
              fontFamily: "'Cinzel', serif",
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}>
              ← Back to Calvary Scribblings
            </a>
          </div>

          {/* Yoti branding */}
          <div style={{
            marginTop: '3rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            fontSize: '0.68rem',
            color: 'rgba(255,255,255,0.15)',
            fontFamily: "'Cinzel', serif",
            letterSpacing: '0.1em',
          }}>
            Age verification powered by Yoti · Privacy-preserving · GDPR compliant
          </div>
        </div>
      </div>
    </>
  );
}