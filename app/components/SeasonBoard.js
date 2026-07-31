'use client';

// Contest leaderboard — one component, every board.
//
// Takes a config object from app/lib/leaderboards.js as `board` and renders the
// whole surface from it: window, prize table, copy, provisional line. A weekly
// board is a new config entry plus a route file; nothing here changes.
//
// RANKING
//
//   delta = live points/{uid}/total − snapshot[uid].points   (absent ⇒ 0)
//
// Only delta > 0 is shown. Ranks are dense-competition style: equal deltas share
// a rank and the next distinct delta skips (1, 2, 2, 4). Within a tie the order
// is by joinDate ascending — the same tiebreak the all-time board uses — so the
// display is stable across loads even though the shared rank number is equal.
//
// READS  (the budget this page is held to)
//
//   1  leaderboards/{boardId}          snapshot + startedAt (+ final once R2 lands)
//   1  leaderboard                     the public display map — names, avatars, opt-out
//   N  points/{uid}/total              one per candidate uid, concurrency-capped
//   ~  users/{uid}                     ONLY for shown rows missing from the display map
//   ~  users/{uid}/isDeleted           ONLY for shown rows, via getDeletedUidSet (cached)
//
// The two tails are bounded by rows that actually render, not by the universe,
// because the delta > 0 filter runs before them. Once the board is closed and
// `final` exists, the N totals reads disappear entirely — a closed board is two
// reads, forever.
//
// UID UNIVERSE
//
// snapshot keys ∪ leaderboard map keys ∪ the signed-in reader's own uid.
//
// The snapshot holds every account that existed at capture time, so the union
// only has to discover accounts created after it. Those surface through the
// leaderboard map, which app/lib/badgeEngine.js writes whenever it runs — which
// is on any streak change, i.e. the first story a new reader finishes.
//
// BLIND SPOT, stated: a reader who signed up after the opening capture AND has
// earned points without badgeEngine ever writing their leaderboard entry is
// invisible to the union and will not appear. In practice their next completed
// read writes the entry and they appear on the following load. Adding their own
// uid to the union means a signed-in reader always sees their own standing even
// while they are in that gap. The certified result is the R2 recompute, which
// walks quiz_submissions and comments directly and has no such gap.

import { useState, useEffect, useRef, useMemo } from 'react';
import { ref, get } from 'firebase/database';
import { db, auth } from '../lib/firebaseCore';
import { getDeletedUidSet } from '../lib/userVisibility';
import { prizePool, prizeForPlace, prizeBands, ordinal } from '../lib/leaderboards';
import Navbar from './Navbar';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL   = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

