'use client';
// PROOFS — the editors' side (rulings 252–254, 258).
//
// · THE SWITCH (ruling 258). Proofs opens to the founder accounts only, until Ikenna opens it to
//   writers here. It writes proofs_access { open, changedAt, changedBy } (founder-only in the
//   rules), and the server reads it on every /api/proofs call: nothing in a browser decides it.
// · THE QUEUE. Reports writers filed from a proof, newest first. Founders change a report's
//   status (Received → Fixed / Left as it is); the rules let them write the three status fields
//   and nothing else. A report never holds a story back, and nothing here touches a story.
import { useState } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { useReliableLoad } from '../../lib/useReliable';
import AdminLoad from '../../components/AdminLoad';
import { ref, get, update, set, serverTimestamp } from 'firebase/database';
import { isFounder } from '../../lib/founders';
import { isId } from '../../lib/ids';
import { PROOFS_ACCESS_PATH, PROOF_REPORTS_PATH, PROOFS_COPY as C, REPORT_STATUSES, londonWhen, isProofSlug, isReportId } from '../../lib/proofs';

const FF = 'Cormorant Garamond, Georgia, serif';
const S = {
  page:  { minHeight: '100vh', background: '#0c0c10', color: '#f0ece4', padding: '2.5rem 1rem 6rem', fontFamily: FF },
  wrap:  { maxWidth: 860, margin: '0 auto' },
  h1:    { fontSize: '2rem', fontWeight: 400, margin: '0 0 6px' },
  sub:   { color: 'rgba(240,236,228,0.6)', fontSize: '1rem', margin: '0 0 1.5rem', lineHeight: 1.6 },
  card:  { border: '1px solid rgba(240,236,228,0.12)', borderRadius: 10, padding: '1.1rem 1.25rem', marginBottom: '1rem', background: '#141419' },
  ghost: { background: 'none', border: '1px solid rgba(240,236,228,0.25)', color: 'rgba(240,236,228,0.85)', padding: '9px 14px', minHeight: 44, borderRadius: 8, fontFamily: FF, fontSize: '0.95rem', cursor: 'pointer' },
  on:    { background: '#6b2fad', borderColor: '#6b2fad', color: '#fff' },
  kind:  { fontSize: '0.66rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a84c', fontWeight: 700 },
  quiet: { fontSize: '0.85rem', color: 'rgba(240,236,228,0.5)' },
  msg:   { fontSize: '1.05rem', lineHeight: 1.55, margin: '0.5rem 0 0.8rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
};
const when = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }) : '');

async function readAll() {
  const [sw, rs] = await Promise.all([get(ref(db, PROOFS_ACCESS_PATH)), get(ref(db, PROOF_REPORTS_PATH))]);
  const reports = Object.entries(rs.val() || {})
    // LIVE-PATHS-1: the KEY is the id (a stored `id` field never overrides it), and a key that is
    // not a report id is never shown, so it can never become a write path below.
    .filter(([id, r]) => isReportId(id) && r && typeof r === 'object')
    .map(([id, r]) => ({ ...r, id }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // A title and a name are what an editor knows a story and a person by.
  // Stored fields, so each is checked before it becomes an address; an unchecked one is shown raw.
  const slugs = [...new Set(reports.map((r) => r.slug))].filter(isProofSlug);
  const uids = [...new Set(reports.map((r) => r.reporterUid))].filter((u) => isId('uid', u));
  const [titles, names] = await Promise.all([
    Promise.all(slugs.map(async (s) => { try { return [s, (await get(ref(db, `cms_stories/${s}/title`))).val()]; } catch { return [s, null]; } })),
    Promise.all(uids.map(async (u) => { try { return [u, (await get(ref(db, `users/${u}/displayName`))).val()]; } catch { return [u, null]; } })),
  ]);
  return { access: sw.val() || { open: false }, reports, titles: Object.fromEntries(titles), names: Object.fromEntries(names) };
}

export default function ProofsAdmin() {
  const { user, loading } = useAuth() || {};
  const founder = isFounder(user?.uid);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = useReliableLoad(async () => (user && founder ? readAll() : null), [user, founder]);
  const data = load.phase === 'ready' ? load.data : null;

  const flip = async (open) => {
    setBusy('switch'); setErr('');
    try { await set(ref(db, PROOFS_ACCESS_PATH), { open, changedAt: Date.now(), changedBy: user.uid }); await load.reload(); }
    catch (e) { setErr('Could not change the switch: ' + (e?.message || e)); }
    setBusy('');
  };
  const setStatus = async (id, status) => {
    if (!isReportId(id)) return;
    setBusy(id); setErr('');
    try { await update(ref(db, `${PROOF_REPORTS_PATH}/${id}`), { status, statusAt: serverTimestamp(), statusBy: user.uid }); await load.reload(); }
    catch (e) { setErr('Could not change the status: ' + (e?.message || e)); }
    setBusy('');
  };

  if (loading) return <div style={S.page}><div style={S.wrap} /></div>;
  if (!user || !founder) {
    return <div style={S.page}><div style={S.wrap}><h1 style={S.h1}>{C.adminTitle}</h1><p style={S.sub}>This page is for the founders.</p></div></div>;
  }
  const open = data?.access?.open === true;
  return (
    <div style={S.page}><div style={S.wrap}>
      <a href="/admin" style={{ ...S.quiet, textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' }}>← Admin</a>
      <h1 style={S.h1}>{C.adminTitle}</h1>
      <p style={S.sub}>{C.adminIntro}</p>
      {err && <div style={{ ...S.card, borderColor: 'rgba(224,87,79,0.5)', color: '#e0574f' }}>{err}</div>}
      <AdminLoad load={load} subject="Proofs" isEmpty={() => false}
        loading={<div style={S.card}><span style={S.quiet}>Loading…</span></div>}>
        {() => (
          <>
            <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }} data-proofs-switch={open ? 'open' : 'closed'}>
              <span style={{ fontSize: '1.05rem' }}>{open ? C.adminSwitchOpen : C.adminSwitchClosed}</span>
              <button type="button" style={S.ghost} disabled={busy === 'switch'} onClick={() => flip(!open)}>{open ? C.adminClose : C.adminOpen}</button>
            </div>
            {data.reports.length === 0 ? (
              <div style={S.card}><span style={S.quiet}>{C.adminEmpty}</span></div>
            ) : data.reports.map((r) => (
              <div key={r.id} style={S.card} data-report={r.id}>
                <div style={S.kind}>{C.status[r.status] || C.status.received}</div>
                <div style={{ fontSize: '1.15rem', marginTop: 4 }}>
                  <a href={`/proofs?story=${encodeURIComponent(r.slug)}`} style={{ color: '#f0ece4' }}>{data.titles[r.slug] || r.slug}</a>
                </div>
                <div style={S.quiet}>
                  {data.names[r.reporterUid] || r.reporterUid} · reported {when(r.createdAt)}
                  {r.goLiveAt ? ` · goes live ${londonWhen(r.goLiveAt)}, London time` : ''}
                </div>
                <p style={S.msg}>{r.message}</p>
                <div role="group" aria-label="Status" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {REPORT_STATUSES.map((st) => (
                    <button key={st} type="button" aria-pressed={r.status === st} disabled={busy === r.id}
                      style={{ ...S.ghost, ...(r.status === st ? S.on : null) }} onClick={() => setStatus(r.id, st)}>
                      {C.status[st]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </AdminLoad>
    </div></div>
  );
}
