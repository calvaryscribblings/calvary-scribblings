'use client';

// THE SQUARE'S ADMIN — permissions and the report queue. R33.2.
//
// ⚠ THE GRANT IS A CONTROL, NOT A SCRIPT. Ikenna's ruling: the three switches
// must be grantable to someone with no admin surface at all, by clicking, not by
// someone running a file. That is what this page is.
//
// ⚠ AND THEY ARE THREE SWITCHES, NOT A ROLE. The reason, recorded at the site:
// a single "moderator" flag means the day you want someone to post images you
// must also hand them deletion. Separate switches cost nothing now and save a
// rebuild later. Nothing here ever writes all three together.
//
// WHO MAY OPEN THIS PAGE is still the founder pair, because granting a
// permission is a different act from holding one, and there is no
// "canGrantPermissions" switch — deliberately, since that is the one power that
// would let a moderator promote themselves. The RULES enforce the same thing:
// users/{uid}/canPin and friends are founder-write only, exactly like isAuthor.
//
// WHO MAY WORK THE QUEUE is anyone holding canRemovePosts, which is the point of
// the switch. The rules on square_reports read the switch, not an identity.

import { useState, useEffect, useCallback } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { ref, get, set, remove, update } from 'firebase/database';

const FOUNDERS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

const SWITCHES = [
  { key: 'canPostImages', label: 'Post images',
    why: 'Images are the expensive, hard-to-moderate surface. Text is open to everyone; this is not.' },
  { key: 'canPin', label: 'Pin a post',
    why: 'A pinned thread survives the 48-hour horizon — its replies too. This grants permanence.' },
  { key: 'canRemovePosts', label: "Remove someone else's post",
    why: 'The heaviest of the three. A reader can always withdraw their own words without it.' },
];

const FF = 'Cormorant Garamond, Georgia, serif';
const S = {
  page:  { minHeight: '100vh', background: '#0c0c10', color: '#f0ece4', padding: '2.5rem 1.5rem 6rem', fontFamily: FF },
  wrap:  { maxWidth: 860, margin: '0 auto' },
  h1:    { fontSize: '2rem', fontWeight: 400, margin: '0 0 6px' },
  sub:   { color: 'rgba(240,236,228,0.5)', fontSize: '0.95rem', margin: '0 0 2rem', lineHeight: 1.6 },
  card:  { border: '1px solid rgba(240,236,228,0.12)', borderRadius: 10, padding: '1.1rem 1.25rem', marginBottom: '1rem', background: '#141419' },
  input: { background: '#0c0c10', border: '1px solid rgba(240,236,228,0.2)', color: '#f0ece4', padding: '9px 12px', borderRadius: 8, fontFamily: FF, fontSize: '0.95rem', width: '100%' },
  btn:   { background: '#6b2fad', border: 'none', color: '#fff', padding: '9px 18px', borderRadius: 8, fontFamily: FF, fontSize: '0.92rem', cursor: 'pointer' },
  ghost: { background: 'none', border: '1px solid rgba(240,236,228,0.2)', color: 'rgba(240,236,228,0.75)', padding: '7px 14px', borderRadius: 8, fontFamily: FF, fontSize: '0.88rem', cursor: 'pointer' },
  h2:    { fontSize: '0.72rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a84c', margin: '2.5rem 0 0.9rem', fontWeight: 700 },
};

