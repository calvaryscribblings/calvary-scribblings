'use client';
import { useState, useEffect, useRef } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import Navbar from '../components/Navbar';
import { RARITY_STYLES, pickHighestBadge } from '../lib/badges';
import { getDeletedUidSet } from '../lib/userVisibility';

const BADGE_LADDER = [
  { tier: 'reader',   label: 'Reader',                 color: '#b4b2a9', threshold: 25,   description: "You've begun. The page is turning." },
  { tier: 'island',   label: 'Island Reader',          color: '#1d9e75', threshold: 60,   description: "You've found your place among the stories." },
  { tier: 'islander', label: 'Story Islander',         color: '#d4941a', threshold: 90,   description: "The island knows your name." },
  { tier: 'legend',   label: 'Legend of the Island',   color: '#d4537e', threshold: 150,  description: "Your reading has become a kind of devotion." },
  { tier: 'immortal', label: 'Immortal of the Island', color: '#9b6dff', threshold: 1000, description: "Some readers leave a mark that outlasts them." },
];

function getBadge(readCount) {
  if (readCount >= 1000) return { tier: 'immortal', label: 'Immortal of the Island', color: '#9b6dff' };
  if (readCount >= 150) return { tier: 'legend', label: 'Legend of the Island', color: '#d4537e' };
  if (readCount >= 90) return { tier: 'islander', label: 'Story Islander', color: '#d4941a' };
  if (readCount >= 60) return { tier: 'island', label: 'Island Reader', color: '#1d9e75' };
  if (readCount >= 25) return { tier: 'reader', label: 'Reader', color: '#b4b2a9' };
  return null;
}

