'use client';

// THE REPORT QUEUE — reported story comments, DMs and profiles. W5.
//
// Reads content_reports/{contentKey}/{reporterUid} (app/lib/contentReports.js has the shape).
// WHO MAY OPEN IT is anyone holding canRemovePosts, the same switch that works the Square's queue
// on /admin/square; the rules read the switch, not an identity, so this page does too.
//
// ⚠ A DM IS SHOWN AS ONE MESSAGE, BY RULING (Ikenna, 24–25 Sep). The row carries the reported
// message and the reporter's note, and nothing else: no link, no read of dm_messages, no "load
// the conversation". contextHrefFor() returns null for a DM so there is nothing here to click.

import { useState, useEffect, useCallback } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { ref, get, update, serverTimestamp } from 'firebase/database';
import { queueRows, contextHrefFor } from '../../lib/contentReports';

const FF = 'Cormorant Garamond, Georgia, serif';
const S = {
  page:  { minHeight: '100vh', background: '#0c0c10', color: '#f0ece4', padding: '2.5rem 1.5rem 6rem', fontFamily: FF },
  wrap:  { maxWidth: 860, margin: '0 auto' },
  h1:    { fontSize: '2rem', fontWeight: 400, margin: '0 0 6px' },
  sub:   { color: 'rgba(240,236,228,0.5)', fontSize: '0.95rem', margin: '0 0 1.5rem', lineHeight: 1.6 },
  card:  { border: '1px solid rgba(240,236,228,0.12)', borderRadius: 10, padding: '1.1rem 1.25rem', marginBottom: '1rem', background: '#141419' },
  ghost: { background: 'none', border: '1px solid rgba(240,236,228,0.2)', color: 'rgba(240,236,228,0.75)', padding: '7px 14px', borderRadius: 8, fontFamily: FF, fontSize: '0.88rem', cursor: 'pointer' },
  kind:  { fontSize: '0.66rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a84c', fontWeight: 700 },
  quiet: { fontSize: '0.8rem', color: 'rgba(240,236,228,0.45)' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'comment', label: 'Comments' },
  { key: 'dm', label: 'Messages' },
  { key: 'user', label: 'Profiles' },
];
const KIND_LABEL = { comment: 'Comment', dm: 'Direct message', user: 'Profile' };