function Toggle({ on, onChange, busy }) {
  return (
    <button onClick={() => onChange(!on)} disabled={busy} aria-pressed={on}
      style={{ width: 44, height: 25, borderRadius: 13, border: 'none', cursor: busy ? 'wait' : 'pointer',
        background: on ? '#6b2fad' : 'rgba(240,236,228,0.16)', position: 'relative', transition: 'background .15s', flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );
}

export default function SquareAdmin() {
  const { user } = useAuth();
  const isFounder = user && FOUNDERS.includes(user.uid);

  const [handle, setHandle] = useState('');
  const [target, setTarget] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [holders, setHolders] = useState([]);
  const [reports, setReports] = useState([]);
  const [horizon, setHorizon] = useState(null);

  // Everyone who currently holds anything, so "who can do what" is a glance and
  // not an archaeology exercise.
  const loadHolders = useCallback(async () => {
    const snap = await get(ref(db, 'users'));
    const all = snap.exists() ? snap.val() : {};
    setHolders(Object.entries(all)
      .filter(([, u]) => SWITCHES.some(s => u[s.key] === true))
      .map(([uid, u]) => ({ uid, name: u.displayName || u.username || 'Reader', username: u.username || null,
        ...Object.fromEntries(SWITCHES.map(s => [s.key, u[s.key] === true])) })));
  }, []);

  const loadReports = useCallback(async () => {
    const snap = await get(ref(db, 'square_reports'));
    if (!snap.exists()) { setReports([]); return; }
    const rows = [];
    for (const [postId, node] of Object.entries(snap.val())) {
      const entries = Object.entries(node).filter(([k]) => !['resolved', 'resolvedBy', 'resolvedAt'].includes(k));
      if (!entries.length) continue;
      rows.push({ postId, resolved: node.resolved === true, reports: entries.map(([uid, r]) => ({ uid, ...r })) });
    }
    rows.sort((a, b) => (a.resolved === b.resolved ? 0 : a.resolved ? 1 : -1)
      || Math.max(...b.reports.map(r => r.createdAt || 0)) - Math.max(...a.reports.map(r => r.createdAt || 0)));
    setReports(rows);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadHolders().catch(() => {});
    loadReports().catch(() => {});
    get(ref(db, 'square_horizon')).then(s => setHorizon(s.exists() ? s.val() : null)).catch(() => {});
  }, [user, loadHolders, loadReports]);

  // Reuse of the resolver the CMS already uses for story attribution: a handle
  // is what a person knows about another person; a uid is not.
  const find = async () => {
    setErr(''); setTarget(null);
    const h = handle.trim().replace(/^@+/, '').toLowerCase();
    if (!h) return;
    setBusy('find');
    try {
      const idx = await get(ref(db, `usernames/${h}`));
      if (!idx.exists()) { setErr(`No reader owns @${h}.`); setBusy(''); return; }
      const uid = idx.val();
      const u = await get(ref(db, `users/${uid}`));
      const v = u.exists() ? u.val() : {};
      setTarget({ uid, name: v.displayName || h, username: v.username || h,
        ...Object.fromEntries(SWITCHES.map(s => [s.key, v[s.key] === true])) });
    } catch (e) { setErr('Lookup failed. ' + (e?.message || '')); }
    setBusy('');
  };

  const toggle = async (uid, key, next) => {
    setBusy(uid + key);
    try {
      // One boolean. Never a bundle — that is the whole design.
      if (next) await set(ref(db, `users/${uid}/${key}`), true);
      else await remove(ref(db, `users/${uid}/${key}`));
      setTarget(t => (t && t.uid === uid ? { ...t, [key]: next } : t));
      await loadHolders();
    } catch (e) { setErr(`Could not change ${key}: ${e?.message || e}`); }
    setBusy('');
  };

  const resolve = async (postId) => {
    setBusy(postId);
    try {
      await update(ref(db, `square_reports/${postId}`), { resolved: true, resolvedBy: user.uid, resolvedAt: Date.now() });
      await loadReports();
    } catch (e) { setErr('Could not resolve: ' + (e?.message || e)); }
    setBusy('');
  };

  if (!user) return <div style={S.page}><div style={S.wrap}><p style={S.sub}>Sign in.</p></div></div>;
  if (!isFounder) {
    return (
      <div style={S.page}><div style={S.wrap}>
        <h1 style={S.h1}>The Square</h1>
        <p style={S.sub}>Granting a permission is a different act from holding one. Only the founders grant.</p>
      </div></div>
    );
  }

  const stale = horizon?.lastBellAt ? (Date.now() - horizon.lastBellAt) > 26 * 3600 * 1000 : true;

  return (
    <div style={S.page}><div style={S.wrap}>
      <h1 style={S.h1}>The Square</h1>
      <p style={S.sub}>
        Three separate permissions, granted one at a time. A single moderator role would mean the
        day you want someone to post images you must also hand them deletion.
      </p>

      {err && <div style={{ ...S.card, borderColor: 'rgba(224,87,79,0.5)', color: '#e0574f' }}>{err}</div>}

      <h2 style={S.h2}>Grant a permission</h2>
      <div style={S.card}>
        <div style={{ display: 'flex', gap: 8, marginBottom: target ? 16 : 0 }}>
          <input style={S.input} placeholder="@handle" value={handle}
            onChange={e => setHandle(e.target.value)} onKeyDown={e => e.key === 'Enter' && find()} />
          <button style={S.btn} onClick={find} disabled={busy === 'find'}>{busy === 'find' ? 'Finding…' : 'Find'}</button>
        </div>
        {target && (
          <div style={{ borderTop: '1px solid rgba(240,236,228,0.1)', paddingTop: 14 }}>
            <div style={{ fontSize: '1.05rem', marginBottom: 2 }}>{target.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'rgba(240,236,228,0.4)', marginBottom: 14 }}>@{target.username} · {target.uid}</div>
            {SWITCHES.map(s => (
              <div key={s.key} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid rgba(240,236,228,0.06)' }}>
                <Toggle on={target[s.key]} busy={busy === target.uid + s.key} onChange={v => toggle(target.uid, s.key, v)} />
                <div>
                  <div style={{ fontSize: '0.95rem' }}>{s.label}</div>
                  <div style={{ fontSize: '0.82rem', color: 'rgba(240,236,228,0.45)', lineHeight: 1.5 }}>{s.why}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 style={S.h2}>Who holds what</h2>
      <div style={S.card}>
        {holders.length === 0 ? <div style={{ color: 'rgba(240,236,228,0.45)' }}>Nobody yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
              <thead><tr>
                <th style={{ textAlign: 'left', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,236,228,0.4)', padding: '0 10px 8px 0' }}>Reader</th>
                {SWITCHES.map(s => <th key={s.key} style={{ fontSize: '0.7rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(240,236,228,0.4)', padding: '0 8px 8px' }}>{s.label}</th>)}
              </tr></thead>
              <tbody>
                {holders.map(h => (
                  <tr key={h.uid} style={{ borderTop: '1px solid rgba(240,236,228,0.07)' }}>
                    <td style={{ padding: '9px 10px 9px 0' }}>{h.name}{h.username && <span style={{ color: 'rgba(240,236,228,0.35)', fontSize: '0.8rem' }}> @{h.username}</span>}</td>
                    {SWITCHES.map(s => (
                      <td key={s.key} style={{ textAlign: 'center', padding: '9px 8px' }}>
                        <Toggle on={h[s.key]} busy={busy === h.uid + s.key} onChange={v => toggle(h.uid, s.key, v)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 style={S.h2}>Reports</h2>
      <div style={S.card}>
        {reports.length === 0 ? (
          <div style={{ color: 'rgba(240,236,228,0.45)' }}>Nothing reported. Before R33.2 the report button did nothing at all, so an empty queue here is new information rather than the absence of it.</div>
        ) : reports.map(r => (
          <div key={r.postId} style={{ borderTop: '1px solid rgba(240,236,228,0.07)', padding: '12px 0', opacity: r.resolved ? 0.45 : 1 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <a href={`/square/p?id=${r.postId}`} target="_blank" rel="noreferrer" style={{ color: '#9b6dff', textDecoration: 'none', fontSize: '0.9rem' }}>View post →</a>
              <span style={{ fontSize: '0.78rem', color: 'rgba(240,236,228,0.4)' }}>{r.reports.length} report{r.reports.length === 1 ? '' : 's'}</span>
              {r.resolved && <span style={{ fontSize: '0.7rem', color: '#6fae7d' }}>RESOLVED</span>}
              {!r.resolved && <button style={S.ghost} onClick={() => resolve(r.postId)} disabled={busy === r.postId}>Mark handled</button>}
            </div>
            {r.reports.map(x => (
              <div key={x.uid} style={{ fontSize: '0.85rem', color: 'rgba(240,236,228,0.6)', paddingLeft: 12, borderLeft: '2px solid rgba(240,236,228,0.1)', marginBottom: 4 }}>
                <strong style={{ color: '#e0574f', fontWeight: 500 }}>{x.reason}</strong>{x.note ? ` — ${x.note}` : ''}
              </div>
            ))}
          </div>
        ))}
      </div>

      <h2 style={S.h2}>The horizon</h2>
      <div style={{ ...S.card, borderColor: stale ? 'rgba(224,87,79,0.45)' : 'rgba(111,174,125,0.35)' }}>
        {!horizon ? (
          <div>Never run. The first bell lands at the next 20:00 London.</div>
        ) : (
          <>
            <div>Last bell: <strong>{horizon.lastBellAt ? new Date(horizon.lastBellAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'never'}</strong></div>
            <div style={{ color: 'rgba(240,236,228,0.55)', fontSize: '0.88rem', marginTop: 4 }}>
              Swept {horizon.sweptAtLastRun ?? 0} records, {horizon.remaining ?? '?'} remain in the room.
            </div>
          </>
        )}
        {stale && <div style={{ color: '#e0574f', marginTop: 8, fontSize: '0.88rem' }}>
          ⚠ No bell in the last 26 hours. The workflow also fails loudly when this happens — check Actions.
        </div>}
      </div>
    </div></div>
  );
}
