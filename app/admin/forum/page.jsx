'use client';

// Open Pages — admin moderation queue (Stage 5). /admin/forum
//
// Two queues:
//   • Flagged  — posts the AI gate routed to open_pages_pending for human review.
//   • Reported — live posts (open_pages) that readers flagged via open_pages_reports.
//
// Admin actions are direct client-side RTDB writes (the convention every other
// admin page here uses), gated by the RTDB rules that grant these four admins
// write access to open_pages / open_pages_pending / open_pages_reports. All
// state-changing actions use root-level multi-path updates so a move/remove is
// atomic.

import { useEffect, useState, useCallback } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { normalizeGenre } from '../../lib/openPages';
import { stripMarkdown } from '../../lib/openPagesMarkdown';

const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const ADMIN_EMAILS = ['ikennaworksfromhome@gmail.com', 'fynbecki@gmail.com'];

// Brand-tinted dark admin palette (matches the other admin pages' base, with
// the Open Pages gold/purple identity).
const s = {
  page: { minHeight: '100vh', background: '#0b0810', color: '#e8e3da', fontFamily: "Cormorant Garamond, Georgia, serif" },
  header: { background: '#120d1c', borderBottom: '1px solid #221934', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  logo: { fontFamily: "'Cinzel', 'Cormorant Garamond', Georgia, serif", fontSize: '0.95rem', fontWeight: 600, color: '#c9a84c', letterSpacing: '0.16em', textTransform: 'uppercase' },
  body: { maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem 5rem' },
  tabs: { display: 'flex', gap: 8, marginBottom: '1.75rem' },
  tab: (active) => ({ background: active ? '#6b2fad' : 'rgba(245,240,232,0.04)', color: active ? '#f5f0e8' : 'rgba(245,240,232,0.6)', border: `1px solid ${active ? '#6b2fad' : 'rgba(245,240,232,0.12)'}`, borderRadius: 999, padding: '0.5rem 1.2rem', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }),
  card: { background: '#120d1c', border: '1px solid #221934', borderRadius: 12, padding: '1.4rem', marginBottom: '1rem' },
  title: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.5rem', fontWeight: 600, color: '#f5f0e8', margin: '0 0 0.35rem', lineHeight: 1.2 },
  meta: { fontSize: '0.82rem', color: 'rgba(245,240,232,0.45)' },
  pill: { fontFamily: "'Cinzel', 'Cormorant Garamond', Georgia, serif", fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c9a84c', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '0.2rem 0.65rem' },
  excerpt: { fontSize: '0.96rem', lineHeight: 1.6, color: 'rgba(245,240,232,0.62)', margin: '0.9rem 0' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '1.1rem', paddingTop: '1.1rem', borderTop: '1px solid rgba(245,240,232,0.07)' },
  btnApprove: { background: 'rgba(29,158,117,0.15)', color: '#3ecf9b', border: '1px solid rgba(29,158,117,0.4)', padding: '0.5rem 1.1rem', borderRadius: 7, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnRemove: { background: 'rgba(220,90,90,0.12)', color: '#e87b7b', border: '1px solid rgba(220,90,90,0.4)', padding: '0.5rem 1.1rem', borderRadius: 7, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: 'rgba(245,240,232,0.6)', border: '1px solid rgba(245,240,232,0.2)', padding: '0.5rem 1.1rem', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  link: { color: '#c9a84c', fontSize: '0.8rem', textDecoration: 'none' },
  reportBox: { background: 'rgba(220,90,90,0.06)', border: '1px solid rgba(220,90,90,0.2)', borderRadius: 8, padding: '0.7rem 0.9rem', marginTop: '0.9rem' },
  gate: { minHeight: '100vh', background: '#0b0810', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f5f0e8', flexDirection: 'column', gap: '1rem', fontFamily: "Cormorant Garamond, Georgia, serif", textAlign: 'center', padding: '2rem' },
  empty: { textAlign: 'center', padding: '3.5rem 1rem', color: 'rgba(245,240,232,0.4)', fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic', fontSize: '1.3rem' },
};

function fmtDate(ts) {
  if (!ts || typeof ts !== 'number') return '';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function excerptOf(body) {
  const t = stripMarkdown(body);
  return t.length <= 220 ? t : t.slice(0, 220).replace(/\s+\S*$/, '') + '…';
}
function authorLine(p) {
  const name = p.authorName || 'Reader';
  return p.authorHandle ? `${name} · @${p.authorHandle}` : name;
}

export default function AdminForumPage() {
  const { user, loading } = useAuth();
  const isAdmin = !!user && (ADMIN_UIDS.includes(user.uid) || (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())));

  const [tab, setTab] = useState('flagged');
  const [flagged, setFlagged] = useState([]);
  const [reported, setReported] = useState([]);
  const [busy, setBusy] = useState(false);      // initial/refresh load
  const [acting, setActing] = useState('');       // id currently being acted on
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setMsg('');
    try {
      const { ref, get } = await import('firebase/database');
      const [pendingSnap, reportsSnap, publicSnap] = await Promise.all([
        get(ref(db, 'open_pages_pending')),
        get(ref(db, 'open_pages_reports')),
        get(ref(db, 'open_pages')),
      ]);

      const pending = pendingSnap.exists() ? pendingSnap.val() : {};
      const reportsRaw = reportsSnap.exists() ? reportsSnap.val() : {};
      const publicPosts = publicSnap.exists() ? publicSnap.val() : {};

      const flaggedList = Object.entries(pending)
        .map(([id, p]) => ({ id, ...p }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const reportedList = Object.entries(reportsRaw)
        .map(([postId, byUid]) => {
          const reports = Object.values(byUid || {});
          const post = publicPosts[postId] || null; // null = orphaned reports (post already gone)
          const latest = reports.reduce((mx, r) => Math.max(mx, r?.createdAt || 0), 0);
          return { id: postId, post, reports, count: reports.length, latest };
        })
        .sort((a, b) => b.count - a.count || b.latest - a.latest);

      setFlagged(flaggedList);
      setReported(reportedList);
    } catch (e) {
      console.error('[admin/forum] load failed:', e);
      setMsg('Failed to load the queue: ' + e.message);
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // ---- Actions (atomic multi-path writes at the DB root) ----

  async function approve(item) {
    setActing(item.id);
    setMsg('');
    try {
      const { ref, update } = await import('firebase/database');
      const { id, ...record } = item;
      record.status = 'live';
      const updates = {
        [`open_pages/${id}`]: record,
        [`open_pages_pending/${id}`]: null,
      };
      if (record.authorUid) updates[`user_open_pages/${record.authorUid}/${id}`] = record;
      await update(ref(db), updates);
      setFlagged((list) => list.filter((p) => p.id !== id));
      setMsg('Approved — the post is now live.');
    } catch (e) {
      console.error('[admin/forum] approve failed:', e);
      setMsg('Approve failed: ' + e.message);
    }
    setActing('');
  }

  async function removePost({ id, authorUid }) {
    if (!window.confirm('Remove this post permanently? This also clears its reports.')) return;
    setActing(id);
    setMsg('');
    try {
      const { ref, update } = await import('firebase/database');
      const updates = {
        [`open_pages/${id}`]: null,
        [`open_pages_pending/${id}`]: null,
        [`open_pages_reports/${id}`]: null,
      };
      if (authorUid) updates[`user_open_pages/${authorUid}/${id}`] = null;
      await update(ref(db), updates);
      setFlagged((list) => list.filter((p) => p.id !== id));
      setReported((list) => list.filter((r) => r.id !== id));
      setMsg('Post removed.');
    } catch (e) {
      console.error('[admin/forum] remove failed:', e);
      setMsg('Remove failed: ' + e.message);
    }
    setActing('');
  }

  async function dismissReports(id) {
    setActing(id);
    setMsg('');
    try {
      const { ref, set } = await import('firebase/database');
      await set(ref(db, `open_pages_reports/${id}`), null);
      setReported((list) => list.filter((r) => r.id !== id));
      setMsg('Reports dismissed — the post stays live.');
    } catch (e) {
      console.error('[admin/forum] dismiss failed:', e);
      setMsg('Dismiss failed: ' + e.message);
    }
    setActing('');
  }

  // ---- Gates ----
  if (loading) {
    return <div style={s.gate}><div style={{ color: 'rgba(245,240,232,0.4)' }}>Loading…</div></div>;
  }
  if (!user) {
    return <div style={s.gate}><div style={{ color: 'rgba(245,240,232,0.5)' }}>Sign in to access the moderation queue.</div></div>;
  }
  if (!isAdmin) {
    return (
      <div style={s.gate}>
        <div style={{ fontSize: '1.2rem', color: '#e87b7b', fontWeight: 700 }}>Access Denied</div>
        <div style={{ color: 'rgba(245,240,232,0.45)', fontSize: '0.9rem' }}>This page is for moderators only.</div>
      </div>
    );
  }

  const list = tab === 'flagged' ? flagged : reported;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <span style={s.logo}>Open Pages · Moderation</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={load} disabled={busy} style={{ ...s.btnGhost, opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
          <span style={{ fontSize: '0.72rem', color: 'rgba(245,240,232,0.3)' }}>{user.email}</span>
        </div>
      </header>

      <div style={s.body}>
        <div style={s.tabs}>
          <button style={s.tab(tab === 'flagged')} onClick={() => setTab('flagged')}>
            Flagged ({flagged.length})
          </button>
          <button style={s.tab(tab === 'reported')} onClick={() => setTab('reported')}>
            Reported ({reported.length})
          </button>
        </div>

        {msg ? (
          <div style={{ marginBottom: '1.25rem', fontSize: '0.88rem', color: '#c9a84c', background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 8, padding: '0.7rem 1rem' }}>
            {msg}
          </div>
        ) : null}

        {busy && list.length === 0 ? (
          <div style={s.empty}>Loading the queue…</div>
        ) : list.length === 0 ? (
          <div style={s.empty}>
            {tab === 'flagged' ? 'No flagged posts awaiting review.' : 'No reported posts right now.'}
          </div>
        ) : tab === 'flagged' ? (
          flagged.map((p) => (
            <FlaggedCard key={p.id} post={p} acting={acting === p.id} onApprove={() => approve(p)} onRemove={() => removePost({ id: p.id, authorUid: p.authorUid })} />
          ))
        ) : (
          reported.map((r) => (
            <ReportedCard
              key={r.id}
              item={r}
              acting={acting === r.id}
              onRemove={() => removePost({ id: r.id, authorUid: r.post?.authorUid })}
              onDismiss={() => dismissReports(r.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CardHead({ post }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={s.pill}>{normalizeGenre(post.genre)}</span>
        <span style={s.meta}>{fmtDate(post.createdAt)}</span>
      </div>
      <h2 style={s.title}>{post.title || '(untitled)'}</h2>
      <div style={s.meta}>{authorLine(post)}</div>
      <p style={s.excerpt}>{excerptOf(post.body)}</p>
    </>
  );
}

function FlaggedCard({ post, acting, onApprove, onRemove }) {
  const reason = post.moderation?.reason;
  const cats = Array.isArray(post.moderation?.categories) ? post.moderation.categories.filter(Boolean) : [];
  return (
    <div style={s.card}>
      <CardHead post={post} />
      {(reason || cats.length) ? (
        <div style={s.reportBox}>
          <div style={{ fontFamily: "'Cinzel', Georgia, serif", fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#e87b7b', marginBottom: 5 }}>
            AI moderation
          </div>
          {reason ? <div style={{ fontSize: '0.88rem', color: 'rgba(245,240,232,0.78)' }}>{reason}</div> : null}
          {cats.length ? <div style={{ fontSize: '0.78rem', color: 'rgba(245,240,232,0.5)', marginTop: 4 }}>Categories: {cats.join(', ')}</div> : null}
        </div>
      ) : null}
      <div style={s.actions}>
        <button style={{ ...s.btnApprove, opacity: acting ? 0.5 : 1 }} disabled={acting} onClick={onApprove}>
          {acting ? 'Working…' : 'Approve · publish'}
        </button>
        <button style={{ ...s.btnRemove, opacity: acting ? 0.5 : 1 }} disabled={acting} onClick={onRemove}>
          Remove
        </button>
        <a href={`/open-pages/${post.id}`} target="_blank" rel="noreferrer" style={{ ...s.btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          Preview ↗
        </a>
      </div>
    </div>
  );
}

function ReportedCard({ item, acting, onRemove, onDismiss }) {
  const { post, reports, count } = item;

  if (!post) {
    // Orphaned reports: the post is already gone. Offer cleanup only.
    return (
      <div style={s.card}>
        <div style={s.meta}>Orphaned reports — the post is no longer live.</div>
        <div style={{ fontSize: '0.82rem', color: 'rgba(245,240,232,0.55)', marginTop: 6 }}>
          {count} report{count === 1 ? '' : 's'} on a post that no longer exists.
        </div>
        <div style={s.actions}>
          <button style={{ ...s.btnGhost, opacity: acting ? 0.5 : 1 }} disabled={acting} onClick={onDismiss}>
            {acting ? 'Working…' : 'Clear reports'}
          </button>
        </div>
      </div>
    );
  }

  // Tally reasons.
  const tally = reports.reduce((acc, r) => {
    const key = r?.reason || 'Other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={s.card}>
      <CardHead post={post} />
      <div style={s.reportBox}>
        <div style={{ fontFamily: "'Cinzel', Georgia, serif", fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#e87b7b', marginBottom: 6 }}>
          {count} report{count === 1 ? '' : 's'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(tally).map(([reason, n]) => (
            <span key={reason} style={{ fontSize: '0.78rem', color: 'rgba(245,240,232,0.78)', background: 'rgba(245,240,232,0.05)', border: '1px solid rgba(245,240,232,0.12)', borderRadius: 999, padding: '0.18rem 0.6rem' }}>
              {reason} · {n}
            </span>
          ))}
        </div>
      </div>
      <div style={s.actions}>
        <button style={{ ...s.btnRemove, opacity: acting ? 0.5 : 1 }} disabled={acting} onClick={onRemove}>
          {acting ? 'Working…' : 'Remove post'}
        </button>
        <button style={{ ...s.btnGhost, opacity: acting ? 0.5 : 1 }} disabled={acting} onClick={onDismiss}>
          Dismiss reports
        </button>
        <a href={`/open-pages/${post.id}`} target="_blank" rel="noreferrer" style={{ ...s.btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          Preview ↗
        </a>
      </div>
    </div>
  );
}