const when = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function ReportsAdmin() {
  const { user, loading } = useAuth() || {};
  const [allowed, setAllowed] = useState(null); // null = checking
  const [tree, setTree] = useState(null);
  const [filter, setFilter] = useState('all');
  const [names, setNames] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const snap = await get(ref(db, 'content_reports'));
    const t = snap.exists() ? snap.val() : {};
    setTree(t);
    // Who is who: a name is what a moderator knows about a person; a uid is not.
    const uids = new Set();
    for (const node of Object.values(t)) {
      for (const [k, r] of Object.entries(node || {})) {
        if (r && typeof r === 'object') { uids.add(k); if (r.offenderUid) uids.add(r.offenderUid); }
      }
    }
    const pairs = await Promise.all([...uids].map(async (uid) => {
      try {
        const [n, h] = await Promise.all([get(ref(db, `users/${uid}/displayName`)), get(ref(db, `users/${uid}/username`))]);
        return [uid, { name: n.val() || null, handle: h.val() || null }];
      } catch { return [uid, { name: null, handle: null }]; }
    }));
    setNames(Object.fromEntries(pairs));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    (async () => {
      try {
        const s = await get(ref(db, `users/${user.uid}/canRemovePosts`));
        if (!live) return;
        const ok = s.val() === true;
        setAllowed(ok);
        if (ok) await load();
      } catch (e) {
        if (live) { setAllowed(false); setErr('Could not read the queue. ' + (e?.message || '')); }
      }
    })();
    return () => { live = false; };
  }, [user, load]);

  const resolve = async (contentKey) => {
    setBusy(contentKey); setErr('');
    try {
      // The server's clock, as on /admin/square: resolvedAt is an audit field.
      await update(ref(db, `content_reports/${contentKey}`), { resolved: true, resolvedBy: user.uid, resolvedAt: serverTimestamp() });
      await load();
    } catch (e) { setErr('Could not resolve: ' + (e?.message || e)); }
    setBusy('');
  };

  const who = (uid) => {
    const n = names[uid];
    if (!n) return uid;
    return n.handle ? `${n.name || n.handle} @${n.handle}` : (n.name || uid);
  };

  if (loading) return <div style={S.page}><div style={S.wrap} /></div>;
  if (!user) return <div style={S.page}><div style={S.wrap}><h1 style={S.h1}>Reports</h1><p style={S.sub}>Sign in.</p></div></div>;
  if (allowed === false) {
    return (
      <div style={S.page}><div style={S.wrap}>
        <h1 style={S.h1}>Reports</h1>
        <p style={S.sub}>This queue is for moderators, the readers who can remove posts. {err}</p>
      </div></div>
    );
  }

  const rows = tree ? queueRows(tree, filter) : [];
  const open = tree ? queueRows(tree).filter((r) => !r.resolved).length : 0;

  return (
    <div style={S.page}><div style={S.wrap}>
      <h1 style={S.h1}>Reports</h1>
      <p style={S.sub}>
        Reported comments, messages and profiles, newest first. A reported message shows only that
        message and what the reader wrote, never the conversation. Square posts are on{' '}
        <a href="/admin/square" style={{ color: '#9b6dff', textDecoration: 'none' }}>The Square</a>.
      </p>

      <div role="tablist" aria-label="Filter by kind" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
            style={{ ...S.ghost, ...(filter === f.key ? { background: '#6b2fad', borderColor: '#6b2fad', color: '#fff' } : null) }}>
            {f.label}
          </button>
        ))}
        {tree && <span style={{ ...S.quiet, alignSelf: 'center', marginLeft: 'auto' }}>{open} open</span>}
      </div>

      {err && <div style={{ ...S.card, borderColor: 'rgba(224,87,79,0.5)', color: '#e0574f' }}>{err}</div>}

      {tree === null ? (
        <div style={S.card}><span style={S.quiet}>Loading…</span></div>
      ) : rows.length === 0 ? (
        <div style={S.card}><span style={S.quiet}>Nothing reported{filter === 'all' ? '' : ' of this kind'}.</span></div>
      ) : rows.map((row) => {
        const href = contextHrefFor(row.reports[0]);
        return (
          <div key={row.contentKey} data-testid="report-row" style={{ ...S.card, opacity: row.resolved ? 0.5 : 1 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={S.kind}>{KIND_LABEL[row.kind] || row.kind}</span>
              <span style={S.quiet}>{row.reports.length} report{row.reports.length === 1 ? '' : 's'} · {when(row.latestAt)}</span>
              {row.resolved
                ? <span style={{ fontSize: '0.7rem', color: '#6fae7d', letterSpacing: '0.1em' }}>RESOLVED{row.resolvedBy ? ` · ${who(row.resolvedBy)}` : ''}</span>
                : <button style={{ ...S.ghost, marginLeft: 'auto' }} onClick={() => resolve(row.contentKey)} disabled={busy === row.contentKey}>
                    {busy === row.contentKey ? 'Resolving…' : 'Resolve'}
                  </button>}
            </div>
            <div style={{ fontSize: '0.88rem', marginBottom: 8 }}>
              <span style={S.quiet}>About </span>{who(row.reports[0].offenderUid)}
              {href && <> · <a href={href} target="_blank" rel="noreferrer" style={{ color: '#9b6dff', textDecoration: 'none' }}>View in context →</a></>}
            </div>
            {row.reports[0].snapshot ? (
              <blockquote style={{ margin: '0 0 10px', padding: '8px 12px', borderLeft: '2px solid rgba(201,168,76,0.4)', background: 'rgba(240,236,228,0.03)', fontSize: '0.95rem', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {row.reports[0].snapshot}
              </blockquote>
            ) : null}
            {row.reports.map((x) => (
              <div key={x.reporterUid} style={{ fontSize: '0.85rem', color: 'rgba(240,236,228,0.65)', paddingLeft: 12, borderLeft: '2px solid rgba(240,236,228,0.1)', marginBottom: 4, overflowWrap: 'anywhere' }}>
                <strong style={{ color: '#e0574f', fontWeight: 500 }}>{x.reason}</strong>
                {x.note ? ` — ${x.note}` : ''}
                <span style={S.quiet}> · {who(x.reporterUid)} · {when(x.createdAt)}</span>
                {/* Both people in a conversation can report it, each about the other and each
                    with their own message. Anything that differs from the row's head shows here. */}
                {x.offenderUid !== row.reports[0].offenderUid && <div style={S.quiet}>About {who(x.offenderUid)}</div>}
                {x.snapshot && x.snapshot !== row.reports[0].snapshot && (
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', color: 'rgba(240,236,228,0.85)' }}>{x.snapshot}</div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div></div>
  );
}
