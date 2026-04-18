'use client';
import { useState, useEffect } from 'react';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cs_cookie_consent');
    if (!consent) setVisible(true);
  }, []);

  function accept() {
    localStorage.setItem('cs_cookie_consent', 'accepted');
    setVisible(false);
  }

  function decline() {
    localStorage.setItem('cs_cookie_consent', 'declined');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: '#111', borderTop: '1px solid #2a2a2a',
      padding: '1rem 2rem', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap',
      fontFamily: 'Cochin, Georgia, serif',
    }}>
      <p style={{
        margin: 0, fontSize: '0.85rem', color: 'rgba(232,224,212,0.75)',
        lineHeight: 1.6, flex: 1, minWidth: 260,
      }}>
        We use cookies to keep you signed in and understand how our platform is used.
        By continuing, you agree to our use of cookies.{' '}
        <a href="/about" style={{ color: '#a78bfa', textDecoration: 'underline' }}>
          Learn more
        </a>
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
        <button onClick={decline} style={{
          background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6, padding: '0.5rem 1.1rem', color: 'rgba(232,224,212,0.5)',
          fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Decline
        </button>
        <button onClick={accept} style={{
          background: '#6b2fad', border: 'none',
          borderRadius: 6, padding: '0.5rem 1.4rem', color: '#fff',
          fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit',
          fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Accept
        </button>
      </div>
    </div>
  );
}