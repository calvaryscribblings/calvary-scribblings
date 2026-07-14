'use client';
// The reader's own library — PLATFORM territory (a user's purchased books), not bookstore retail.
// Styled to match the platform's authed pages (profile/settings): dark #0d0d0d canvas, Cormorant
// Garamond, purple accents (#7c3aed / #a78bfa / #c4b5fd), rgba card surfaces. Not the gold/black
// bookstore look.
//
// Reads bookstore_purchases/{uid}. Titles are keyed by slug in bookstore_titles, and a purchase is
// keyed by that same titleId, so we resolve display fields straight from the public title node
// (falling back to any denormalised fields the purchase record may carry). At launch there are no
// purchases, so every user sees the empty state — which is why it's built to be genuinely nice.
//
// 'Read now' → /reader/{slug}. Until Phase B's streaming Worker lands, that hits the Part 3
// interstitial ("available in the Book Store") rather than opening the master EPUB — correct,
// intended behaviour for now.
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import AuthModal from '../components/AuthModal';

const COLORS = [
  'linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%)',
  'linear-gradient(148deg,#0e1a2e 0%,#060e1a 100%)',
  'linear-gradient(148deg,#1a120a 0%,#0e0806 100%)',
  'linear-gradient(148deg,#0a1a12 0%,#060e08 100%)',
  'linear-gradient(148deg,#1a0a14 0%,#0e0608 100%)',
  'linear-gradient(148deg,#141418 0%,#08080e 100%)',
];
function gradientFor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function BookCover({ book }) {
  const wrap = {
    position: 'relative', width: '100%', aspectRatio: '2/3', borderRadius: '3px 5px 5px 3px',
    overflow: 'hidden', background: gradientFor(book.slug || book.title),
    boxShadow: '0 8px 28px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04)',
  };
  if (book.coverUrl) {
    return (
      <div style={wrap}>
        <img src={book.coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{ ...wrap, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.2rem .9rem', textAlign: 'center' }}>
      <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'rgba(255,255,255,.85)', lineHeight: 1.25, marginBottom: '.35rem' }}>{book.title}</div>
      <div style={{ fontSize: '.68rem', fontStyle: 'italic', color: 'rgba(255,255,255,.42)' }}>{book.author}</div>
    </div>
  );
}

export default function LibraryPage() {
  const { user, loading } = useAuth();
  const [books, setBooks] = useState(null); // null = loading, [] = empty
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { setBooks(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `bookstore_purchases/${user.uid}`));
        if (!snap.exists()) { if (!cancelled) setBooks([]); return; }

        const entries = [];
        snap.forEach((child) => { entries.push({ id: child.key, ...(child.val() || {}) }); return false; });

        // Resolve display fields from the public title node (keyed by slug === titleId), with the
        // purchase record's own fields as a fallback in case a title was later unpublished.
        const resolved = await Promise.all(entries.map(async (p) => {
          let titleDoc = null;
          try {
            const tsnap = await get(ref(db, `bookstore_titles/${p.id}`));
            if (tsnap.exists()) titleDoc = tsnap.val();
          } catch { /* fall back to denormalised purchase fields */ }
          return {
            slug: titleDoc?.slug || p.slug || p.id,
            title: titleDoc?.title || p.title || 'Untitled',
            author: titleDoc?.author || p.author || '',
            coverUrl: titleDoc?.coverUrl || p.coverUrl || null,
            purchasedAt: typeof p.purchasedAt === 'number' ? p.purchasedAt : 0,
          };
        }));
        resolved.sort((a, b) => (b.purchasedAt || 0) - (a.purchasedAt || 0));
        if (!cancelled) setBooks(resolved);
      } catch (e) {
        console.error('[library] load failed', e);
        if (!cancelled) setBooks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  return (
    <>
      <Navbar />
      <style>{`
        body{background:#0d0d0d;color:#e8e0d4;font-family:'Cormorant Garamond',Georgia,serif}
        @keyframes lib-fade{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes lib-pulse{0%,100%{opacity:.4}50%{opacity:.7}}
        .lib-skel{background:rgba(255,255,255,.04);border-radius:6px;animation:lib-pulse 1.4s ease-in-out infinite}
        .lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:2rem 1.5rem}
        .lib-card{display:flex;flex-direction:column;animation:lib-fade .5s ease forwards}
        .lib-read{margin-top:.85rem;display:inline-block;text-align:center;font-size:.72rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#c4b5fd;background:rgba(107,47,173,.14);border:1px solid rgba(107,47,173,.32);border-radius:8px;padding:.55rem .9rem;text-decoration:none;transition:all .2s;font-family:'Cormorant Garamond',Georgia,serif}
        .lib-read:hover{background:rgba(107,47,173,.24);border-color:rgba(167,139,250,.5)}
        @media(max-width:560px){.lib-grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:1.5rem 1rem}}
      `}</style>

      <main style={{ background: '#0d0d0d', color: '#e8e0d4', minHeight: '100vh', paddingTop: '68px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '3.5rem 1.5rem 5rem' }}>
          <header style={{ marginBottom: '2.75rem' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 600, letterSpacing: '.22em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '.6rem' }}>Your shelf</div>
            <h1 style={{ fontSize: 'clamp(1.9rem,5vw,2.6rem)', fontWeight: 300, color: '#f5f0e8', lineHeight: 1.1 }}>Library</h1>
            <p style={{ fontSize: '1rem', color: 'rgba(232,224,212,.5)', marginTop: '.6rem', fontStyle: 'italic' }}>Every book you own, ready to open.</p>
          </header>

          {/* Signed out */}
          {!loading && !user && (
            <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: '16px', padding: '3.5rem 2rem', textAlign: 'center', maxWidth: '460px', margin: '2rem auto 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📚</div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 400, color: '#f5f0e8', marginBottom: '.6rem' }}>Sign in to see your library</h2>
              <p style={{ fontSize: '.95rem', color: 'rgba(232,224,212,.5)', lineHeight: 1.7, marginBottom: '1.75rem' }}>Your purchased books live here — sign in to pick up where you left off.</p>
              <button onClick={() => setShowAuth(true)} style={{ background: '#7c3aed', border: 'none', borderRadius: '8px', padding: '.75rem 1.8rem', color: '#fff', fontSize: '.8rem', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: "'Cormorant Garamond',Georgia,serif" }}>Sign in</button>
            </div>
          )}

          {/* Loading */}
          {(loading || (user && books === null)) && (
            <div className="lib-grid">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="lib-skel" style={{ width: '100%', aspectRatio: '2/3', borderRadius: '3px 5px 5px 3px' }} />
                  <div className="lib-skel" style={{ height: '.8rem', width: '80%', margin: '.85rem 0 .4rem' }} />
                  <div className="lib-skel" style={{ height: '.65rem', width: '55%' }} />
                </div>
              ))}
            </div>
          )}

          {/* Empty — the launch reality */}
          {user && books !== null && books.length === 0 && (
            <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: '16px', padding: '4rem 2rem', textAlign: 'center', maxWidth: '520px', margin: '1rem auto 0', animation: 'lib-fade .5s ease forwards' }}>
              <div style={{ position: 'relative', width: '96px', height: '120px', margin: '0 auto 1.75rem' }}>
                <div style={{ position: 'absolute', inset: 0, transform: 'rotate(-8deg)', borderRadius: '3px 5px 5px 3px', background: 'linear-gradient(148deg,#1a0a2e,#0e0618)', boxShadow: '0 8px 22px rgba(0,0,0,.5)', opacity: .55 }} />
                <div style={{ position: 'absolute', inset: 0, transform: 'rotate(5deg)', borderRadius: '3px 5px 5px 3px', background: 'linear-gradient(148deg,#0e1a2e,#060e1a)', boxShadow: '0 8px 22px rgba(0,0,0,.5)', opacity: .75 }} />
                <div style={{ position: 'absolute', inset: 0, borderRadius: '3px 5px 5px 3px', background: 'linear-gradient(148deg,#1a120a,#0e0806)', boxShadow: '0 10px 26px rgba(0,0,0,.6)', border: '1px solid rgba(167,139,250,.14)' }} />
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 400, color: '#f5f0e8', marginBottom: '.7rem' }}>Your library is empty — for now.</h2>
              <p style={{ fontSize: '.98rem', color: 'rgba(232,224,212,.5)', lineHeight: 1.75, marginBottom: '2rem', maxWidth: '380px', marginLeft: 'auto', marginRight: 'auto' }}>Once you buy a book it lands here, ready to read on any device. The shelves in the Book Store are filling up.</p>
              <a href="/bookstore" style={{ display: 'inline-block', background: '#7c3aed', borderRadius: '8px', padding: '.8rem 1.9rem', color: '#fff', fontSize: '.8rem', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: "'Cormorant Garamond',Georgia,serif" }}>Browse the Book Store →</a>
            </div>
          )}

          {/* Populated */}
          {user && books !== null && books.length > 0 && (
            <div className="lib-grid">
              {books.map((book) => (
                <div key={book.slug} className="lib-card">
                  <BookCover book={book} />
                  <div style={{ fontSize: '.92rem', fontWeight: 600, color: '#f5f0e8', lineHeight: 1.3, margin: '.85rem 0 .15rem' }}>{book.title}</div>
                  {book.author && <div style={{ fontSize: '.8rem', fontStyle: 'italic', color: 'rgba(232,224,212,.45)' }}>{book.author}</div>}
                  <a className="lib-read" href={`/reader/${book.slug}`}>Read now</a>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
