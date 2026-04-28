'use client';
import { useState, useEffect } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import Navbar from '../components/Navbar';
import { RARITY_STYLES, pickHighestBadge } from '../lib/badges';

export default function LeaderboardPage() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const snap = await get(ref(db, 'users'));
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
          .sort((a, b) => (b.readerScore - a.readerScore) || (a.joinDate - b.joinDate))
          .slice(0, 50);

        const withBadges = await Promise.all(all.map(async row => {
          try {
            const bSnap = await get(ref(db, `userBadges/${row.uid}`));
            return { ...row, highestBadge: pickHighestBadge(bSnap.exists() ? bSnap.val() : null) };
          } catch {
            return { ...row, highestBadge: null };
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
              Top 50 readers, ranked by Reader Score.
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
                      {row.username && (
                        <div style={{ fontSize: '0.66rem', color: 'rgba(167,139,250,0.5)' }}>@{row.username}</div>
                      )}
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
    </>
  );
}
