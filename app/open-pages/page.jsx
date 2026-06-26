'use client';

// Open Pages — public feed (Stage 4). /open-pages
//
// Fully client-rendered (the site is a static export, so there is no server to
// query RTDB per request). On mount it does ONE read of the public open_pages
// node — which by construction holds only moderation-cleared, status:'live'
// posts (see app/lib/openPages.js: the public node is Admin-SDK-write-only) —
// sorts newest-first, and lets the reader filter by genre.
//
// NOTE on the data model: the live Stage 1–3 implementation stores posts at
// open_pages/{postId} with fields { title, body (Markdown), coverImage,
// authorUid, authorName, authorHandle, genre, status:'live', createdAt }. The
// post key IS the id. We read those exact fields here.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Navbar from '../components/Navbar';
import { db } from '../lib/firebase';
import { OPEN_PAGES_NODE, OPEN_PAGE_GENRES, normalizeGenre } from '../lib/openPages';
import { stripMarkdown } from '../lib/openPagesMarkdown';

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

const FILTERS = ['All', ...OPEN_PAGE_GENRES];
const EXCERPT_LEN = 120;

// Relative time — "just now", "5 minutes ago", "2 days ago", then a date.
function timeAgo(ts) {
  if (!ts || typeof ts !== 'number') return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(days / 7);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function excerpt(body) {
  const text = stripMarkdown(body);
  if (text.length <= EXCERPT_LEN) return text;
  return text.slice(0, EXCERPT_LEN).replace(/\s+\S*$/, '') + '…';
}

// ---------------------------------------------------------------------------

export default function OpenPagesFeed() {
  const [posts, setPosts] = useState(null); // null = loading, [] = loaded empty
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('All');
  // Per-post engagement counts, keyed by postId: { commentCount, reactionCount }.
  // Fetched in a second pass once the feed list is known.
  const [counts, setCounts] = useState({});
  // Author profile photos, keyed by authorUid -> photo URL (or null). Fetched in
  // the same second pass so cards can show real avatars (same source as the
  // detail page: users/{uid} avatarUrl/photoURL).
  const [authorPhotos, setAuthorPhotos] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, OPEN_PAGES_NODE));
        if (cancelled) return;
        if (!snap.exists()) {
          setPosts([]);
          return;
        }
        const val = snap.val();
        const list = Object.entries(val)
          .map(([id, p]) => ({ id, ...p }))
          .filter((p) => p && p.status === 'live' && p.title)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setPosts(list);

        // Second pass: one parallel read per post for comment + reaction counts.
        // comments/{postId} — count the keys. open_pages_reactions/{postId} —
        // count the keys (one per reactor); falls back to a count stored on the
        // post object, else 0. Both degrade gracefully when the node is absent.
        const entries = await Promise.all(
          list.map(async (p) => {
            try {
              const [cSnap, rSnap] = await Promise.all([
                get(ref(db, `comments/${p.id}`)),
                get(ref(db, `open_pages_reactions/${p.id}`)),
              ]);
              const commentCount = cSnap.exists() ? Object.keys(cSnap.val()).length : 0;
              let reactionCount = rSnap.exists() ? Object.keys(rSnap.val()).length : 0;
              if (!reactionCount && typeof p.reactionCount === 'number') reactionCount = p.reactionCount;
              return [p.id, { commentCount, reactionCount }];
            } catch {
              return [p.id, { commentCount: 0, reactionCount: 0 }];
            }
          })
        );
        if (cancelled) return;
        setCounts(Object.fromEntries(entries));

        // Author avatars: one read per unique author at users/{authorUid} for the
        // real profile photo (avatarUrl/photoURL), matching the detail page.
        const uids = [...new Set(list.map((p) => p.authorUid).filter(Boolean))];
        const photoEntries = await Promise.all(
          uids.map(async (uid) => {
            try {
              const s = await get(ref(db, `users/${uid}`));
              const v = s.exists() ? s.val() : null;
              return [uid, v ? v.avatarUrl || v.photoURL || null : null];
            } catch {
              return [uid, null];
            }
          })
        );
        if (cancelled) return;
        setAuthorPhotos(Object.fromEntries(photoEntries));
      } catch (e) {
        console.error('[open-pages] feed read failed:', e);
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!posts) return [];
    if (filter === 'All') return posts;
    return posts.filter((p) => normalizeGenre(p.genre) === filter);
  }, [posts, filter]);

  const loading = posts === null && !error;

  return (
    <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
      <Navbar />

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '56px 24px 100px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ fontFamily: CINZEL, fontSize: 11, letterSpacing: '0.28em', textTransform: 'uppercase', color: GOLD, opacity: 0.8, marginBottom: 16 }}>
            Open Pages
          </div>
          <h1 style={{ fontFamily: SERIF, fontSize: '3rem', fontWeight: 500, color: CREAM, margin: 0, lineHeight: 1.05 }}>
            Stories from the community
          </h1>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '1.25rem', color: 'rgba(245,240,232,0.55)', marginTop: 14, marginBottom: 0 }}>
            Original writing, published by readers like you.
          </p>
          <div style={{ marginTop: 22 }}>
            <a
              href="/open-pages/new"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: PURPLE,
                color: CREAM,
                textDecoration: 'none',
                padding: '0.65rem 1.6rem',
                borderRadius: 9,
                fontWeight: 700,
                fontSize: '0.95rem',
                fontFamily: BODY_SERIF,
                boxShadow: '0 8px 28px rgba(107,47,173,0.32)',
              }}
            >
              <IconFeather size={16} /> Write a story
            </a>
          </div>
        </div>

        {/* Genre filter bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
            marginBottom: '2.5rem',
          }}
        >
          {FILTERS.map((g) => {
            const active = filter === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setFilter(g)}
                style={{
                  background: active ? PURPLE : 'rgba(245,240,232,0.04)',
                  color: active ? CREAM : 'rgba(245,240,232,0.6)',
                  border: `1px solid ${active ? PURPLE : 'rgba(245,240,232,0.12)'}`,
                  borderRadius: 999,
                  padding: '0.42rem 1.05rem',
                  fontFamily: CINZEL,
                  fontSize: '0.72rem',
                  letterSpacing: '0.08em',
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                }}
              >
                {g}
              </button>
            );
          })}
        </div>

        {/* States */}
        {error ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'rgba(245,240,232,0.55)', fontSize: '1.05rem' }}>
            We couldn’t load the feed just now. Please refresh to try again.
          </div>
        ) : loading ? (
          <SkeletonGrid />
        ) : posts.length === 0 ? (
          <EmptyState />
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'rgba(245,240,232,0.5)', fontFamily: SERIF, fontStyle: 'italic', fontSize: '1.3rem' }}>
            Nothing in {filter} yet.
          </div>
        ) : (
          <div style={cardGrid}>
            {visible.map((p) => (
              <PostCard key={p.id} post={p} counts={counts[p.id]} photo={authorPhotos[p.authorUid]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post card.
// ---------------------------------------------------------------------------

function PostCard({ post, counts, photo }) {
  const genre = normalizeGenre(post.genre);
  const likeCount = counts?.reactionCount ?? 0;
  const commentCount = counts?.commentCount ?? 0;
  const initial = (post.authorName || '?').trim().charAt(0).toUpperCase();

  // Real profile photo (28px circular) when present, else the gradient initial.
  const avatarEl = photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo}
      alt=""
      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block', border: '1px solid rgba(245,240,232,0.1)' }}
    />
  ) : (
    <span style={avatarDot}>{initial}</span>
  );

  // The whole card links to the post via a stretched overlay anchor (zIndex 1),
  // while the author name/handle is its own Link (zIndex 2) to /u/{handle} — this
  // keeps both clickable without nesting one anchor inside another.
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: SURFACE,
        border: '1px solid rgba(245,240,232,0.07)',
        borderRadius: 14,
        overflow: 'hidden',
        color: CREAM,
        transition: 'transform 0.18s, border-color 0.18s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.borderColor = 'rgba(201,168,76,0.35)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.borderColor = 'rgba(245,240,232,0.07)';
      }}
    >
      {/* Card-wide click target → post detail. */}
      <a
        href={`/open-pages/${post.id}`}
        aria-label={post.title}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      />

      {post.coverImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.coverImage}
          alt=""
          style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block', background: SURFACE_2 }}
        />
      ) : (
        <div style={{ width: '100%', aspectRatio: '16 / 9', background: `linear-gradient(135deg, ${SURFACE_2}, #0d0916)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconFeather size={30} style={{ color: 'rgba(201,168,76,0.25)' }} />
        </div>
      )}

      <div style={{ padding: '1.1rem 1.2rem 1.3rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <span style={genrePill}>{genre}</span>
          <span style={{ fontSize: '0.74rem', color: 'rgba(245,240,232,0.4)' }}>{timeAgo(post.createdAt)}</span>
        </div>

        <h2 style={{ fontFamily: SERIF, fontSize: '1.5rem', fontWeight: 600, color: CREAM, margin: '0 0 0.5rem', lineHeight: 1.2 }}>
          {post.title}
        </h2>

        <p style={{ margin: '0 0 1rem', fontSize: '0.98rem', lineHeight: 1.55, color: 'rgba(245,240,232,0.6)', flex: 1 }}>
          {excerpt(post.body)}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 'auto' }}>
          {post.authorHandle ? (
            <Link
              href={`/u/${post.authorHandle}`}
              style={{ position: 'relative', zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit' }}
            >
              {avatarEl}
              <span style={{ fontSize: '0.9rem', color: 'rgba(245,240,232,0.8)' }}>
                {post.authorName || 'Reader'}
                <span style={{ color: 'rgba(245,240,232,0.4)' }}> · @{post.authorHandle}</span>
              </span>
            </Link>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
              {avatarEl}
              <span style={{ fontSize: '0.9rem', color: 'rgba(245,240,232,0.8)' }}>{post.authorName || 'Reader'}</span>
            </span>
          )}

          {/* Engagement counts. */}
          <span style={countRow}>
            <span>♡ {likeCount}</span>
            <span>💬 {commentCount}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty + skeleton states.
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '4.5rem 1.5rem' }}>
      <div style={{ marginBottom: 18, opacity: 0.4 }}>
        <IconFeather size={40} style={{ color: GOLD, margin: '0 auto' }} />
      </div>
      <div style={{ fontFamily: SERIF, fontSize: '1.9rem', color: CREAM, marginBottom: 10 }}>
        No stories yet.
      </div>
      <p style={{ fontSize: '1.1rem', color: 'rgba(245,240,232,0.55)', marginBottom: '1.8rem' }}>
        Be the first to write.
      </p>
      <a
        href="/open-pages/new"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: PURPLE,
          color: CREAM,
          textDecoration: 'none',
          padding: '0.8rem 2.2rem',
          borderRadius: 9,
          fontWeight: 700,
          fontSize: '1rem',
          fontFamily: BODY_SERIF,
          boxShadow: '0 8px 28px rgba(107,47,173,0.35)',
        }}
      >
        <IconFeather size={16} /> Start writing
      </a>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div style={cardGrid} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ background: SURFACE, border: '1px solid rgba(245,240,232,0.06)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ width: '100%', aspectRatio: '16 / 9', background: 'rgba(245,240,232,0.05)' }} className="op-shimmer" />
          <div style={{ padding: '1.1rem 1.2rem 1.4rem' }}>
            <div style={{ width: 70, height: 18, borderRadius: 999, background: 'rgba(245,240,232,0.06)', marginBottom: 14 }} className="op-shimmer" />
            <div style={{ width: '85%', height: 22, borderRadius: 6, background: 'rgba(245,240,232,0.07)', marginBottom: 12 }} className="op-shimmer" />
            <div style={{ width: '100%', height: 13, borderRadius: 6, background: 'rgba(245,240,232,0.05)', marginBottom: 8 }} className="op-shimmer" />
            <div style={{ width: '60%', height: 13, borderRadius: 6, background: 'rgba(245,240,232,0.05)' }} className="op-shimmer" />
          </div>
        </div>
      ))}
      <style>{`
        .op-shimmer { position: relative; overflow: hidden; }
        .op-shimmer::after {
          content: ''; position: absolute; inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent, rgba(245,240,232,0.06), transparent);
          animation: opShimmer 1.4s infinite;
        }
        @keyframes opShimmer { 100% { transform: translateX(100%); } }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles + icon.
// ---------------------------------------------------------------------------

const cardGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: '1.5rem',
};

const genrePill = {
  fontFamily: CINZEL,
  fontSize: '0.62rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: GOLD,
  background: 'rgba(201,168,76,0.1)',
  border: '1px solid rgba(201,168,76,0.3)',
  borderRadius: 999,
  padding: '0.22rem 0.7rem',
};

const countRow = {
  marginLeft: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 12,
  fontFamily: CINZEL,
  fontSize: 12,
  color: 'rgba(245,240,232,0.45)',
  flexShrink: 0,
};

const avatarDot = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  background: `linear-gradient(135deg, ${PURPLE}, #3a1a63)`,
  color: CREAM,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.8rem',
  fontWeight: 700,
  flexShrink: 0,
  fontFamily: SERIF,
};

// Lucide "feather"
function IconFeather({ size = 18, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flexShrink: 0, ...style }}>
      <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
      <path d="M16 8 2 22" />
      <path d="M17.5 15H9" />
    </svg>
  );
}
