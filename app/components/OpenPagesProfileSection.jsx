'use client';

// Open Pages — profile integration (Stage 7).
//
// Self-contained section shown on BOTH profile surfaces:
//   • app/profile/page.js  — the owner viewing their own profile (isOwner=true)
//   • app/user/page.js     — anyone viewing another writer (isOwner=false)
//     (note: /user redirects an owner to /profile, so the owner-only eligibility
//      panel below is correctly reached only via /profile)
//
// Given a profileUid it reads everything it needs itself (open_pages, followers,
// comments) so neither host page has to thread data in. It renders:
//   1. Publication history — the writer's live posts (everyone)
//   2. Pocket eligibility progress — the four real thresholds (owner only)
//   3. Subscribe · Support — UI only; active styling iff the writer is Pocket Ready
//
// Pocket earnings are DORMANT until the payment system launches — this surface
// shows status only, no money moves.

import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { normalizeGenre } from '../lib/openPages';

// Brand palette.
const GOLD = '#c9a84c';
const PURPLE = '#6b2fad';
const CREAM = '#f5f0e8';
const SERIF = "'Cormorant Garamond', 'Cochin', Georgia, serif";
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

// Pocket thresholds (all four must be met simultaneously).
const TARGETS = { weeks: 8, followers: 100, comments: 200, stories: 10 };

const WEEK_MS = 7 * 86400000;

// Consecutive 7-day windows counting back from now, each needing >= 2 posts.
// Stops at the first window that falls short ("resets on a missed week").
function consecutiveWeeks(timestamps) {
  if (!timestamps || !timestamps.length) return 0;
  const now = Date.now();
  let weeks = 0;
  for (let i = 0; i < 60; i++) {
    const end = now - i * WEEK_MS;
    const start = end - WEEK_MS;
    const count = timestamps.filter((t) => t > start && t <= end).length;
    if (count >= 2) weeks++;
    else break;
  }
  return weeks;
}

