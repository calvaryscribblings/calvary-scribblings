'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import AuthModal from './AuthModal';

export default function Navbar() {
  const { user, logout } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!user) { setAvatarUrl(null); return; }
    (async () => {
      try {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getDatabase, ref, get } = await import('firebase/database');
        const firebaseConfig = {
          apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
          authDomain: 'calvary-scribblings.firebaseapp.com',
          databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
          projectId: 'calvary-scribblings',
          storageBucket: 'calvary-scribblings.firebasestorage.app',
          messagingSenderId: '1052137412283',
          appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
        };
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getDatabase(app);
        const snap = await get(ref(db, `users/${user.uid}/avatarUrl`));
        if (snap.exists()) setAvatarUrl(snap.val());
        else setAvatarUrl(null);
      } catch (e) {
        setAvatarUrl(null);
      }
    })();
  }, [user]);

  const initials = user ? (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '';

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

        .cs-stories-wrap { position: relative; }
        .cs-stories-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.75); font-size: 0.82rem; font-weight: 500;
          display: flex; align-items: center; gap: 0.3em; padding: 0;
        }
        .cs-stories-btn:hover { color: #fff; }
        .cs-stories-btn span { font-size: 0.6rem; opacity: 0.6; }
        .cs-dropdown {
          position: absolute; top: calc(100% + 12px); left: 0;
          background: rgba(15,15,15,0.98); backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
          padding: 0.5rem 0; min-width: 200px; z-index: 2000;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        .cs-dropdown a {
          display: block; padding: 0.55rem 1.25rem;
          color: rgba(255,255,255,0.75) !important; font-size: 0.82rem !important;
          text-decoration: none; transition: color 0.2s;
        }
        .cs-dropdown a:hover { color: #fff !important; background: rgba(255,255,255,0.04); }
        .cs-dropdown-label {
          padding: 0.6rem 1.25rem 0.25rem;
          font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em;
          text-transform: uppercase; color: rgba(255,255,255,0.3);
        }
        .cs-dropdown-dot { color: #7c3aed; margin-right: 0.4em; }
        .cs-dropdown hr { border: none; border-top: 1px solid rgba(255,255,255,0.07); margin: 0.4rem 0; }

        .cs-signin-btn {
          background: #7c3aed; border: none; border-radius: 3px;
          padding: 0.4em 1em; color: #fff; font-size: 0.72rem;
          font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
          cursor: pointer;
        }

        .cs-nav-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: rgba(107,47,173,0.3); border: 1.5px solid rgba(107,47,173,0.5);
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 600; color: #c4b5fd;
          text-decoration: none; flex-shrink: 0; overflow: hidden;
          transition: border-color 0.2s; font-family: Inter, sans-serif;
        }
        .cs-nav-avatar:hover { border-color: rgba(167,139,250,0.8); }
        .cs-nav-avatar img { width: 100%; height: 100%; object-fit: cover; }

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
        .cs-drawer > a {
          color: rgba(255,255,255,0.85); text-decoration: none;
          font-size: 1.1rem; font-weight: 500; padding: 0.85rem 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; gap: 0.5em;
        }
        .cs-drawer-stories-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.85); font-size: 1.1rem; font-weight: 500;
          padding: 0.85rem 0; border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; justify-content: space-between;
          width: 100%; text-align: left;
        }
        .cs-drawer-stories-btn .cs-arrow { font-size: 0.7rem; opacity: 0.5; transition: transform 0.2s; display: inline-block; }
        .cs-drawer-stories-btn.open .cs-arrow { transform: rotate(180deg); }

        .cs-drawer-subnav {
          display: flex; flex-direction: column;
          background: rgba(255,255,255,0.03);
          border-radius: 8px; margin-bottom: 0.25rem;
          border: 1px solid rgba(255,255,255,0.06);
        }
        .cs-drawer-sublabel {
          color: rgba(255,255,255,0.3); font-size: 0.62rem;
          letter-spacing: 0.12em; text-transform: uppercase;
          padding: 0.75rem 1rem 0.25rem; border-bottom: none;
        }
        .cs-drawer-subnav-item {
          color: rgba(255,255,255,0.85) !important; text-decoration: none;
          font-size: 1rem !important; font-weight: 500;
          padding: 0.75rem 1rem !important;
          border-bottom: 1px solid rgba(255,255,255,0.05) !important;
          display: flex !important; align-items: center; gap: 0.5em;
        }
        .cs-drawer-subnav-item:last-child { border-bottom: none !important; }
        .cs-drawer-subnav-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 0; }
        .cs-drawer-dot { color: #7c3aed; }
        .cs-drawer-signin {
          margin-top: 1.5rem; background: #7c3aed; border: none;
          border-radius: 8px; padding: 1rem; color: #fff;
          font-size: 1rem; font-weight: 600; cursor: pointer; text-align: center;
        }

        .cs-drawer-avatar-row {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 1rem 0; border-bottom: 1px solid rgba(255,255,255,0.06);
          text-decoration: none;
        }
        .cs-drawer-avatar {
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(107,47,173,0.3); border: 1.5px solid rgba(107,47,173,0.5);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 600; color: #c4b5fd;
          overflow: hidden; flex-shrink: 0; font-family: Inter, sans-serif;
        }
        .cs-drawer-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .cs-drawer-avatar-name { font-size: 0.95rem; font-weight: 500; color: rgba(255,255,255,0.85); }
        .cs-drawer-avatar-sub { font-size: 0.68rem; color: rgba(255,255,255,0.3); margin-top: 1px; }

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
          <a href="/">Home</a>
          <div className="cs-stories-wrap" onMouseEnter={() => setDropdownOpen(true)} onMouseLeave={() => setDropdownOpen(false)}>
            <button className="cs-stories-btn">Stories <span>▾</span></button>
            {dropdownOpen && (
              <div className="cs-dropdown">
                <div className="cs-dropdown-label">Creative Writing</div>
                <a href="/flash"><span className="cs-dropdown-dot">·</span>Flash Fiction</a>
                <a href="/short"><span className="cs-dropdown-dot">·</span>Short Stories</a>
                <a href="/serial"><span className="cs-dropdown-dot">·</span>Serial Stories</a>
                <a href="/poetry"><span className="cs-dropdown-dot">·</span>Poetry</a>
                <hr />
                <a href="/news">News &amp; Updates</a>
                <a href="/inspiring">Inspiring Stories</a>
              </div>
            )}
          </div>
          <a href="/about">About</a>
          <a href="https://calvaryscribblings.co.uk/#subscribe">Subscribe</a>
          <a href="/contact">Contact</a>
          <a href="/search">Search</a>
          {user ? (
            <a href="/profile" className="cs-nav-avatar" title={user.displayName || 'Profile'}>
              {avatarUrl ? <img src={avatarUrl} alt={user.displayName || 'Avatar'} /> : initials}
            </a>
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
          {user && (
            <a href="/profile" className="cs-drawer-avatar-row" onClick={() => setMenuOpen(false)}>
              <div className="cs-drawer-avatar">
                {avatarUrl ? <img src={avatarUrl} alt={user.displayName || 'Avatar'} /> : initials}
              </div>
              <div>
                <div className="cs-drawer-avatar-name">{user.displayName || 'Reader'}</div>
                <div className="cs-drawer-avatar-sub">View profile</div>
              </div>
            </a>
          )}

          <a href="/" onClick={() => setMenuOpen(false)}>Home</a>

          <button
            className={'cs-drawer-stories-btn' + (storiesOpen ? ' open' : '')}
            onClick={() => setStoriesOpen(!storiesOpen)}
          >
            Stories <span className="cs-arrow">▾</span>
          </button>

          {storiesOpen && (
            <div className="cs-drawer-subnav">
              <div className="cs-drawer-sublabel">Creative Writing</div>
              <a className="cs-drawer-subnav-item" href="/flash" onClick={() => setMenuOpen(false)}><span className="cs-drawer-dot">·</span>Flash Fiction</a>
              <a className="cs-drawer-subnav-item" href="/short" onClick={() => setMenuOpen(false)}><span className="cs-drawer-dot">·</span>Short Stories</a>
              <a className="cs-drawer-subnav-item" href="/serial" onClick={() => setMenuOpen(false)}><span className="cs-drawer-dot">·</span>Serial Stories</a>
              <a className="cs-drawer-subnav-item" href="/poetry" onClick={() => setMenuOpen(false)}><span className="cs-drawer-dot">·</span>Poetry</a>
              <div className="cs-drawer-subnav-divider" />
              <a className="cs-drawer-subnav-item" href="/news" onClick={() => setMenuOpen(false)}>News &amp; Updates</a>
              <a className="cs-drawer-subnav-item" href="/inspiring" onClick={() => setMenuOpen(false)}>Inspiring Stories</a>
            </div>
          )}

          <a href="/about" onClick={() => setMenuOpen(false)}>About</a>
          <a href="https://calvaryscribblings.co.uk/#subscribe" onClick={() => setMenuOpen(false)}>Subscribe</a>
          <a href="/contact" onClick={() => setMenuOpen(false)}>Contact</a>
          <a href="/search" onClick={() => setMenuOpen(false)}>Search</a>

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