// Cap on simultaneous in-flight reads. The SDK multiplexes over one socket, but
// firing 265 gets in a single tick still builds a burst; 24 keeps it smooth
// without materially changing wall-clock.
const READ_CONCURRENCY = 24;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function money(amount, currency) {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount}`;
  }
}

function initialsOf(name) {
  return String(name || 'Reader').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// Dense-competition ranks over a delta-sorted list.
function withRanks(rows) {
  let lastDelta = null;
  let lastRank = 0;
  return rows.map((r, i) => {
    const rank = r.delta === lastDelta ? lastRank : i + 1;
    lastDelta = r.delta;
    lastRank = rank;
    return { ...r, rank };
  });
}

const rankColor = (r) =>
  r === 1 ? '#d4a437' : r === 2 ? '#c0c0c8' : r === 3 ? '#a97142' : 'rgba(255,255,255,0.4)';

const tintFor = (r) =>
  r === 1 ? { borderColor: 'rgba(212,164,55,0.35)', background: 'rgba(212,164,55,0.05)' } :
  r === 2 ? { borderColor: 'rgba(192,192,200,0.30)', background: 'rgba(192,192,200,0.04)' } :
  r === 3 ? { borderColor: 'rgba(169,113,66,0.30)', background: 'rgba(169,113,66,0.05)' } :
            { borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' };

export default function SeasonBoard({ board }) {
  const [uid, setUid]         = useState(null);
  const [authReady, setReady] = useState(false);
  const [state, setState]     = useState({ phase: 'loading', rows: [], hasSnapshot: false, closed: false });
  const [meVisible, setMeVisible] = useState(true);

  const meRowRef = useRef(null);

  // Auth first — the reader's own uid joins the discovery union, so the load
  // waits for it rather than racing and missing their row on first paint.
  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => { setUid(u?.uid ?? null); setReady(true); });
    return () => off();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;

    (async () => {
      try {
        const now = Date.now();

        const [boardSnap, mapSnap] = await Promise.all([
          get(ref(db, `leaderboards/${board.boardId}`)),
          get(ref(db, 'leaderboard')),
        ]);

        const boardData = boardSnap.exists() ? boardSnap.val() : null;
        const snapshot  = boardData?.snapshot ?? null;
        const final     = boardData?.final ?? null;
        const display   = mapSnap.exists() ? mapSnap.val() : {};

        const hasSnapshot = !!snapshot && Object.keys(snapshot).length > 0;
        const closed = now > board.endsAt;

        // Before the gun, or with no baseline captured yet, there is nothing
        // honest to rank. Show the waiting state rather than a board of deltas
        // measured against a baseline that does not exist.
        if (now < board.startsAt || !hasSnapshot) {
          if (!cancelled) {
            setState({
              phase: now < board.startsAt ? 'pre' : 'awaiting-snapshot',
              rows: [], hasSnapshot, closed: false,
            });
          }
          return;
        }

        const union = new Set([...Object.keys(snapshot), ...Object.keys(display)]);
        if (uid) union.add(uid);
        const candidates = [...union];

        // A closed board with a closing capture needs no live reads at all.
        const useFinal = closed && final && Object.keys(final).length > 0;

        const totals = useFinal
          ? candidates.map(u => final[u]?.points ?? null)
          : await mapLimit(candidates, READ_CONCURRENCY, async (u) => {
              try {
                const s = await get(ref(db, `points/${u}/total`));
                return s.exists() ? s.val() : null;
              } catch {
                return null;
              }
            });

        let rows = candidates.map((u, i) => {
          const live = typeof totals[i] === 'number' ? totals[i] : 0;
          const base = typeof snapshot[u]?.points === 'number' ? snapshot[u].points : 0;
          const d = display[u] || {};
          return {
            uid: u,
            delta: live - base,
            displayName: d.displayName || null,
            username:    d.username || null,
            avatarUrl:   d.avatarUrl || null,
            joinDate:    typeof d.joinDate === 'number' ? d.joinDate : Infinity,
            optedOut:    d.leaderboardVisible === false,
          };
        })
          // delta > 0 first — every read that follows is proportional to what
          // renders, not to the universe.
          .filter(r => r.delta > 0)
          .filter(r => !r.optedOut);

        // Display-data tail: only for rows that survived, and only those the
        // public display map did not already cover.
        const needsName = rows.filter(r => !r.displayName).map(r => r.uid);
        if (needsName.length) {
          const fetched = await mapLimit(needsName, READ_CONCURRENCY, async (u) => {
            try {
              const s = await get(ref(db, `users/${u}`));
              return s.exists() ? s.val() : null;
            } catch {
              return null;
            }
          });
          const byUid = Object.fromEntries(needsName.map((u, i) => [u, fetched[i]]));
          rows = rows.map(r => {
            const v = byUid[r.uid];
            if (!v) return r;
            return {
              ...r,
              displayName: v.displayName || v.handle || v.name || null,
              username:    r.username || v.username || v.handle || null,
              avatarUrl:   r.avatarUrl || v.avatarUrl || v.photoURL || null,
              joinDate:    r.joinDate === Infinity && typeof v.joinDate === 'number' ? v.joinDate : r.joinDate,
              optedOut:    v.leaderboardVisible === false,
            };
          }).filter(r => !r.optedOut);
        }

        // Soft-delete tail — same bound, and the helper caches per page-load.
        const deleted = await getDeletedUidSet(rows.map(r => r.uid));
        rows = rows.filter(r => !deleted.has(r.uid));

        rows.sort((a, b) => (b.delta - a.delta) || (a.joinDate - b.joinDate));
        rows = withRanks(rows).map(r => ({ ...r, displayName: r.displayName || 'Reader' }));

        if (!cancelled) {
          setState({ phase: closed ? 'closed' : 'live', rows, hasSnapshot: true, closed });
        }
      } catch (e) {
        console.error('[SeasonBoard] load failed:', e);
        if (!cancelled) setState({ phase: 'error', rows: [], hasSnapshot: false, closed: false });
      }
    })();

    return () => { cancelled = true; };
  }, [authReady, uid, board.boardId, board.startsAt, board.endsAt]);

  const me = useMemo(
    () => (uid ? state.rows.find(r => r.uid === uid) ?? null : null),
    [uid, state.rows]
  );

  // "Your place" affordance — the sticky bar appears only while the reader's own
  // row is off screen, so a reader sitting in the top three never sees it.
  useEffect(() => {
    const node = meRowRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setMeVisible(true); return; }
    const io = new IntersectionObserver(
      ([entry]) => setMeVisible(entry.isIntersecting),
      { rootMargin: '-72px 0px -96px 0px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [me?.uid, state.rows.length]);

  const pool = prizePool(board);
  const bands = useMemo(() => prizeBands(board), [board]);
  const { phase, rows } = state;

  return (
    <>
      <Navbar />
      <style>{`
        @media (max-width: 420px) {
          .sb-prize-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .sb-row { gap: 0.6rem !important; padding: 0.6rem 0.55rem !important; }
          .sb-rank { width: 24px !important; }
          .sb-av { width: 34px !important; height: 34px !important; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#0a0a0a', paddingTop: 68 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '2.5rem 4% 6rem' }}>

          {/* ── Contest header ─────────────────────────────────────────── */}
          <span style={{ fontFamily: LABEL, fontSize: '0.6rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#c9a84c', display: 'block', marginBottom: 8 }}>
            {board.kicker}
          </span>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(1.9rem, 6vw, 2.9rem)', fontWeight: 300, color: '#f5f0e8', lineHeight: 1.05, margin: '0 0 0.6rem' }}>
            {board.title}
          </h1>
          <p style={{ fontFamily: DISPLAY, fontSize: '1.02rem', color: 'rgba(245,240,232,0.55)', lineHeight: 1.6, margin: '0 0 1rem', maxWidth: 560 }}>
            {board.blurb}
          </p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.35rem 0.8rem', borderRadius: 999, border: '1px solid rgba(201,168,76,0.3)', background: 'rgba(201,168,76,0.06)', marginBottom: '1.75rem' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: phase === 'live' ? '#1d9e75' : '#c9a84c', flexShrink: 0 }} />
            <span style={{ fontFamily: LABEL, fontSize: '0.66rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a84c' }}>
              {board.windowLabel}
            </span>
          </div>

          {/* ── Prize table ────────────────────────────────────────────── */}
          <section style={{ border: '1px solid rgba(201,168,76,0.2)', background: 'rgba(201,164,76,0.04)', borderRadius: 14, padding: '1.25rem 1.35rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: LABEL, fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(201,168,76,0.75)' }}>
                {board.prizes.length} prize places
              </span>
              <span style={{ fontFamily: DISPLAY, fontSize: '0.85rem', color: 'rgba(245,240,232,0.45)' }}>
                {money(pool, board.currency)} total
              </span>
            </div>
            <div className="sb-prize-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '0.55rem' }}>
              {bands.map(b => {
                const solo = b.from === b.to;
                const top = b.from <= 3 && solo;
                return (
                  <div key={b.from} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                    padding: '0.6rem 0.4rem', borderRadius: 10,
                    border: `1px solid ${top ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    background: top ? 'rgba(201,168,76,0.07)' : 'rgba(255,255,255,0.02)',
                    gridColumn: solo ? 'auto' : '1 / -1',
                  }}>
                    <span style={{ fontFamily: LABEL, fontSize: '0.56rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: rankColor(b.from) }}>
                      {solo ? ordinal(b.from) : `${ordinal(b.from)} – ${ordinal(b.to)}`}
                    </span>
                    <span style={{ fontFamily: DISPLAY, fontSize: top ? '1.2rem' : '1rem', color: top ? '#c9a84c' : 'rgba(245,240,232,0.72)', lineHeight: 1 }}>
                      {money(b.amount, board.currency)}{solo ? '' : ' each'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Provisional line ───────────────────────────────────────── */}
          {board.provisional && (
            <p style={{ fontFamily: DISPLAY, fontStyle: 'italic', fontSize: '0.92rem', color: 'rgba(245,240,232,0.42)', lineHeight: 1.6, margin: '0 0 2rem', paddingLeft: '0.85rem', borderLeft: '2px solid rgba(201,168,76,0.28)' }}>
              Standings are provisional. Final places are certified against each reader&rsquo;s
              verified activity record after the program closes.
            </p>
          )}

          {/* ── Body ───────────────────────────────────────────────────── */}
          {phase === 'loading' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ height: 56, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
              ))}
            </div>
          ) : phase === 'pre' || phase === 'awaiting-snapshot' ? (
            <WaitingState board={board} phase={phase} />
          ) : phase === 'error' ? (
            <Notice>The board could not be loaded just now. Refresh in a moment.</Notice>
          ) : rows.length === 0 ? (
            <Notice>
              {state.closed
                ? 'The program closed with no qualifying standings.'
                : 'No Scribbles earned yet this month. The first reader to earn one takes the top spot.'}
            </Notice>
          ) : (
            <>
              {state.closed && (
                <div style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                  <span style={{ fontFamily: LABEL, fontSize: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#c9a84c' }}>Closed</span>
                  <p style={{ fontFamily: DISPLAY, fontSize: '0.95rem', color: 'rgba(245,240,232,0.6)', margin: '0.4rem 0 0', lineHeight: 1.55 }}>
                    The program has ended. These standings are frozen while the final places are certified.
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {rows.map((row) => (
                  <Row
                    key={row.uid}
                    row={row}
                    board={board}
                    isMe={row.uid === uid}
                    rowRef={row.uid === uid ? meRowRef : null}
                  />
                ))}
              </div>

              <p style={{ fontFamily: DISPLAY, fontSize: '0.8rem', color: 'rgba(255,255,255,0.25)', margin: '1.5rem 0 0', lineHeight: 1.6 }}>
                Showing every reader who has earned Scribbles since the program opened.{' '}
                <a href="/profile" style={{ color: '#a78bfa', textDecoration: 'underline' }}>Manage your visibility</a>.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── "Your place" sticky affordance ───────────────────────────── */}
      {me && !meVisible && (
        <button
          onClick={() => meRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          style={{
            position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)',
            zIndex: 60, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '0.6rem 1.1rem', borderRadius: 999,
            border: '1px solid rgba(167,139,250,0.45)',
            background: 'rgba(20,16,30,0.92)',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          <span style={{ fontFamily: LABEL, fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(167,139,250,0.75)' }}>
            Your place
          </span>
          <span style={{ fontFamily: DISPLAY, fontSize: '1.05rem', color: '#fff', lineHeight: 1 }}>
            #{me.rank}
          </span>
          <span style={{ fontFamily: DISPLAY, fontSize: '0.95rem', color: '#a78bfa', lineHeight: 1, whiteSpace: 'nowrap' }}>
            +{me.delta.toLocaleString()} ✦
          </span>
        </button>
      )}

      {/* Signed in, earning nothing yet — say so rather than leave them hunting. */}
      {uid && !me && phase === 'live' && rows.length > 0 && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 60,
          padding: '0.6rem 1.1rem', borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(20,20,20,0.92)',
          backdropFilter: 'blur(10px)', boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
          fontFamily: DISPLAY, fontSize: '0.9rem', color: 'rgba(245,240,232,0.6)',
          maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
        }}>
          You haven&rsquo;t earned Scribbles yet this month.
        </div>
      )}
    </>
  );
}

function Notice({ children }) {
  return (
    <div style={{ fontFamily: DISPLAY, fontSize: '1rem', color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '3rem 1rem', lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

function WaitingState({ board, phase }) {
  const opens = new Date(board.startsAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', timeZone: board.timeZone,
  });
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', borderRadius: 14, padding: '2.5rem 1.5rem', textAlign: 'center' }}>
      <div style={{ fontFamily: LABEL, fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: '0.85rem' }}>
        {phase === 'pre' ? 'Not open yet' : 'Opening shortly'}
      </div>
      <p style={{ fontFamily: DISPLAY, fontSize: '1.15rem', color: 'rgba(245,240,232,0.75)', lineHeight: 1.6, margin: '0 auto', maxWidth: 420 }}>
        {phase === 'pre'
          ? <>The program begins at midnight on {opens}. Standings appear here once the first Scribbles are earned.</>
          : <>Standings open as soon as the opening baseline is in. Nothing you earn is lost in the meantime — the program is measured from its own starting line.</>}
      </p>
    </div>
  );
}

function Row({ row, board, isMe, rowRef }) {
  const tint = isMe
    ? { borderColor: 'rgba(167,139,250,0.55)', background: 'rgba(107,47,173,0.12)' }
    : tintFor(row.rank);
  const prize = prizeForPlace(board, row.rank);

  return (
    <a
      ref={rowRef}
      href={`/user?id=${row.uid}`}
      className="sb-row"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.85rem',
        textDecoration: 'none', padding: '0.7rem 0.85rem', borderRadius: 10,
        border: `1px solid ${tint.borderColor}`,
        background: tint.background,
        transition: 'border-color 0.2s',
        scrollMarginTop: 90, scrollMarginBottom: 90,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = tint.borderColor; }}
    >
      <div className="sb-rank" style={{
        flexShrink: 0, width: 32, textAlign: 'center', fontFamily: DISPLAY,
        fontSize: row.rank <= 3 ? '1.4rem' : '1.05rem',
        color: rankColor(row.rank), fontWeight: row.rank <= 3 ? 700 : 500,
      }}>{row.rank}</div>

      <div className="sb-av" style={{
        width: 40, height: 40, borderRadius: '50%',
        background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.22)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0, fontFamily: DISPLAY,
      }}>
        {row.avatarUrl
          ? <img src={row.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initialsOf(row.displayName)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.displayName}
          {isMe && (
            <span style={{ marginLeft: 8, fontFamily: LABEL, fontSize: '0.55rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(167,139,250,0.9)' }}>
              You
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          {row.username && <span style={{ fontSize: '0.66rem', color: 'rgba(167,139,250,0.5)' }}>@{row.username}</span>}
          {prize && (
            <span style={{
              fontFamily: LABEL, fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: '#c9a84c', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 6, padding: '1px 5px',
            }}>
              {money(prize.amount, board.currency)}
            </span>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 58 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: '1.25rem', color: '#a78bfa', lineHeight: 1 }}>
          +{row.delta.toLocaleString()}
        </div>
        <div style={{ fontSize: '0.55rem', color: 'rgba(167,139,250,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: DISPLAY, fontWeight: 500, marginTop: 2 }}>
          Scribbles
        </div>
      </div>
    </a>
  );
}
