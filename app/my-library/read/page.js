'use client';
// THE SHELF READER — how a saved story is read, with or without a signal.
//
// One static route serving every saved story, addressed as /my-library/read?slug=<slug>.
// A dynamic segment would have forced generateStaticParams to build a reader page per
// story — 160+ pages of shell that exist only to read the same IndexedDB record — and would
// have coupled the reader's build to the story list. The query string costs one page.
//
// It reads window.location.search directly rather than useSearchParams(), deliberately:
// the Next hook requires a Suspense boundary and can push the route into client-side
// bailout under output:'export'. This page must be as close to inert HTML as a React page
// gets, because the whole point is that it works when nothing else does.
//
// ── WHY THIS EXISTS INSTEAD OF CACHING /stories/<slug> ───────────────────────────────────
// The story page is the heaviest route on the site (~1.16 MB of chunks) and its runtime
// talks to Firebase for the author's live name, the read counter, reactions, comments and
// the quiz. Offline, every one of those either fails or hangs, and each future edit to that
// page is a chance to add another one. This reader has no network calls at all, so its
// offline behaviour is not a matter of testing every path — there are no paths.
//
// What it deliberately does NOT reproduce: the hero, the comment thread, the quiz, the read
// counter. A saved story is a different object from a live one, and rendering dead
// affordances offline would be a worse lie than omitting them. When there IS a connection,
// the "View full story page" link puts all of it one tap away — so the lean reader is a
// choice the reader can leave, not a cage.
//
// The typography and the drop-cap tagger are IMPORTED from the story page's own modules
// (app/lib/proseCSS.js, app/lib/dropcap.js), never copied. Two copies would drift.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { getSaved, savedAgo } from '../../lib/shelf';
import { attachDropcap } from '../../lib/dropcap';
import { proseCSS } from '../../lib/proseCSS';
import { registerShelfWorker } from '../../lib/shelfWorker';
import { useOffline } from '../../lib/useOffline';
import AuthModal from '../../components/AuthModal';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

// Mirrors the story page's categoryColors so a saved story keeps its category's accent.
const CATEGORY_COLORS = {
  news: '#dc2626', flash: '#6b46c1', short: '#6b46c1',
  poetry: '#6b46c1', inspiring: '#d97706', serial: '#6b46c1',
};

