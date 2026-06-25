'use client';

// Open Pages — post detail (Stage 4), client renderer for /open-pages/[id].
//
// Reads postId from the route params, fetches open_pages/{postId} once on mount,
// and renders the full post. The public node holds only moderation-cleared
// status:'live' posts, so anything found here is safe to show. Body is Markdown,
// rendered to React elements via the shared XSS-safe renderer (no raw HTML).
//
// Subscribe·Support and Report are UI ONLY in this stage — Stage 5 wires Report
// to the admin queue and a later stage wires subscriptions.

import { use, useEffect, useState } from 'react';
import Navbar from '../../components/Navbar';
import AuthModal from '../../components/AuthModal';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { OPEN_PAGES_NODE, normalizeGenre } from '../../lib/openPages';
import { renderMarkdown } from '../../lib/openPagesMarkdown';

const REPORT_REASONS = ['Harmful content', 'Spam', 'Plagiarism', 'Other'];

// Brand palette.
const INK = '#080610';
const SURFACE = '#120d1c';
const SURFACE_2 = '#1a1326';
const PURPLE = '#6b2fad';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const SERIF = "'Cormorant Garamond', 'Cochin', Georgia, serif";
const BODY_SERIF = "'Cochin', Georgia, serif";
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

function formatDate(ts) {
  if (!ts || typeof ts !== 'number') return '';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function OpenPageDetailClient({ params }) {
  const { id } = use(params);
  const { user } = useAuth();

  const [post, setPost] = useState(undefined); // undefined = loading, null = not found

  // Report flow. One report per user per post — the RTDB path is keyed by the
  // reporter's uid, so re-reporting just overwrites their own entry. We disable
  // the control for the session once submitted.
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState('');
  const [showAuth, setShowAuth] = useState(false);

  async function submitReport(reason) {
    if (!user) { setShowAuth(true); return; }
    setReporting(true);
    setReportError('');
    try {
      const { ref, set } = await import('firebase/database');
      await set(ref(db, `open_pages_reports/${id}/${user.uid}`), {
        reason,
        reporterUid: user.uid,
        createdAt: Date.now(),
      });
      setReported(true);
      setReportOpen(false);
    } catch (e) {
      console.error('[open-pages] report failed:', e);
      setReportError('Couldn’t submit your report. Please try again.');
    }
    setReporting(false);
  }

  function handleReportClick() {
    if (!user) { setShowAuth(true); return; }
    setReportOpen((v) => !v);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `${OPEN_PAGES_NODE}/${id}`));
        if (cancelled) return;
        const val = snap.exists() ? snap.val() : null;
        // Only ever show live posts (the public node should only hold these).
        setPost(val && val.status === 'live' ? { id, ...val } : null);
      } catch (e) {
        console.error('[open-pages] detail read failed:', e);
        if (!cancelled) setPost(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ---- Loading ----
  if (post === undefined) {
    return (
      <Shell>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px' }}>
          <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 14, background: 'rgba(245,240,232,0.05)', marginBottom: 28 }} />
          <div style={{ width: '70%', height: 38, borderRadius: 8, background: 'rgba(245,240,232,0.06)', marginBottom: 18 }} />
          <div style={{ width: '100%', height: 14, borderRadius: 6, background: 'rgba(245,240,232,0.04)', marginBottom: 10 }} />
          <div style={{ width: '90%', height: 14, borderRadius: 6, background: 'rgba(245,240,232,0.04)' }} />
        </div>
      </Shell>
    );
  }

  // ---- Not found ----
  if (post === null) {
    return (
      <Shell>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '6rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontFamily: SERIF, fontSize: '4rem', color: GOLD, opacity: 0.6, lineHeight: 1 }}>404</div>
          <div style={{ fontFamily: SERIF, fontSize: '1.9rem', color: CREAM, margin: '0.6rem 0 0.8rem' }}>
            This story isn’t here.
          </div>
          <p style={{ fontSize: '1.1rem', color: 'rgba(245,240,232,0.55)', marginBottom: '2rem' }}>
            It may have been removed, or the link is wrong.
          </p>
          <a href="/open-pages" style={backLink}>
            <IconArrowLeft size={16} /> Back to Open Pages
          </a>
        </div>
      </Shell>
    );
  }

  const genre = normalizeGenre(post.genre);
  const initial = (post.authorName || '?').trim().charAt(0).toUpperCase();

  return (
    <Shell>
      <article style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 90px' }}>
        {/* Back */}
        <div style={{ marginBottom: 28 }}>
          <a href="/open-pages" style={backLink}>
            <IconArrowLeft size={16} /> Open Pages
          </a>
        </div>

        {/* Cover */}
        {post.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImage}
            alt=""
            style={{ width: '100%', maxHeight: 440, objectFit: 'cover', borderRadius: 14, display: 'block', marginBottom: 30, border: '1px solid rgba(245,240,232,0.1)' }}
          />
        ) : null}

        {/* Genre + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={genrePill}>{genre}</span>
          <span style={{ fontSize: '0.82rem', color: 'rgba(245,240,232,0.45)' }}>{formatDate(post.createdAt)}</span>
        </div>

        {/* Title */}
        <h1 style={{ fontFamily: SERIF, fontSize: '2.9rem', fontWeight: 600, color: CREAM, margin: '0 0 1.2rem', lineHeight: 1.1 }}>
          {post.title}
        </h1>

        {/* Author row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 34, paddingBottom: 28, borderBottom: '1px solid rgba(245,240,232,0.08)' }}>
          <span style={avatar}>{initial}</span>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: '1.2rem', color: CREAM, fontWeight: 600 }}>{post.authorName || 'Reader'}</div>
            {post.authorHandle ? (
              <div style={{ fontSize: '0.88rem', color: 'rgba(245,240,232,0.45)' }}>@{post.authorHandle}</div>
            ) : null}
          </div>
        </div>

        {/* Body */}
        <div style={{ fontFamily: BODY_SERIF, fontSize: '1.22rem', lineHeight: 1.8 }}>
          {renderMarkdown(post.body)}
        </div>

        {/* Author card */}
        <div style={{ marginTop: 56, background: SURFACE, border: '1px solid rgba(245,240,232,0.08)', borderRadius: 16, padding: '1.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <span style={{ ...avatar, width: 52, height: 52, fontSize: '1.4rem' }}>{initial}</span>
            <div>
              <div style={{ fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, opacity: 0.75, marginBottom: 4 }}>
                Written by
              </div>
              <div style={{ fontFamily: SERIF, fontSize: '1.5rem', color: CREAM, fontWeight: 600, lineHeight: 1.1 }}>
                {post.authorName || 'Reader'}
              </div>
              {post.authorHandle ? (
                <div style={{ fontSize: '0.9rem', color: 'rgba(245,240,232,0.45)' }}>@{post.authorHandle}</div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            // UI only — subscriptions/support are wired in a later stage.
            onClick={() => {}}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              background: PURPLE,
              color: CREAM,
              border: 'none',
              borderRadius: 10,
              padding: '0.85rem 1.5rem',
              fontWeight: 700,
              fontSize: '1rem',
              fontFamily: BODY_SERIF,
              cursor: 'pointer',
              boxShadow: '0 8px 26px rgba(107,47,173,0.32)',
            }}
          >
            <IconHeart size={17} /> Subscribe · Support
          </button>
          <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'rgba(245,240,232,0.35)', marginTop: 10 }}>
            Supporting creators is coming soon.
          </div>
        </div>

        {/* Report — writes open_pages_reports/{postId}/{reporterUid}; the admin
            queue (app/admin/forum) reviews and acts on these. */}
        <div style={{ textAlign: 'center', marginTop: 30 }}>
          {reported ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.86rem', color: GOLD }}>
              <IconCheck size={15} /> Thanks — our moderators will take a look.
            </span>
          ) : reportOpen ? (
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: SURFACE, border: '1px solid rgba(245,240,232,0.1)', borderRadius: 12, padding: '1.1rem 1.3rem' }}>
              <div style={{ fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.55)' }}>
                Why are you reporting this?
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 360 }}>
                {REPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    disabled={reporting}
                    onClick={() => submitReport(reason)}
                    style={{
                      background: 'rgba(245,240,232,0.04)',
                      border: '1px solid rgba(245,240,232,0.16)',
                      color: 'rgba(245,240,232,0.8)',
                      borderRadius: 999,
                      padding: '0.45rem 1rem',
                      fontSize: '0.84rem',
                      fontFamily: BODY_SERIF,
                      cursor: reporting ? 'not-allowed' : 'pointer',
                      opacity: reporting ? 0.5 : 1,
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              {reportError ? (
                <div style={{ fontSize: '0.8rem', color: '#e88' }}>{reportError}</div>
              ) : null}
              <button
                type="button"
                onClick={() => { setReportOpen(false); setReportError(''); }}
                style={{ background: 'transparent', border: 'none', color: 'rgba(245,240,232,0.4)', fontSize: '0.8rem', fontFamily: BODY_SERIF, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleReportClick}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: 'transparent',
                border: 'none',
                color: 'rgba(245,240,232,0.4)',
                fontSize: '0.86rem',
                fontFamily: BODY_SERIF,
                cursor: 'pointer',
                padding: '0.4rem 0.6rem',
              }}
            >
              <IconFlag size={14} /> Report this post
            </button>
          )}
        </div>
      </article>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell + styles + icons.
// ---------------------------------------------------------------------------

function Shell({ children }) {
  return (
    <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
      <Navbar />
      {children}
    </div>
  );
}

const backLink = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  color: 'rgba(245,240,232,0.55)',
  textDecoration: 'none',
  fontFamily: CINZEL,
  fontSize: '0.72rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const genrePill = {
  fontFamily: CINZEL,
  fontSize: '0.64rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: GOLD,
  background: 'rgba(201,168,76,0.1)',
  border: '1px solid rgba(201,168,76,0.3)',
  borderRadius: 999,
  padding: '0.26rem 0.8rem',
};

const avatar = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  background: `linear-gradient(135deg, ${PURPLE}, #3a1a63)`,
  color: CREAM,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.1rem',
  fontWeight: 700,
  flexShrink: 0,
  fontFamily: SERIF,
};

function Svg({ size = 18, style, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flexShrink: 0, ...style }}>
      {children}
    </svg>
  );
}
const IconArrowLeft = (p) => (
  <Svg {...p}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Svg>
);
const IconHeart = (p) => (
  <Svg {...p}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </Svg>
);
const IconFlag = (p) => (
  <Svg {...p}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </Svg>
);
const IconCheck = (p) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
