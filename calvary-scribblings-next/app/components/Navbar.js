'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import AuthModal from './AuthModal';

export default function Navbar() {
  const { user, logout } = useAuth();

  const links = [['Home', '/'], ['About', '/about'], ['Subscribe', '/subscribe'], ['Contact', '/contact']];
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);



  return (
    <>
      <style>{`
        .cs-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
          padding: 0 4%; height: 68px;
          display: flex; align-items: center; justify-content: space-between;
          transition: background 0.3s, backdrop-filter 0.3s;
        }
        .cs-nav.scrolled {
          background: rgba(10,10,10,0.96);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .cs-nav.top {
          background: linear-gradient(to bottom, rgba(0,0,0,0.85), transparent);
        }
        .cs-logo { text-decoration: none; display: flex; align-items: center; gap: 0.6rem; }
        .cs-logo-title { color: #a78bfa; font-weight: 700; font-size: 1rem; line-height: 1.1; }
        .cs-logo-sub { color: rgba(255,255,255,0.4); font-size: 0.55rem; letter-spacing: 0.12em; text-transform: uppercase; }
        .cs-desktop-links { display: flex; align-items: center; gap: 1.2rem; }
        .cs-desktop-links a { color: rgba(255,255,255,0.75); text-decoration: none; font-size: 0.82rem; font-weight: 500; }
        .cs-desktop-links a:hover { color: #fff; }
        .cs-signin-btn {
          background: #7c3aed; border: none; border-radius: 3px;
          padding: 0.4em 1em; color: #fff; font-size: 0.72rem;
          font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
          cursor: pointer;
        }
        .cs-hamburger {
          display: none; flex-direction: column; gap: 5px;
          background: none; border: none; cursor: pointer; padding: 4px; z-index: 1001;
        }
        .cs-hamburger span {
          display: block; width: 24px; height: 2px;
          background: #fff; border-radius: 2px; transition: all 0.3s;
        }
        .cs-drawer {
          position: fixed; top: 68px; left: 0; right: 0; bottom: 0;
          background: rgba(10,10,10,0.98); z-index: 999;
          display: flex; flex-direction: column; padding: 1.5rem 4%;
          overflow-y: auto;
        }
        .cs-drawer a {
          color: rgba(255,255,255,0.85); text-decoration: none;
          font-size: 1.1rem; font-weight: 500; padding: 0.85rem 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .cs-drawer-signin {
          margin-top: 1.5rem; background: #7c3aed; border: none;
          border-radius: 8px; padding: 1rem; color: #fff;
          font-size: 1rem; font-weight: 600; cursor: pointer; text-align: center;
        }
        @media (max-width: 768px) {
          .cs-desktop-links { display: none !important; }
          .cs-hamburger { display: flex !important; }
        }
      `}</style>

      <nav className={`cs-nav ${scrolled ? 'scrolled' : 'top'}`}>
        <a href="/" className="cs-logo">
          <img src="/favicon.png" alt="Calvary Scribblings" style={{ width: 36, height: 36, borderRadius: 8 }} />
          <div>
            <div className="cs-logo-title">Calvary Scribblings</div>
            <div className="cs-logo-sub">A Calvary Media UK Publication</div>
          </div>
        </a>

        <div className="cs-desktop-links">
          {links.map(([label, href]) => (
            <a key={label} href={href}>{label}</a>
          ))}
          {user ? (
            <>
              <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.82rem' }}>{user.displayName || user.email}</span>
              <button onClick={logout} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3, padding: '0.3em 0.8em', color: 'rgba(255,255,255,0.65)', fontSize: '0.72rem', cursor: 'pointer' }}>Sign Out</button>
            </>
          ) : (
            <button className="cs-signin-btn" onClick={() => setShowAuth(true)}>Sign In</button>
          )}
        </div>

        <button className="cs-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          <span style={{ transform: menuOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none' }} />
          <span style={{ opacity: menuOpen ? 0 : 1 }} />
          <span style={{ transform: menuOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none' }} />
        </button>
      </nav>

      {menuOpen && (
        <div className="cs-drawer">
          {[['Home', '/'], ['About', '/about'], ['Subscribe', '/subscribe'], ['Contact', '/contact']].map(([label, href]) => (
            <a key={label} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '1rem 0 0.25rem' }}>Creative Writing</div>
          {[['Flash Fiction', '/flash'], ['Short Stories', '/short'], ['Serial Stories', '/serial'], ['Poetry', '/poetry']].map(([label, href]) => (
            <a key={label} href={href} onClick={() => setMenuOpen(false)} style={{ paddingLeft: '0.75rem' }}>{label}</a>
          ))}
          {[['News & Updates', '/news'], ['Inspiring Stories', '/inspiring'], ['Search', '/search']].map(([label, href]) => (
            <a key={label} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
          {user ? (
            <button className="cs-drawer-signin" onClick={logout}>Sign Out</button>
          ) : (
            <button className="cs-drawer-signin" onClick={() => { setMenuOpen(false); setShowAuth(true); }}>Sign In</button>
          )}
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