function BadgeLadderTooltip({ anchorRef, currentTier, onClose }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const calc = () => {
      if (!anchorRef.current) return;
      const a = anchorRef.current.getBoundingClientRect();
      const tw = 290;
      const th = 380;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = a.bottom + 10;
      let arrowSide = 'top';
      if (top + th > vh - 8) {
        top = a.top - th - 10;
        arrowSide = 'bottom';
      }
      let left = a.left + a.width / 2 - tw / 2;
      if (left < 8) left = 8;
      if (left + tw > vw - 8) left = vw - tw - 8;
      const arrowLeft = a.left + a.width / 2 - left;
      setPos({ top, left, arrowSide, arrowLeft });
    };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    return () => {
      window.removeEventListener('resize', calc);
      window.removeEventListener('scroll', calc, true);
    };
  }, [anchorRef]);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'transparent' }} />
      <div
        onMouseLeave={onClose}
        style={{
          position: 'fixed',
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width: 290,
          minWidth: 260,
          maxWidth: 320,
          background: '#0f0f0f',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: '1rem',
          zIndex: 1000,
          opacity: pos ? 1 : 0,
          transform: pos ? 'translateY(0)' : 'translateY(4px)',
          transition: 'opacity 0.15s ease, transform 0.15s ease',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}
      >
        {pos && (
          <div style={{
            position: 'absolute',
            left: pos.arrowLeft - 6,
            ...(pos.arrowSide === 'top'
              ? { top: -6, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '6px solid #0f0f0f' }
              : { bottom: -6, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '6px solid #0f0f0f' }),
          }} />
        )}
        <div style={{ fontSize: '0.6rem', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.35)', fontFamily: 'Cinzel, Inter, sans-serif', marginBottom: '0.75rem', textTransform: 'uppercase' }}>BADGE LADDER</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {BADGE_LADDER.map(b => {
            const isCurrent = b.tier === currentTier;
            return (
              <div key={b.tier} style={{ paddingLeft: isCurrent ? '0.55rem' : 0, borderLeft: isCurrent ? `2px solid ${b.color}` : '2px solid transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                  <div style={{ fontSize: '0.85rem', color: isCurrent ? '#fff' : '#e8e0d4', fontFamily: 'Cochin, Georgia, serif' }}>{b.label}</div>
                  <div style={{ fontSize: '0.72rem', color: isCurrent ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)', fontFamily: 'Inter, sans-serif', marginLeft: 'auto' }}>{b.threshold.toLocaleString()} reads</div>
                </div>
                <div style={{ marginTop: '0.25rem', marginLeft: '1.1rem', fontSize: '0.78rem', color: isCurrent ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.6)', fontFamily: 'Georgia, serif', fontStyle: 'italic', lineHeight: 1.4 }}>{b.description}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState(null);
  const [showBadgeLadder, setShowBadgeLadder] = useState(false);
  const [badgeTier, setBadgeTier] = useState(null);
  const badgeAnchorRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const snap = await get(ref(db, 'leaderboard'));
        if (!snap.exists()) { setRows([]); return; }
        const all = Object.entries(snap.val())
          .filter(([, u]) => u.leaderboardVisible !== false)
          .map(([uid, u]) => ({
            uid,
            displayName: u.displayName || 'Reader',
            username:    u.username || null,
            avatarUrl:   u.avatarUrl || null,
            readerScore: u.readerScore ?? 0,
            joinDate:    u.joinDate ?? Infinity,
          }))
          .sort((a, b) => (b.readerScore - a.readerScore) || (a.joinDate - b.joinDate));

        // Filter out soft-deleted users before slicing — otherwise a deleted
        // user could occupy a top-50 slot and we'd show 49 rows.
        const deletedSet = await getDeletedUidSet(all.map(r => r.uid));
        const visible = all.filter(r => !deletedSet.has(r.uid)).slice(0, 50);

        const withBadges = await Promise.all(visible.map(async row => {
          try {
            const [bSnap, rcSnap] = await Promise.all([
              get(ref(db, `userBadges/${row.uid}`)),
              get(ref(db, `users/${row.uid}/readCount`)),
            ]);
            return {
              ...row,
              highestBadge: pickHighestBadge(bSnap.exists() ? bSnap.val() : null),
              readCount: rcSnap.exists() ? (rcSnap.val() || 0) : 0,
            };
          } catch {
            return { ...row, highestBadge: null, readCount: 0 };
          }
        }));

        setRows(withBadges);
      } catch (e) {
        console.error('[leaderboard] load failed:', e);
        setRows([]);
      }
    })();
  }, []);

  const tintFor = rank =>
    rank === 1 ? { borderColor: 'rgba(212,164,55,0.35)', background: 'rgba(212,164,55,0.05)' } :
    rank === 2 ? { borderColor: 'rgba(192,192,200,0.30)', background: 'rgba(192,192,200,0.04)' } :
    rank === 3 ? { borderColor: 'rgba(169,113,66,0.30)', background: 'rgba(169,113,66,0.05)' } :
                 { borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' };

  const rankColor = rank =>
    rank === 1 ? '#d4a437' :
    rank === 2 ? '#c0c0c8' :
    rank === 3 ? '#a97142' : 'rgba(255,255,255,0.4)';

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#0a0a0a', paddingTop: 68 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '2.5rem 4%' }}>

          <div style={{ marginBottom: '0.5rem' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', margin: '0 0 0.4rem' }}>Leaderboard</h1>
            <p style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.45)', margin: 0 }}>
              Top 50 readers, ranked by Reader Score — earned through quiz tiers, stories read, and reading streak.
            </p>
          </div>

          <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', margin: '0 0 1.75rem' }}>
            Don't want to be listed?{' '}
            <a href="/profile" style={{ color: '#a78bfa', textDecoration: 'underline' }}>
              Manage visibility in your account settings
            </a>.
          </p>

          {rows === null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ height: 56, borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.88rem', textAlign: 'center', paddingTop: '3rem' }}>
              Leaderboard fills as readers earn their first scores.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {rows.map((row, i) => {
                const rank = i + 1;
                const tint = tintFor(rank);
                const initials = row.displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

                return (
                  <a key={row.uid} href={`/user?id=${row.uid}`} style={{
                    display: 'flex', alignItems: 'center', gap: '0.85rem',
                    textDecoration: 'none', padding: '0.7rem 0.85rem',
                    borderRadius: 10,
                    border: `1px solid ${tint.borderColor}`,
                    background: tint.background,
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = tint.borderColor; }}>

                    <div style={{
                      flexShrink: 0, width: 32, textAlign: 'center',
                      fontFamily: 'Cochin, Georgia, serif',
                      fontSize: rank <= 3 ? '1.4rem' : '1.05rem',
                      color: rankColor(rank),
                      fontWeight: rank <= 3 ? 700 : 500,
                    }}>{rank}</div>

                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.22)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0,
                      fontFamily: 'Cochin, Georgia, serif',
                    }}>
                      {row.avatarUrl
                        ? <img src={row.avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : initials}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.88rem', fontWeight: 600, color: '#fff',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{row.displayName}</div>
                      {(() => {
                        const badge = getBadge(row.readCount || 0);
                        if (!row.username && !badge) return null;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {row.username && (
                              <span style={{ fontSize: '0.66rem', color: 'rgba(167,139,250,0.5)' }}>@{row.username}</span>
                            )}
                            {badge && (
                              <span
                                onClick={e => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  badgeAnchorRef.current = e.currentTarget;
                                  setBadgeTier(badge.tier);
                                  setShowBadgeLadder(true);
                                }}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  cursor: 'pointer', position: 'relative',
                                }}
                              >
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: badge.color, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.65rem', fontFamily: 'Inter, sans-serif', color: 'rgba(255,255,255,0.75)' }}>{badge.label}</span>
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {row.highestBadge && (
                      <div title={`${row.highestBadge.name} — ${row.highestBadge.description}`} style={{
                        flexShrink: 0,
                        padding: '0.3rem 0.5rem', borderRadius: 8,
                        ...RARITY_STYLES[row.highestBadge.rarity],
                        fontSize: '0.95rem', lineHeight: 1,
                      }}>
                        {row.highestBadge.icon}
                      </div>
                    )}

                    <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 60 }}>
                      <div style={{
                        fontFamily: 'Cochin, Georgia, serif',
                        fontSize: '1.25rem', color: '#a78bfa', lineHeight: 1,
                      }}>{row.readerScore.toLocaleString()}</div>
                      <div style={{
                        fontSize: '0.55rem', color: 'rgba(167,139,250,0.4)',
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                        fontFamily: 'Inter, sans-serif', marginTop: 2,
                      }}>Score</div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {showBadgeLadder && (
        <BadgeLadderTooltip
          anchorRef={badgeAnchorRef}
          currentTier={badgeTier}
          onClose={() => setShowBadgeLadder(false)}
        />
      )}
    </>
  );
}
