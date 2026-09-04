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
import { INDEX_INVITATION } from '../lib/openPagesCopy';
// R40 — the entry's opening comes from the SHARED prose predicate, not a character
// count. See the note at the top of that module for why it is a third adapter rather
// than a second excerpt rule.
import { openingOf, readingTime } from '../lib/openPagesOpening';
import { isEdited } from '../lib/openPages';
import { getBadge } from '../components/conversation/ConversationKit';

// Brand palette.
const INK = '#080610';
const SURFACE = '#120d1c';
const SURFACE_2 = '#1a1326';
const PURPLE = '#6b2fad';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const SERIF = "Cormorant Garamond, Georgia, serif";
const BODY_SERIF = "Cormorant Garamond, Georgia, serif";
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

const FILTERS = ['All', ...OPEN_PAGE_GENRES];

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

// ---------------------------------------------------------------------------

export default function OpenPagesFeed() {
  const [posts, setPosts] = useState(null); // null = loading, [] = loaded empty
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('All');
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

        // ⭑ THE COUNTS FETCH IS GONE WITH THE COUNTS. It was two extra reads PER POST —
        // comments/{id} and open_pages_reactions/{id} — for numbers the entry no longer
        // shows. Ikenna's ruling took the read count, the likes and the comment count off
        // the entry; leaving the reads behind would have been fourteen requests a load
        // for nothing. If a later round wants a count back, it costs those reads again
        // and should say so.

        // ⚠ IDENTITY RESOLVES AT RENDER. One read per unique author at users/{uid}.
        // The feed already did this for the avatar and threw the rest away, so the
        // stored authorName — a snapshot R38 measured as 24.4% stale across the
        // platform — was what a reader saw. It now keeps the whole record: the live
        // name, handle, avatar, island standing and house flag. Same number of reads.
        const uids = [...new Set(list.map((p) => p.authorUid).filter(Boolean))];
        const authorEntries = await Promise.all(
          uids.map(async (uid) => {
            try {
              const s = await get(ref(db, `users/${uid}`));
              return [uid, s.exists() ? s.val() : null];
            } catch {
              return [uid, null];
            }
          })
        );
        if (cancelled) return;
        setAuthorPhotos(Object.fromEntries(authorEntries));
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
          {/* ⭑ THE STANDFIRST IS THE FIRST LINE ONLY. R38 put both lines here; Ikenna's
              R40 ruling moves the second — the commissioning sentence — to the COMPOSER,
              where a writer is about to act. On the feed a reader browsing weekly would
              meet it until it turned into wallpaper, and an explanation that has become
              wallpaper is not an explanation. The promise stays; the explanation moved
              to where it does work. */}
          <p data-op-invitation style={{ fontFamily: BODY_SERIF, fontSize: '1.05rem', color: 'rgba(245,240,232,0.75)', marginTop: 18, marginBottom: 0, maxWidth: 620, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            {INDEX_INVITATION.line1}
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
          /* A COLUMN, not a grid. A contents page is read down. 720px is a touch wider
             than the composer's 660 measure because an entry carries a footer beside the
             words, not only the words. */
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {visible.map((p, i) => (
              <Entry key={p.id} post={p} author={authorPhotos[p.authorUid]} first={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post card.
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭑⭑ OPEN PAGES IS A JOURNAL AND THE FEED IS ITS CONTENTS PAGE.
// ═══════════════════════════════════════════════════════════════════════════════════
// Not a card list and not a social feed. That is also exactly what an EDITOR reads,
// which is why the surface argues R38's own case without saying anything: the road
// into the house looks like the thing a house reads.
//
// ⭑ NO CARDS. Entries sit on the ink ground, separated by a hairline. A card is a
// container for a summary; a contents page is a list of beginnings. A card also makes
// a feed look like software, and the whole argument here is that this is a journal.
//
// ⭑ EVERY ENTRY SHOWS THE WRITING — the piece's real opening lines, via the SHARED
// predicate (see app/lib/openPagesOpening.js). Nobody taps an unknown writer because
// of a thumbnail; they tap because of a sentence.
//
// ⭑ READING TIME IS IN, READ COUNT IS OUT. Ikenna's ruling. Reading time genuinely
// changes whether someone taps — "one minute" is an invitation and "nine minutes" is
// an honest warning. A read count on a young platform is a low number on every piece
// and so discourages the very tap it exists to encourage. The likes and comment counts
// went with it, for the same reason and because they made an entry look like a post.
//
// ⭑ THE PIECE'S OWN SHAPE SETS THE ENTRY'S SHAPE — verse keeps its line breaks against
// a gold rule, prose runs. Two treatments, not six.
//
// ⚠ IDENTITY RESOLVES AT RENDER. The stored authorName is a snapshot and R38 measured
// 24.4% of stored identity copies already stale, so the live users/{uid} read wins and
// the snapshot is only the fallback.

function Entry({ post, author, first }) {
  const genre = normalizeGenre(post.genre);
  const opening = openingOf(post.body);
  const mins = readingTime(post.body);

  // Live first, snapshot second. See the note above.
  const name = author?.displayName || post.authorName || 'Reader';
  const handle = author?.username || post.authorHandle || '';
  const avatar = author?.avatarUrl || author?.photoURL || null;
  const badge = getBadge(author?.readCount || 0);
  const isHouse = author?.isAuthor === true;
  const initial = (name || '?').trim().charAt(0).toUpperCase();

  return (
    <article
      data-op-entry
      data-op-kind={opening.kind}
      style={{
        position: 'relative',
        padding: first ? '0 0 34px' : '34px 0',
        borderTop: first ? 'none' : '1px solid rgba(245,240,232,0.08)',
      }}
    >
      {/* ⭑ A COVER IS A PLATE — a wide short band above the entry, the way a plate sits
          in a printed journal. ⚠ NEVER LOAD-BEARING: an entry without one is COMPLETE,
          not broken, which is why it is the only thing here that is conditional and why
          nothing below it changes when it is absent. Pieces with art get more presence,
          which is an honest reward for making it.
          ⚠ Measured 4 Sep 2026: all seven live pieces happen to carry a cover, so the
          no-cover path has no live example and is held by a test instead. */}
      {post.coverImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-op-plate
          src={post.coverImage}
          alt=""
          loading="lazy"
          /* 4:1, and the ratio is the whole argument. Measured on the painted page at
             720px: an entry's TEXT — kicker, title, opening, footer — is about 160px
             tall. At 3:1 the plate was 240px, half again taller than the writing it
             was supposed to introduce, and a feed whose premise is "every entry shows
             the writing" was mostly photographs. At 4:1 it is 180px: still a band with
             real presence, no longer outweighing the words. A plate in a printed
             journal is short and wide, which is the shape being borrowed. */
          style={{ width: '100%', aspectRatio: '4 / 1', objectFit: 'cover', display: 'block', marginBottom: 22, background: 'rgba(245,240,232,0.04)' }}
        />
      ) : null}

      <Link href={`/open-pages/${post.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <span style={{ fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, display: 'block', marginBottom: 10 }}>
          {genre}
        </span>

        <h2 style={{ fontFamily: SERIF, fontSize: '1.95rem', fontWeight: 600, color: CREAM, margin: '0 0 12px', lineHeight: 1.15 }}>
          {post.title}
        </h2>

        {opening.kind === 'verse' ? (
          /* A stanza, kept as a stanza. The gold rule is what tells a reader at a
             glance that this one is a poem — before they have read a word of it. */
          <div
            data-op-verse
            style={{
              borderLeft: `1px solid ${GOLD}`,
              paddingLeft: 18,
              margin: '0 0 4px',
              fontFamily: BODY_SERIF,
              fontSize: '1.08rem',
              lineHeight: 1.7,
              color: 'rgba(245,240,232,0.72)',
              whiteSpace: 'pre-line',
            }}
          >
            {opening.lines.join('\n')}
          </div>
        ) : (
          <p
            data-op-prose
            style={{ margin: 0, fontFamily: BODY_SERIF, fontSize: '1.08rem', lineHeight: 1.7, color: 'rgba(245,240,232,0.72)' }}
          >
            {opening.lines[0] || ''}
          </p>
        )}
      </Link>

      {/* The quiet footer: who wrote it, their standing on the island, and how long it
          will take. The writer's name is its own link — the entry's click target is the
          piece, and a profile link inside it must not be swallowed by that. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        {handle ? (
          <Link href={`/u/${handle}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit' }}>
            <Avatar src={avatar} initial={initial} />
            <span style={{ fontFamily: BODY_SERIF, fontSize: '0.95rem', color: 'rgba(245,240,232,0.7)' }}>{name}</span>
          </Link>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
            <Avatar src={avatar} initial={initial} />
            <span style={{ fontFamily: BODY_SERIF, fontSize: '0.95rem', color: 'rgba(245,240,232,0.7)' }}>{name}</span>
          </span>
        )}

        {isHouse || badge ? (
          <span
            data-op-badge
            style={{ fontFamily: CINZEL, fontSize: 8.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: isHouse ? '#a78bfa' : badge.color, border: `1px solid ${isHouse ? 'rgba(167,139,250,0.4)' : badge.color}55`, borderRadius: 999, padding: '2px 8px' }}
          >
            {isHouse ? 'Calvary' : badge.label}
          </span>
        ) : null}

        <span style={{ color: 'rgba(245,240,232,0.28)' }}>·</span>

        <span style={{ fontFamily: CINZEL, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.45)' }}>
          {mins} min read
        </span>

        {/* R36's edit mark, quietly at the right. It reads updatedAt and nothing else —
            an admin APPROVAL is not an author edit, which is what the > createdAt
            guard inside isEdited() is for. */}
        {isEdited(post) ? (
          <span
            data-op-edited
            style={{ marginLeft: 'auto', fontFamily: BODY_SERIF, fontStyle: 'italic', fontSize: '0.82rem', color: 'rgba(245,240,232,0.35)' }}
          >
            edited
          </span>
        ) : null}
      </div>
    </article>
  );
}

function Avatar({ src, initial }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
  ) : (
    <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(107,47,173,0.28)', border: '1px solid rgba(107,47,173,0.45)', display: 'grid', placeItems: 'center', fontFamily: SERIF, fontSize: '0.8rem', color: '#c4b5fd' }}>
      {initial}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty + skeleton states.
// ---------------------------------------------------------------------------

// ⚠ THE FEED MUST SURVIVE BEING NEARLY EMPTY, and this is where that is decided.
//
//   AT SEVEN — a contents page: seven entries down a 720px column, hairline-separated,
//              each showing its own opening. That is a journal, and it is what ships.
//   AT ONE   — one entry, the standfirst above it, and nothing else. Deliberately NOT
//              padded out with skeletons, "coming soon" tiles or a recommended-reading
//              rail: a journal with one piece in it is a journal with one piece in it,
//              and pretending otherwise is the thing a reader notices.
//   AT NONE  — this. And it is the one that matters, because an empty writing platform
//              is worse than no writing platform: it tells a visitor nobody is here.
//
// So the empty state does NOT apologise and does not say "no stories yet" — a sentence
// whose whole content is an absence. It makes the absence the offer. "Yours would be
// the first" is true, is specific, and is the only moment on the island where being
// early is worth something.
//
// ⚠ IT STILL PROMISES ATTENTION, NOT OUTCOME. "We read everything published here" is a
// commitment that survives the platform being empty; anything about commissioning would
// be a lottery ticket sold to someone who can see the room is empty.
function EmptyState() {
  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '4rem 1.5rem 5rem', textAlign: 'center' }}>
      <span aria-hidden="true" style={{ display: 'block', fontFamily: SERIF, fontSize: 22, color: GOLD, marginBottom: 22 }}>
        {'\u2766\uFE0E'}
      </span>
      <h2 style={{ fontFamily: SERIF, fontSize: '2.1rem', fontWeight: 500, color: CREAM, margin: '0 0 12px', lineHeight: 1.2 }}>
        Nothing has been published here yet.
      </h2>
      <p style={{ fontFamily: BODY_SERIF, fontSize: '1.1rem', lineHeight: 1.65, color: 'rgba(245,240,232,0.6)', margin: '0 0 30px' }}>
        Yours would be the first. We read everything published here.
      </p>
      <Link
        href="/open-pages/new"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          border: `1px solid ${GOLD}`, borderRadius: 999, padding: '11px 26px',
          color: GOLD, textDecoration: 'none',
          fontFamily: CINZEL, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
        }}
      >
        Write the first piece
      </Link>
    </div>
  );
}

// The skeleton is a COLUMN of entries now, not a grid of cards — a loading state that
// resolves into a different shape is a flash of the wrong design.
function SkeletonGrid() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }} aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ padding: i === 0 ? '0 0 34px' : '34px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(245,240,232,0.08)' }}>
          <div style={{ width: 62, height: 10, borderRadius: 999, background: 'rgba(245,240,232,0.06)', marginBottom: 14 }} className="op-shimmer" />
          <div style={{ width: '70%', height: 26, borderRadius: 6, background: 'rgba(245,240,232,0.07)', marginBottom: 14 }} className="op-shimmer" />
          <div style={{ width: '100%', height: 13, borderRadius: 6, background: 'rgba(245,240,232,0.05)', marginBottom: 8 }} className="op-shimmer" />
          <div style={{ width: '82%', height: 13, borderRadius: 6, background: 'rgba(245,240,232,0.05)', marginBottom: 20 }} className="op-shimmer" />
          <div style={{ width: 160, height: 12, borderRadius: 6, background: 'rgba(245,240,232,0.04)' }} className="op-shimmer" />
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
        @media (prefers-reduced-motion: reduce) { .op-shimmer::after { animation: none; } }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles + icon.
// ---------------------------------------------------------------------------

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
