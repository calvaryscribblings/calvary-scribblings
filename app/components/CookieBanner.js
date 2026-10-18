'use client';
import { useState, useEffect, useRef } from 'react';

// The banner sits ABOVE the mobile tab bar rather than on top of it.
//
// It is fixed to the bottom at z-index 9999, and the bar (components/TabBar.js)
// is fixed to the same edge at 900 — 9100 on /bookstore, where LaunchGate raises
// it over the curtain. The banner therefore won every stacking contest and
// covered all five tabs for every first-time visitor, on every page, until they
// consented. THE FIX IS GEOMETRY, NOT STACKING: the z-index is untouched and the
// banner still wins; it simply no longer occupies the same strip.
//
// 65px, not 64. The bar's `height` is calc(64px + env(safe-area-inset-bottom)),
// but its 1px border-top sits OUTSIDE that box, so the strip it actually
// occupies is 65px + inset — which is exactly what the bar's own in-flow spacer
// reserves (.cs-tabbar-spacer). Offsetting by 64 would tuck the banner's bottom
// edge under the bar's hairline border; it costs no taps, but the two borders
// would sit on the same row and read as one thick rule.
//
// TWO CONDITIONS, because the bar is not always there:
//   · The media query. The bar is display:none from 768px up, so on desktop the
//     banner keeps its original bottom:0 and nothing about it changes.
//   · body:has(.cs-tabbar). Attachment is opt-in per page — the gateway and the
//     reader mount no bar — and this component renders on every page via
//     Providers. Without the :has() test those pages would show the banner
//     floating over a 65px strip of nothing. Where :has() is unsupported the
//     rule simply never matches and the banner sits at bottom:0, i.e. today's
//     behaviour: the safe direction to degrade in, since a covered bar is a
//     known state and a dead gap is not.
//
// Consent logic below is untouched. This round moved a rectangle.
//
// W53 — AND IT SAYS HOW MUCH OF THE BOTTOM IT TAKES. On a first visit the banner covered the
// Square's reply bar and the messages sheet's "+ New". While it is up it publishes
// --cs-cookie-space on <html>: the distance from the bottom of the window to its top edge, tab bar
// offset included. The Square's bottom bar sits on top of that, and its sheets pad by it, so
// nothing a reader needs is under the banner. Gone with the banner; 0 when it never shows.
const CSS = `
  .cs-cookie {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
  }
  @media (max-width: 767.98px) {
    body:has(.cs-tabbar) .cs-cookie { bottom: calc(65px + env(safe-area-inset-bottom)); }
  }
`;

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const consent = localStorage.getItem('cs_cookie_consent');
    if (!consent) setVisible(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const el = boxRef.current;
    if (!visible || !el) { root.style.removeProperty('--cs-cookie-space'); return undefined; }
    const measure = () => root.style.setProperty('--cs-cookie-space', `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); root.style.removeProperty('--cs-cookie-space'); };
  }, [visible]);

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
    <>
    <style>{CSS}</style>
    <div ref={boxRef} className="cs-cookie" data-cookie-notice style={{
      background: '#111', borderTop: '1px solid #2a2a2a',
      padding: '1rem 2rem', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap',
      fontFamily: 'Cormorant Garamond, Georgia, serif',
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
    </>
  );
}