function fmtDate(ts) {
  if (!ts || typeof ts !== 'number') return '';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function OpenPagesProfileSection({ profileUid, isOwner = false, profileName = 'this writer' }) {
  const [data, setData] = useState(null); // { posts, followers, received }

  useEffect(() => {
    if (!profileUid) return;
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const [opSnap, followersSnap, commentsSnap] = await Promise.all([
          get(ref(db, 'open_pages')),
          get(ref(db, `followers/${profileUid}`)),
          get(ref(db, 'comments')),
        ]);

        const posts = opSnap.exists()
          ? Object.entries(opSnap.val())
              .map(([id, p]) => ({ id, ...p }))
              .filter((p) => p && p.status === 'live' && p.authorUid === profileUid && p.title)
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          : [];

        const followers = followersSnap.exists() ? Object.keys(followersSnap.val()).length : 0;

        // Received comments: comments on THIS author's open_pages posts, written
        // by someone else (excludes self-comments).
        const postIds = new Set(posts.map((p) => p.id));
        let received = 0;
        if (commentsSnap.exists()) {
          for (const [pid, thread] of Object.entries(commentsSnap.val())) {
            if (!postIds.has(pid) || !thread || typeof thread !== 'object') continue;
            for (const c of Object.values(thread)) {
              if (c && c.authorUid && c.authorUid !== profileUid) received++;
            }
          }
        }

        if (!cancelled) setData({ posts, followers, received });
      } catch (e) {
        console.error('[open-pages] profile section error:', e);
        if (!cancelled) setData({ posts: [], followers: 0, received: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [profileUid]);

  // Loading — keep it quiet (subtle placeholder), never a jarring spinner.
  if (data === null) {
    return (
      <section style={wrap}>
        <Kicker />
        <div style={{ height: 54, borderRadius: 10, background: 'rgba(245,240,232,0.03)' }} />
      </section>
    );
  }

  const { posts, followers, received } = data;
  const weeks = consecutiveWeeks(posts.map((p) => p.createdAt).filter(Boolean));
  const stories = posts.length;

  const metrics = [
    { key: 'weeks', label: 'Consecutive weeks', detail: '2+ posts per week — resets on a missed week', value: weeks, target: TARGETS.weeks, unit: 'weeks' },
    { key: 'followers', label: 'Verified followers', detail: 'readers following you', value: followers, target: TARGETS.followers, unit: 'followers' },
    { key: 'comments', label: 'Received comments', detail: 'from others, excluding your own', value: received, target: TARGETS.comments, unit: 'comments' },
    { key: 'stories', label: 'Published stories', detail: 'cleared by moderation', value: stories, target: TARGETS.stories, unit: 'stories' },
  ];
  const pocketReady = metrics.every((m) => m.value >= m.target);

  return (
    <section style={wrap}>
      <Kicker />

      {/* 1 — Publication history (everyone) */}
      <div style={{ marginBottom: '1.6rem' }}>
        <div style={subhead}>Publication history</div>
        {posts.length === 0 ? (
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '1.05rem', color: 'rgba(245,240,232,0.4)', padding: '0.4rem 0' }}>
            No stories published yet.
          </div>
        ) : (
          <div>
            {posts.map((p) => (
              <div key={p.id} style={postRow}>
                <a href={`/open-pages/${p.id}`} style={postLink}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: SERIF, fontSize: '1.1rem', color: CREAM, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title}
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'rgba(245,240,232,0.3)', fontFamily: 'Inter, sans-serif', marginTop: 3 }}>
                      {fmtDate(p.createdAt)}
                    </div>
                  </div>
                  <span style={genrePill}>{normalizeGenre(p.genre)}</span>
                </a>
                {isOwner && (
                  <a href={`/open-pages/edit/${p.id}`} style={editLink}
                    onMouseEnter={(e) => { e.currentTarget.style.color = GOLD; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(245,240,232,0.5)'; }}
                  >
                    Edit
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2 — Pocket eligibility (owner only) */}
      {isOwner && (
        <div style={{ marginBottom: '1.4rem' }}>
          <div style={subhead}>Pocket eligibility</div>
          {pocketReady ? (
            <div style={{ border: `1px solid ${GOLD}`, background: 'rgba(201,168,76,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(201,168,76,0.16)', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 999, padding: '0.25rem 0.8rem', fontFamily: CINZEL, fontSize: '0.66rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  ✦ Pocket Ready
                </span>
              </div>
              <p style={{ margin: 0, fontFamily: SERIF, fontSize: '1.05rem', lineHeight: 1.6, color: 'rgba(245,240,232,0.72)' }}>
                You’ve met all four thresholds. Reader subscriptions are a free,
                patronage-style way for readers to back your work — they unlock
                once the platform’s payment system launches. Nothing to do yet;
                your status is held.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.95rem' }}>
              <p style={{ margin: '0 0 0.2rem', fontSize: '0.82rem', color: 'rgba(245,240,232,0.4)', fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
                Meet all four to unlock Pocket. Progress updates as you publish —
                no rush, no deadline.
              </p>
              {metrics.map((m) => {
                const shown = Math.min(m.value, m.target);
                const pct = m.target > 0 ? Math.min(100, Math.round((m.value / m.target) * 100)) : 0;
                const met = m.value >= m.target;
                return (
                  <div key={m.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontFamily: SERIF, fontSize: '1.05rem', color: met ? GOLD : CREAM }}>{m.label}</span>
                        <span style={{ fontSize: '0.72rem', color: 'rgba(245,240,232,0.32)', fontFamily: 'Inter, sans-serif', marginLeft: 8 }}>{m.detail}</span>
                      </div>
                      <span style={{ flexShrink: 0, fontFamily: CINZEL, fontSize: '0.72rem', letterSpacing: '0.04em', color: met ? GOLD : 'rgba(245,240,232,0.5)', whiteSpace: 'nowrap' }}>
                        {shown} / {m.target} {m.unit}
                      </span>
                    </div>
                    <div style={{ height: 5, borderRadius: 999, background: 'rgba(245,240,232,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: met ? GOLD : PURPLE, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3 — Subscribe · Support (everyone, UI only) */}
      <div>
        <button
          type="button"
          onClick={() => {}}
          disabled={!pocketReady}
          title={pocketReady ? 'Subscriptions open when payments launch' : 'Coming soon'}
          style={{
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            background: pocketReady ? PURPLE : 'rgba(245,240,232,0.05)',
            color: pocketReady ? CREAM : 'rgba(245,240,232,0.4)',
            border: pocketReady ? 'none' : '1px solid rgba(245,240,232,0.1)',
            borderRadius: 10,
            padding: '0.85rem 1.5rem',
            fontWeight: 700,
            fontSize: '0.98rem',
            fontFamily: SERIF,
            cursor: pocketReady ? 'pointer' : 'not-allowed',
            boxShadow: pocketReady ? '0 8px 26px rgba(107,47,173,0.32)' : 'none',
          }}
        >
          ♥ Subscribe · Support
        </button>
        <div style={{ textAlign: 'center', fontSize: '0.74rem', color: 'rgba(245,240,232,0.32)', fontFamily: 'Inter, sans-serif', marginTop: 9 }}>
          {pocketReady
            ? `${profileName} is Pocket Ready — subscriptions open when payments launch.`
            : 'Reader subscriptions are coming soon.'}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Kicker() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.2rem', paddingBottom: '0.7rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontFamily: CINZEL, fontSize: '0.6rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: GOLD }}>The Forum</span>
      <span style={{ fontFamily: SERIF, fontSize: '1.18rem', color: CREAM }}>Open Pages</span>
    </div>
  );
}

const wrap = { marginBottom: '2.2rem' };

const subhead = {
  fontFamily: 'Inter, sans-serif',
  fontSize: '0.56rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: 'rgba(245,240,232,0.34)',
  marginBottom: '0.7rem',
};

const postRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0.7rem 0',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const postLink = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flex: 1,
  minWidth: 0,
  textDecoration: 'none',
  transition: 'opacity 0.2s',
};

const editLink = {
  flexShrink: 0,
  fontFamily: CINZEL,
  fontSize: '0.6rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(245,240,232,0.5)',
  textDecoration: 'none',
  border: '1px solid rgba(245,240,232,0.16)',
  borderRadius: 999,
  padding: '0.28rem 0.7rem',
  transition: 'color 0.2s',
};

const genrePill = {
  flexShrink: 0,
  fontFamily: CINZEL,
  fontSize: '0.56rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: GOLD,
  background: 'rgba(201,168,76,0.1)',
  border: '1px solid rgba(201,168,76,0.3)',
  borderRadius: 999,
  padding: '0.2rem 0.6rem',
};