export default function ShelfReaderPage() {
  const { user, loading } = useAuth();
  const offline = useOffline();
  const articleRef = useRef(null);

  // Read once, during render, via a lazy initialiser rather than in an effect. Safe for
  // hydration because `slug` never reaches the output on the first paint: `record` starts
  // undefined on both server and client, so both render the same empty beat. The server
  // has no location, hence the guard.
  const [slug] = useState(() => {
    if (typeof window === 'undefined') return null;
    try { return new URLSearchParams(window.location.search).get('slug'); } catch { return null; }
  });
  const [record, setRecord] = useState(undefined); // undefined = loading, null = not found
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => { registerShelfWorker(); }, []);

  // getSaved already returns null for a missing uid or slug, so there is no branch here
  // that sets state synchronously — every path resolves through the promise.
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    getSaved(user?.uid, slug).then((r) => { if (!cancelled) setRecord(r); });
    return () => { cancelled = true; };
  }, [slug, user, loading]);

  // The same tagger the story page runs, on the same markup. Keyed on the record so it
  // fires once the prose is actually in the DOM.
  useEffect(() => {
    if (!record) return undefined;
    return attachDropcap(articleRef.current);
  }, [record]);

  useEffect(() => {
    if (record?.title) document.title = `${record.title} — Calvary Scribblings`;
  }, [record?.title]);

  const accent = CATEGORY_COLORS[record?.category] || '#6b46c1';
  const isPoetry = record?.category === 'poetry';

  return (
    <div className="sr-page">
      <style>{`
        .sr-page { min-height: 100vh; background: #f0ead8; }
        .sr-top {
          background: radial-gradient(130% 160% at 50% -40%, #241347 0%, #0b0716 60%, #080610 100%);
          color: #f5f0e8; padding: 14px 18px 16px;
        }
        @media (min-width: 768px) { .sr-top { padding: 16px 40px 18px; } }
        .sr-topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .sr-back {
          font-family: ${LABEL}; font-size: 8.5px; letter-spacing: .2em;
          color: #e2c876; text-decoration: none; white-space: nowrap;
        }
        .sr-shelfmark { font-family: ${LABEL}; font-size: 8px; letter-spacing: .18em; color: rgba(245,240,232,.4); }

        /* OFFLINE — the banner from the mockup. Shelf surfaces only: a sitewide offline
           strip on a site that mostly needs a connection is noise, not information. */
        .sr-offline {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          margin-top: 12px; padding: 8px 12px; border-radius: 8px;
          border: 1px solid rgba(201,168,76,.35);
          background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
          font-family: ${LABEL}; font-size: 8.5px; letter-spacing: .2em; color: #e2c876;
          text-align: center;
        }

        .sr-meta { margin-top: 18px; }
        .sr-badge {
          display: inline-block; font-size: 0.64rem; font-weight: 600; letter-spacing: 0.18em;
          text-transform: uppercase; padding: 0.3em 0.9em; border: 1px solid ${accent};
          color: ${accent}; border-radius: 2px; font-family: ${DISPLAY};
        }
        .sr-title { font-family: ${DISPLAY}; font-size: clamp(1.6rem, 5.5vw, 2.2rem); line-height: 1.18; margin: 12px 0 0; font-weight: 600; }
        .sr-byline {
          font-family: ${DISPLAY}; font-size: 0.82rem; color: rgba(245,240,232,.55);
          margin-top: 8px; display: flex; align-items: center; gap: .55rem; flex-wrap: wrap;
        }
        .sr-dot { width: 3px; height: 3px; border-radius: 50%; background: ${accent}; opacity: .8; }
        .sr-saved { font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .16em; color: rgba(245,240,232,.38); margin-top: 10px; }

        .sr-body { max-width: 680px; margin: 0 auto; padding: 3rem 2rem 4rem; }
        .sr-row {
          margin-bottom: 2.2rem; padding-bottom: 1.2rem; border-bottom: 1px solid #e0dbd2;
          display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem;
        }
        .sr-link {
          display: inline-flex; align-items: center; gap: .4em; font-size: .78rem;
          letter-spacing: .1em; text-transform: uppercase; color: ${accent};
          text-decoration: none; font-family: ${DISPLAY};
        }
        .sr-link:hover { text-decoration: underline; }
        .sr-full {
          display: inline-flex; align-items: center; gap: .4em; font-size: .78rem;
          letter-spacing: .1em; text-transform: uppercase; color: #c9a44c;
          text-decoration: none; font-family: ${DISPLAY};
          border: 1px solid rgba(201,164,76,.4); padding: .3em .8em; border-radius: 2px;
        }
        .sr-full:hover { background: rgba(201,164,76,.08); }

        ${proseCSS(accent)}

        .sr-end { text-align: center; padding: 2.5rem 0 0; }
        .sr-end-orn { color: #c9a84c; opacity: .6; font-size: 1rem; }
        .sr-end-rule { display: block; width: 60px; height: 1px; background: #c9a84c; opacity: .35; margin: 12px auto 0; }
        .sr-foot {
          max-width: 680px; margin: 0 auto; padding: 1.4rem 2rem 3rem; text-align: center;
          font-family: ${DISPLAY}; font-size: .78rem; letter-spacing: .08em;
          text-transform: uppercase; color: #999;
        }

        .sr-gate { max-width: 380px; margin: 0 auto; padding: 56px 26px; text-align: center; font-family: ${DISPLAY}; }
        .sr-gate-g { font-size: 22px; color: rgba(201,168,76,.6); }
        .sr-gate-h { font-size: 20px; color: #1a1a1a; margin-top: 14px; }
        .sr-gate-p { font-size: 14.5px; line-height: 1.55; color: rgba(26,26,26,.6); margin: 8px auto 0; max-width: 300px; }
        .sr-btn {
          display: inline-block; margin-top: 20px; border-radius: 999px; padding: 11px 22px;
          font-family: ${LABEL}; font-size: 9px; letter-spacing: .2em; color: #6b46c1;
          text-decoration: none; cursor: pointer; border: 1px solid rgba(107,70,193,.4); background: none;
        }
      `}</style>

      <div className="sr-top">
        <div className="sr-topbar">
          <a className="sr-back" href="/my-library">← MY LIBRARY</a>
          <span className="sr-shelfmark">ON YOUR SHELF</span>
        </div>

        {offline && (
          <div className="sr-offline" role="status">
            <span aria-hidden="true">✦</span> OFFLINE — YOUR SHELF IS HERE
          </div>
        )}

        {record && (
          <div className="sr-meta">
            <div className="sr-badge">{record.subcategory || record.categoryName || record.category}</div>
            <h1 className="sr-title">{record.title}</h1>
            <div className="sr-byline">
              <span style={{ fontStyle: 'italic' }}>by</span>
              <span>{record.author}</span>
              {record.date && (<><span className="sr-dot" /><span>{record.date}</span></>)}
              {record.readingTime > 0 && (<><span className="sr-dot" /><span>{record.readingTime} MIN. READ</span></>)}
            </div>
            <div className="sr-saved">{savedAgo(record.savedAt)} · ON THIS DEVICE</div>
          </div>
        )}
      </div>

      {/* Loading. No skeleton worth the name: an IndexedDB read is sub-frame, and a
          skeleton that flashes for 8ms is worse than a blank beat. */}
      {record === undefined && <div style={{ minHeight: '40vh' }} />}

      {record === null && !loading && (
        <div className="sr-gate">
          <div className="sr-gate-g" aria-hidden="true">✦</div>
          {!user ? (
            <>
              <div className="sr-gate-h">Sign in to open your shelf</div>
              <p className="sr-gate-p">Saved stories are kept per account on this device.</p>
              <button className="sr-btn" type="button" onClick={() => setShowAuth(true)}>SIGN IN</button>
            </>
          ) : (
            <>
              <div className="sr-gate-h">This story isn&rsquo;t on your shelf</div>
              <p className="sr-gate-p">
                {offline
                  ? 'You’re offline, and this one wasn’t saved for reading without a connection.'
                  : 'Open it on the site and tap ⤓ Save for offline to keep a copy here.'}
              </p>
              <a className="sr-btn" href="/my-library">BACK TO MY LIBRARY</a>
            </>
          )}
        </div>
      )}

      {record && (
        <>
          <article className="sr-body" ref={articleRef}>
            <div className="sr-row">
              <a className="sr-link" href="/my-library">← Your shelf</a>
              {/* Online only. The lean reader is a choice, not a cage — comments, the quiz
                  and reactions stay one tap away whenever there is a connection to serve
                  them. Offline the link is omitted rather than shown broken. */}
              {!offline && (
                <a className="sr-full" href={`/stories/${record.slug}`}>View full story page →</a>
              )}
            </div>
            <div
              className={`prose${isPoetry ? '' : ' has-dropcap'}`}
              id="story-content"
              dangerouslySetInnerHTML={{ __html: record.content || '<p>This saved copy has no text.</p>' }}
            />
            <div className="sr-end" aria-hidden="true">
              <span className="sr-end-orn">✦</span>
              <span className="sr-end-rule" />
            </div>
          </article>
          <div className="sr-foot">By {record.author}{record.date ? ` · ${record.date}` : ''}</div>
        </>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
