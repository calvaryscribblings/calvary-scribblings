'use client';
// MY LIBRARY — the reader's own shelf. PLATFORM territory, gateway grammar (night canvas,
// gold + cream, Cinzel labels over Cormorant prose), not the purple platform chrome and not
// the bookstore's gold/black retail look.
//
// Two sections behind one switch:
//   ✦ STORIES — offline-saved stories. Shell only this round: the empty state is the whole
//               surface. The saving machinery (service worker, shelf writes, tier caps) is
//               Round 2 — nothing here reads or writes a shelf yet.
//   ❦ BOOKS   — purchased books, ported verbatim from the retired /library: reads
//               bookstore_purchases/{uid}, resolves display fields from bookstore_titles/{id}
//               (keyed by the same slug), 'Read now' → /reader/{slug}. Since the Book Store
//               doesn't open until 30 September 2026 there are no purchases yet, so the
//               countdown IS the empty state.
//
// /library is retired into this page (redirect in scripts/generate-redirects.mjs). It was
// platform territory, not bookstore-owned — it *was* the BOOKS half of this page.
//
// The countdown is the gateway's, verbatim in shape: London-anchored, date-only so it ticks
// over at London midnight, and server-rendered as the static LAUNCH_TEXT with the day count
// hydrated in — exactly as app/components/Gateway.js does it, so the no-JS and crawler render
// is a true sentence rather than a blank.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebaseCore';
import AuthModal from '../components/AuthModal';
import TabBar, { TabLinks } from '../components/TabBar';
import CoverImage from '../components/CoverImage';
import {
  listSaved, removeSaved, getCoverURL, capFor, savedAgo,
  isIOSSafariBrowser, getMeta, setMeta,
} from '../lib/shelf';
import { registerShelfWorker, sealShelf } from '../lib/shelfWorker';
import { useOffline } from '../lib/useOffline';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

// Mirrors app/components/Gateway.js — same date, same fallback sentence.
const LAUNCH = { y: 2026, m: 9, d: 30 };
const LAUNCH_TEXT = 'Opens 30 September';

function daysUntilLaunch() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const today = Date.UTC(get('year'), get('month') - 1, get('day'));
    const target = Date.UTC(LAUNCH.y, LAUNCH.m - 1, LAUNCH.d);
    return Math.round((target - today) / 86400000);
  } catch {
    return null;
  }
}

// Cover fallback gradients, carried over from /library so a title with no artwork still
// reads as a book rather than a hole in the grid.
const COVERS = [
  'linear-gradient(150deg,#3a1f52,#140b22)',
  'linear-gradient(150deg,#1b2c4a,#0d1120)',
  'linear-gradient(150deg,#4a2036,#1c0c18)',
  'linear-gradient(150deg,#22324a,#0b1018)',
  'linear-gradient(150deg,#2c2440,#120e1e)',
  'linear-gradient(150deg,#1a2a24,#0a1210)',
];
function gradientFor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length];
}

function BookCard({ book }) {
  return (
    <div className="ml-card">
      <div className="ml-cover" style={{ background: gradientFor(book.slug || book.title) }}>
        {book.coverUrl
          ? <img src={book.coverUrl} alt="" className="ml-cover-img" />
          : <div className="ml-cover-t">{book.title}</div>}
      </div>
      <div className="ml-meta-t">{book.title}</div>
      {book.author && <div className="ml-meta-a">{book.author}</div>}
      <a className="ml-read" href={`/reader/${book.slug}`}>READ NOW</a>
    </div>
  );
}

