'use client';

import { useEffect, useState } from 'react';

const WORKER_URL = 'https://calvary-age-verify.calvarymediauk.workers.dev';
const VERIFIED_KEY = 'cs_age_verified';

export default function AgeVerifiedPage() {
  const [status, setStatus] = useState('checking'); // checking, success, fail, error

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');

    if (!sessionId) {
      setStatus('error');
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/check-session?sessionId=${sessionId}`);
        const data = await res.json();

        if (data.passed) {
          localStorage.setItem(VERIFIED_KEY, 'true');
          setStatus('success');
          // Redirect back after a moment
          setTimeout(() => {
            const returnTo = localStorage.getItem('cs_age_return') || '/';
            localStorage.removeItem('cs_age_return');
            window.location.href = returnTo;
          }, 2000);
        } else {
          setStatus('fail');
        }
      } catch (e) {
        setStatus('error');
      }
    })();
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Cinzel:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0a; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={{
        minHeight: '100vh', background: '#0a0a0a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ maxWidth: 420, animation: 'fadeUp 0.6s ease forwards' }}>

          <div style={{
            fontFamily: "'Cinzel', serif", fontSize: '0.6rem',
            letterSpacing: '0.24em', color: 'rgba(107,47,173,0.6)',
            textTransform: 'uppercase', marginBottom: '2.5rem',
          }}>
            Calvary Scribblings
          </div>

          {status === 'checking' && (
            <>
              <div style={{
                width: 48, height: 48,
                border: '2px solid rgba(107,47,173,0.2)',
                borderTopColor: '#6b2fad',
                borderRadius: '50%',
                animation: 'spin 0.9s linear infinite',
                margin: '0 auto 2rem',
              }} />
              <h1 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '1.8rem', fontWeight: 300, color: '#f0ead8',
                marginBottom: '1rem',
              }}>
                Verifying your age…
              </h1>
              <p style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '0.92rem', fontStyle: 'italic',
                color: 'rgba(240,234,216,0.4)',
              }}>
                Just a moment.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'rgba(29,158,117,0.12)',
                border: '1px solid rgba(29,158,117,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 2rem',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h1 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '2rem', fontWeight: 300, color: '#f0ead8',
                marginBottom: '1rem',
              }}>
                Age Verified
              </h1>
              <p style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '0.92rem', fontStyle: 'italic',
                color: 'rgba(240,234,216,0.4)',
              }}>
                Returning you to the story…
              </p>
            </>
          )}

          {(status === 'fail' || status === 'error') && (
            <>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'rgba(220,38,38,0.1)',
                border: '1px solid rgba(220,38,38,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 2rem',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </div>
              <h1 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '1.8rem', fontWeight: 300, color: '#f0ead8',
                marginBottom: '1rem',
              }}>
                {status === 'fail' ? 'Verification Failed' : 'Something Went Wrong'}
              </h1>
              <p style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '0.92rem', fontStyle: 'italic',
                color: 'rgba(240,234,216,0.4)',
                marginBottom: '2rem',
              }}>
                {status === 'fail'
                  ? 'You must be 18 or over to access this content.'
                  : 'We could not complete your verification. Please try again.'}
              </p>
              <a href="/" style={{
                fontFamily: "'Cinzel', serif",
                fontSize: '0.62rem', letterSpacing: '0.18em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)',
                textDecoration: 'none',
              }}>
                ← Back to Calvary Scribblings
              </a>
            </>
          )}

        </div>
      </div>
    </>
  );
}