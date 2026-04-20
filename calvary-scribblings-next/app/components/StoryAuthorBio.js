'use client';
import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';

const PURPLE = '#b28fd6';

function InstagramIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TwitterIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function StoryAuthorBio({ authorUid, fallbackName }) {
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthor, setIsAuthor] = useState(false);

  useEffect(() => {
    if (!authorUid) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const [authorSnap, userSnap] = await Promise.all([
          get(ref(db, `story_authors/${authorUid}`)),
          get(ref(db, `users/${authorUid}`)),
        ]);
        if (cancelled) return;
        if (userSnap.exists() && userSnap.val().isAuthor === true) {
          setIsAuthor(true);
        }
        if (authorSnap.exists()) {
          setRec(authorSnap.val());
        }
      } catch (e) {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authorUid]);

  if (loading || !isAuthor || !rec || !rec.bio) return null;

  const name = rec.displayName || fallbackName || '';
  const handle = rec.handle;
  const ig = rec.instagram;
  const tw = rec.twitter;

  return (
    <section style={{
      background: '#0a0a0a',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      padding: '3rem 0',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 2rem' }}>
        <p style={{
          margin: 0,
          fontSize: '0.72rem',
          letterSpacing: '0.22em',
          color: 'rgba(240,234,216,0.4)',
          textTransform: 'uppercase',
          fontFamily: 'Inter, sans-serif',
          marginBottom: '1.5rem',
        }}>
          About the Author
        </p>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          {rec.photoUrl ? (
            <img src={rec.photoUrl} alt={name} style={{
              width: 76, height: 76, borderRadius: '50%',
              objectFit: 'cover', flexShrink: 0,
              border: '1px solid rgba(255,255,255,0.08)',
            }} />
          ) : (
            <div style={{
              width: 76, height: 76, borderRadius: '50%',
              background: 'linear-gradient(135deg, #2d1b3d, #6b2fad)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#c9a44c', fontFamily: 'Georgia, serif', fontSize: '1.8rem',
              flexShrink: 0,
            }}>{(name || '?')[0]}</div>
          )}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
            {handle ? (
              <a href={`/user/${handle}`} style={{
                textDecoration: 'none',
                color: '#f0ead8',
                display: 'block',
                fontFamily: 'Georgia, serif',
                fontSize: '1.4rem',
                fontWeight: 500,
                lineHeight: 1.2,
                marginBottom: 4,
              }}>{name}</a>
            ) : (
              <div style={{
                color: '#f0ead8',
                fontFamily: 'Georgia, serif',
                fontSize: '1.4rem',
                fontWeight: 500,
                lineHeight: 1.2,
                marginBottom: 4,
              }}>{name}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: PURPLE, fontSize: '0.82rem', fontFamily: 'Inter, sans-serif' }}>
              {handle && (
                <a href={`/user/${handle}`} style={{ color: 'rgba(240,234,216,0.55)', textDecoration: 'none' }}>@{handle}</a>
              )}
              {ig && (
                <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" style={{ color: PURPLE, display: 'flex', alignItems: 'center' }} aria-label="Instagram">
                  <InstagramIcon />
                </a>
              )}
              {tw && (
                <a href={`https://twitter.com/${tw}`} target="_blank" rel="noopener noreferrer" style={{ color: PURPLE, display: 'flex', alignItems: 'center' }} aria-label="Twitter / X">
                  <TwitterIcon />
                </a>
              )}
            </div>
          </div>
        </div>
        <p style={{
          margin: 0,
          fontFamily: 'Georgia, serif',
          fontSize: '1rem',
          lineHeight: 1.7,
          color: 'rgba(240,234,216,0.78)',
          fontStyle: 'italic',
        }}>{rec.bio}</p>
      </div>
    </section>
  );
}