// A saved story on the shelf.
//
// A LEAN LOCAL CARD, not app/components/StoryCard. That component is built for the public
// library grid: it renders a QuizPill, an isNew() badge, a live read count and an optional
// rank, inside the purple platform chrome. None of that belongs on a night-canvas shelf,
// and the read count is live data a saved story deliberately does not carry. This card
// reuses the page's own .ml-cover/.ml-meta-* grid — already built for BOOKS — so STORIES
// and BOOKS are visibly the same shelf.
//
// CoverImage IS reused, because it earns its keep here more than anywhere: it decodes the
// blurhash from coverHash with zero network, so a cover whose blob went missing degrades to
// the story's own colour rather than a hole in the grid.
function ShelfStoryCard({ record, onRemove, busy }) {
  const [coverURL, setCoverURL] = useState(null);

  useEffect(() => {
    let url = null;
    let cancelled = false;
    getCoverURL(record).then((u) => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      url = u;
      setCoverURL(u);
    });
    // Object URLs are held by the document until revoked; a shelf that mounts and unmounts
    // without this leaks a blob per visit.
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [record.id, record.coverBlobKey]);

  return (
    <div className="ml-card">
      <a className="ml-cover-link" href={`/my-library/read?slug=${encodeURIComponent(record.slug)}`}>
        <div className="ml-cover">
          {/* No `cover` fallback URL on purpose: offline that remote URL cannot load, and
              CoverImage holds the <img> at opacity 0 until it decodes — so a missing blob
              leaves the blurhash showing rather than a broken-image glyph over it. */}
          <CoverImage
            fill
            coverSizes={coverURL ? { w360: coverURL } : null}
            coverHash={record.coverHash}
            alt={record.title}
          />
        </div>
      </a>
      <div className="ml-meta-t">{record.title}</div>
      {record.author && <div className="ml-meta-a">{record.author}</div>}
      <div className="ml-saved">{savedAgo(record.savedAt)}</div>
      <div className="ml-card-row">
        <a className="ml-read" href={`/my-library/read?slug=${encodeURIComponent(record.slug)}`}>READ</a>
        <button className="ml-remove" type="button" disabled={busy} onClick={() => onRemove(record.slug)}>REMOVE</button>
      </div>
    </div>
  );
}

export default function MyLibraryPage() {
  const { user, loading } = useAuth();
  const [section, setSection] = useState('stories');
  const [showAuth, setShowAuth] = useState(false);
  const [opensLabel, setOpensLabel] = useState(LAUNCH_TEXT);
  const [books, setBooks] = useState(null); // null = not loaded, [] = none owned

  // ── STORIES — the offline shelf ────────────────────────────────────────────────────────
  const offline = useOffline();
  const [saved, setSaved] = useState(null); // null = not loaded, [] = nothing saved
  const [removing, setRemoving] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const cap = capFor('story');

  const loadShelf = useCallback(async () => {
    if (!user) { setSaved(null); return; }
    setSaved(await listSaved(user.uid, 'story'));
  }, [user]);

  useEffect(() => { if (!loading) loadShelf(); }, [loadShelf, loading]);

  // Register here as well as on the story page: a reader can arrive at the shelf first
  // (it is the manifest's start_url, so an installed launch lands here), and the shell
  // must be sealed against the CURRENT deploy before they next lose signal.
  useEffect(() => {
    registerShelfWorker().then((reg) => { if (reg) sealShelf(); });
  }, []);

  const doRemove = useCallback(async (slug) => {
    if (!user) return;
    setRemoving(true);
    try {
      await removeSaved(user.uid, slug);
      await loadShelf();
    } finally {
      setRemoving(false);
    }
  }, [user, loadShelf]);

  // The iOS nudge, EARNED rather than pre-emptive. Safari clears all script-writable
  // storage after ~7 days without a visit, and the only exemption is a site on the Home
  // Screen — so a reader with a filled shelf on an iPhone is about to lose it silently.
  // Conditions, all required: iOS, in Safari's browser UI (not already installed), and at
  // least one story actually saved. Asking someone to install an app before they have used
  // it is an interstitial; asking after they have saved something is a warning.
  useEffect(() => {
    if (!Array.isArray(saved) || saved.length === 0) { setShowNudge(false); return; }
    if (!isIOSSafariBrowser()) { setShowNudge(false); return; }
    let cancelled = false;
    getMeta('iosNudgeDismissedAt', 0).then((ts) => {
      if (cancelled) return;
      // Re-offer after 30 days: still on iOS, still not installed, still holding a shelf
      // that Safari will bin. Once is polite; never again would be negligent.
      const RE_OFFER_MS = 30 * 24 * 60 * 60 * 1000;
      setShowNudge(!ts || Date.now() - ts > RE_OFFER_MS);
    });
    return () => { cancelled = true; };
  }, [saved]);

  const dismissNudge = async () => {
    setShowNudge(false);
    await setMeta('iosNudgeDismissedAt', Date.now());
  };

  // Countdown: static wording on the server, day count hydrated on the client. Re-ticks each
  // minute so a page left open across London midnight doesn't go stale.
  useEffect(() => {
    const tick = () => {
      const n = daysUntilLaunch();
      if (n === null || n <= 0) setOpensLabel(LAUNCH_TEXT);
      else if (n === 1) setOpensLabel('Opens tomorrow');
      else setOpensLabel(`Opens in ${n} days`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  // BOOKS — ported from /library.
  useEffect(() => {
    if (loading || !user) { setBooks(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `bookstore_purchases/${user.uid}`));
        if (!snap.exists()) { if (!cancelled) setBooks([]); return; }

        const entries = [];
        snap.forEach((child) => { entries.push({ id: child.key, ...(child.val() || {}) }); return false; });

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
        console.error('[my-library] purchases load failed', e);
        if (!cancelled) setBooks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  const initials = user ? (user.displayName || 'R').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : '';
  const ownedCount = Array.isArray(books) ? books.length : 0;

  return (
    <div className="ml-page">
      <style>{`
        .ml-page {
          min-height: 100vh;
          background: radial-gradient(130% 60% at 50% -10%, #241347 0%, #0b0716 58%, #080610 100%);
          background-attachment: fixed;
          color: #f5f0e8; font-family: ${DISPLAY};
        }
        .ml-topbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 18px 12px; }
        @media (min-width: 768px) { .ml-topbar { padding: 16px 40px 12px; } }
        .ml-wordmark { font-family: ${LABEL}; font-size: 11px; letter-spacing: .28em; color: #f5f0e8; text-decoration: none; white-space: nowrap; }
        .ml-hairline { height: 1px; background: linear-gradient(90deg, transparent, rgba(201,168,76,.5), transparent); }

        /* Canonical glass — .cs-gw-glass, verbatim (see app/components/Gateway.js). */
        .ml-glass {
          background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
          -webkit-backdrop-filter: blur(14px) saturate(1.35);
          backdrop-filter: blur(14px) saturate(1.35);
          border: 1px solid rgba(201,168,76,.35);
          box-shadow: inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25);
        }
        @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
          .ml-glass { background: rgba(11,7,22,.88); }
        }

        .ml-avatar {
          width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
          display: grid; place-items: center; text-decoration: none;
          font-family: ${LABEL}; font-size: 9px; color: #e2c876;
          border: 1px solid rgba(201,168,76,.35);
          background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
          overflow: hidden;
        }
        .ml-signin {
          border-radius: 999px; padding: 7px 15px; cursor: pointer;
          font-family: ${LABEL}; font-size: 8.5px; letter-spacing: .2em; color: #e2c876;
        }

        .ml-body { padding: 22px 18px 34px; max-width: 1180px; margin: 0 auto; }
        @media (min-width: 768px) { .ml-body { padding: 26px 40px 48px; } }

        .ml-eyebrow { font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .3em; color: #c9a84c; text-align: center; }
        .ml-rule { width: 60px; height: 1px; background: #c9a84c; opacity: .55; margin: 9px auto 0; }

        .ml-switch { display: flex; gap: 9px; justify-content: center; margin: 20px 0 6px; }
        .ml-sw {
          flex: 1; max-width: 158px; border-radius: 11px; padding: 11px 8px; text-align: center;
          cursor: pointer; font: inherit; color: inherit;
          transition: transform .09s ease, border-color .2s ease;
        }
        .ml-sw:active { transform: scale(.985); }
        .ml-sw:focus-visible { outline: 1px solid rgba(226,200,118,.9); outline-offset: 3px; }
        .ml-sw-g { display: block; font-size: 14px; color: rgba(201,168,76,.5); margin-bottom: 4px; }
        .ml-sw-t { display: block; font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .18em; color: rgba(245,240,232,.55); }
        .ml-sw-n { display: block; font-size: 11px; color: rgba(245,240,232,.35); margin-top: 2px; }
        .ml-sw.is-on { border-color: rgba(201,168,76,.6); }
        .ml-sw.is-on .ml-sw-g { color: #e2c876; }
        .ml-sw.is-on .ml-sw-t { color: #f5f0e8; }

        .ml-empty { text-align: center; padding: 56px 22px 30px; }
        .ml-empty-g { font-size: 22px; color: rgba(201,168,76,.5); }
        .ml-empty-h { font-size: 20px; color: #f5f0e8; margin-top: 14px; }
        .ml-empty-p { font-size: 14.5px; line-height: 1.55; color: rgba(245,240,232,.62); max-width: 290px; margin: 8px auto 0; }
        .ml-empty-p i { color: #e2c876; font-style: normal; }
        .ml-btn {
          display: inline-block; margin-top: 20px; border-radius: 999px; padding: 11px 22px;
          font-family: ${LABEL}; font-size: 9px; letter-spacing: .2em; color: #e2c876;
          text-decoration: none; cursor: pointer; transition: transform .09s ease;
        }
        .ml-btn:active { transform: scale(.985); }
        .ml-btn:focus-visible { outline: 1px solid rgba(226,200,118,.9); outline-offset: 3px; }

        .ml-soon { text-align: center; padding: 50px 22px 30px; }
        .ml-soon-g { font-size: 20px; color: rgba(201,168,76,.5); }
        .ml-soon-d { font-style: italic; font-size: 26px; color: #e2c876; margin-top: 12px; }
        .ml-soon-p { font-size: 14.5px; line-height: 1.55; color: rgba(245,240,232,.62); max-width: 300px; margin: 8px auto 0; }
        .ml-soon-note { font-family: ${LABEL}; font-size: 8px; letter-spacing: .16em; color: rgba(245,240,232,.38); margin-top: 22px; }

        .ml-grid { display: grid; gap: 14px; margin-top: 18px; grid-template-columns: repeat(2, 1fr); }
        @media (min-width: 768px) { .ml-grid { grid-template-columns: repeat(5, 1fr); gap: 18px; } }
        .ml-cover {
          position: relative; aspect-ratio: 2/3; border-radius: 8px; overflow: hidden;
          border: 1px solid rgba(201,168,76,.18); display: grid; place-items: center; padding: 14px 10px;
        }
        .ml-cover-img { width: 100%; height: 100%; object-fit: cover; }
        .ml-cover-t { font-family: ${LABEL}; font-size: 10px; letter-spacing: .1em; text-align: center; color: rgba(245,240,232,.92); line-height: 1.5; }
        .ml-meta-t { font-weight: 600; font-size: 13.5px; line-height: 1.25; color: #f5f0e8; margin-top: 7px; }
        .ml-meta-a { font-style: italic; font-size: 12px; color: rgba(245,240,232,.5); margin-top: 1px; }
        .ml-read {
          display: inline-block; margin-top: 7px; font-family: ${LABEL}; font-size: 7.5px;
          letter-spacing: .14em; color: rgba(201,168,76,.85); text-decoration: none;
          border-bottom: 1px solid rgba(201,168,76,.3); padding-bottom: 2px;
        }
        .ml-read:hover { color: #e2c876; border-bottom-color: rgba(201,168,76,.7); }

        .ml-cover-link { display: block; text-decoration: none; }
        .ml-saved { font-family: ${LABEL}; font-size: 7px; letter-spacing: .14em; color: rgba(245,240,232,.32); margin-top: 5px; }
        .ml-card-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
        .ml-remove {
          background: none; border: none; padding: 0; cursor: pointer;
          font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .14em;
          color: rgba(245,240,232,.32); transition: color .2s ease;
        }
        .ml-remove:hover { color: rgba(245,240,232,.6); }
        .ml-remove:focus-visible { outline: 1px solid rgba(226,200,118,.9); outline-offset: 3px; }

        /* OFFLINE — the banner. Shelf surfaces only. */
        .ml-offline {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          margin: 14px auto 0; max-width: 380px; padding: 9px 14px; border-radius: 9px;
          font-family: ${LABEL}; font-size: 8.5px; letter-spacing: .2em; color: #e2c876; text-align: center;
        }

        /* The device line — stated every time the shelf is looked at, not once at save time. */
        .ml-section-head {
          display: flex; align-items: baseline; justify-content: center; gap: 10px;
          margin-top: 20px; font-family: ${LABEL}; font-size: 8px; letter-spacing: .2em;
          color: rgba(245,240,232,.38); text-align: center; flex-wrap: wrap;
        }
        .ml-section-head b { font-weight: 400; color: rgba(226,200,118,.7); }

        .ml-nudge {
          max-width: 420px; margin: 18px auto 0; border-radius: 12px; padding: 15px 16px 13px;
          display: flex; gap: 12px; align-items: flex-start; text-align: left;
        }
        .ml-nudge-g { font-size: 15px; color: rgba(201,168,76,.65); line-height: 1.2; flex-shrink: 0; }
        .ml-nudge-t { font-size: 14px; color: #f5f0e8; line-height: 1.35; }
        .ml-nudge-p { font-size: 12.5px; line-height: 1.5; color: rgba(245,240,232,.6); margin: 4px 0 0; }
        .ml-nudge-x {
          background: none; border: none; padding: 2px 4px; cursor: pointer; flex-shrink: 0;
          font-family: ${LABEL}; font-size: 12px; color: rgba(245,240,232,.35); line-height: 1;
        }
        .ml-nudge-x:hover { color: rgba(245,240,232,.7); }

        .ml-skel { border-radius: 8px; background: rgba(245,240,232,.04); animation: ml-pulse 1.4s ease-in-out infinite; }
        @keyframes ml-pulse { 0%,100% { opacity: .45 } 50% { opacity: .8 } }

        /* The gate — an invitation to save, not a description of an empty container. */
        .ml-gate { max-width: 380px; margin: 44px auto 0; border-radius: 16px; padding: 40px 26px 34px; text-align: center; }
        .ml-gate-g { font-size: 22px; color: rgba(201,168,76,.6); }
        .ml-gate-h { font-size: 20px; color: #f5f0e8; margin-top: 14px; }
        .ml-gate-p { font-size: 14.5px; line-height: 1.55; color: rgba(245,240,232,.62); max-width: 290px; margin: 8px auto 0; }

        @media (prefers-reduced-motion: reduce) {
          .ml-sw, .ml-btn { transition: none; }
          .ml-sw:active, .ml-btn:active { transform: none; }
          .ml-skel { animation: none; }
        }
      `}</style>

      <div className="ml-topbar">
        <a className="ml-wordmark" href="/public-library">CALVARY SCRIBBLINGS</a>
        <TabLinks active="library" />
        {user ? (
          <a className="ml-avatar" href="/profile" title={user.displayName || 'Profile'}>{initials}</a>
        ) : (
          <button className="ml-signin ml-glass" type="button" onClick={() => setShowAuth(true)}>SIGN IN</button>
        )}
      </div>
      <div className="ml-hairline" />

      <div className="ml-body">
        <div className="ml-eyebrow">MY LIBRARY</div>
        <div className="ml-rule" />

        {/* Signed out — the gate sells the shelf rather than naming the container. */}
        {!loading && !user && (
          <div className="ml-gate ml-glass">
            <div className="ml-gate-g" aria-hidden="true">✦</div>
            <div className="ml-gate-h">Save stories to read offline</div>
            <p className="ml-gate-p">Your shelf keeps them for the tube, the bus, anywhere with no signal. Sign in to start one.</p>
            {/* Said at the gate, before anyone invests in a shelf: this one does not follow
                you between devices. IndexedDB has no sync, and the copy must not imply it does. */}
            <p className="ml-gate-p" style={{ marginTop: 8, fontSize: 13, opacity: .72 }}>
              Your shelf lives on the device you save from.
            </p>
            <button className="ml-btn ml-glass" type="button" onClick={() => setShowAuth(true)}>SIGN IN</button>
          </div>
        )}

        {!loading && user && (
          <>
            <div className="ml-switch">
              <button
                type="button"
                className={`ml-sw ml-glass${section === 'stories' ? ' is-on' : ''}`}
                aria-pressed={section === 'stories'}
                onClick={() => setSection('stories')}
              >
                <span className="ml-sw-g" aria-hidden="true">✦</span>
                <span className="ml-sw-t">STORIES</span>
                <span className="ml-sw-n">
                  {saved === null ? '—' : saved.length === 0 ? 'none saved' : `${saved.length} of ${cap} saved`}
                </span>
              </button>
              <button
                type="button"
                className={`ml-sw ml-glass${section === 'books' ? ' is-on' : ''}`}
                aria-pressed={section === 'books'}
                onClick={() => setSection('books')}
              >
                <span className="ml-sw-g" aria-hidden="true">❦</span>
                <span className="ml-sw-t">BOOKS</span>
                <span className="ml-sw-n">{ownedCount > 0 ? `${ownedCount} owned` : 'opens 30 Sept'}</span>
              </button>
            </div>

            {/* ── STORIES — the offline shelf ─────────────────────────── */}
            {section === 'stories' && (
              <>
                {offline && (
                  <div className="ml-offline ml-glass" role="status">
                    <span aria-hidden="true">✦</span> OFFLINE — YOUR SHELF IS HERE
                  </div>
                )}

                {saved === null && (
                  <div className="ml-grid" aria-hidden="true">
                    {Array.from({ length: cap }).map((_, i) => (
                      <div key={i}>
                        <div className="ml-skel" style={{ width: '100%', aspectRatio: '2/3' }} />
                        <div className="ml-skel" style={{ height: 11, width: '80%', marginTop: 9 }} />
                        <div className="ml-skel" style={{ height: 9, width: '55%', marginTop: 5 }} />
                      </div>
                    ))}
                  </div>
                )}

                {saved !== null && saved.length > 0 && (
                  <>
                    <div className="ml-section-head">
                      <span>ON THIS DEVICE</span>
                      <span aria-hidden="true">·</span>
                      <span><b>{saved.length}</b> OF {cap}</span>
                    </div>

                    {showNudge && (
                      <div className="ml-nudge ml-glass">
                        <span className="ml-nudge-g" aria-hidden="true">⇧</span>
                        <div style={{ flex: 1 }}>
                          <div className="ml-nudge-t">Keep your shelf longer</div>
                          <p className="ml-nudge-p">
                            iPhone clears saved stories after about a week away — unless Calvary
                            Scribblings is on your Home Screen. Tap <b>Share</b>, then <b>Add to Home Screen</b>.
                          </p>
                        </div>
                        <button className="ml-nudge-x" type="button" onClick={dismissNudge} aria-label="Dismiss">✕</button>
                      </div>
                    )}

                    <div className="ml-grid">
                      {saved.map((r) => (
                        <ShelfStoryCard key={r.id} record={r} onRemove={doRemove} busy={removing} />
                      ))}
                    </div>
                  </>
                )}

                {saved !== null && saved.length === 0 && (
                  <div className="ml-empty">
                    <div className="ml-empty-g" aria-hidden="true">✦</div>
                    <div className="ml-empty-h">Nothing on your shelf yet</div>
                    <p className="ml-empty-p">
                      Open any story and tap <i>⤓ Save for offline</i>. It stays readable with no signal — on the tube, on the bus, anywhere.
                    </p>
                    {/* The honesty line, in the empty state as well as the full one: the
                        constraint should be known BEFORE the first save, not discovered after. */}
                    <p className="ml-empty-p" style={{ marginTop: 10, fontSize: 13, opacity: .75 }}>
                      Saved stories live on this device only, and your shelf holds {cap}.
                    </p>
                    <a className="ml-btn ml-glass" href="/public-library">BROWSE THE LIBRARY</a>
                  </div>
                )}
              </>
            )}

            {/* ── BOOKS — purchases when they exist, countdown when they don't ── */}
            {section === 'books' && books === null && (
              <div className="ml-grid" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i}>
                    <div className="ml-skel" style={{ width: '100%', aspectRatio: '2/3' }} />
                    <div className="ml-skel" style={{ height: 11, width: '80%', marginTop: 9 }} />
                    <div className="ml-skel" style={{ height: 9, width: '55%', marginTop: 5 }} />
                  </div>
                ))}
              </div>
            )}

            {section === 'books' && books !== null && books.length > 0 && (
              <div className="ml-grid">
                {books.map((b) => <BookCard key={b.slug} book={b} />)}
              </div>
            )}

            {section === 'books' && books !== null && books.length === 0 && (
              <div className="ml-soon">
                <div className="ml-soon-g" aria-hidden="true">❦</div>
                <div className="ml-soon-d">{opensLabel}</div>
                <p className="ml-soon-p">Books you buy from the Book Store live here — yours to keep, on every device you read on.</p>
                <div className="ml-soon-note">THE BOOK STORE OPENS 30 SEPTEMBER</div>
              </div>
            )}
          </>
        )}
      </div>

      <TabBar active="library" />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
