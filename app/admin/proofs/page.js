'use client';
// PROOFS — the editors' side (rulings 252–254, 258).
//
// · THE SWITCH (ruling 258). Proofs opens to the founder accounts only, until Ikenna opens it to
//   writers here. The server reads proofs_access on every /api/proofs call: nothing in a browser
//   decides it.
// · OPENING SENDS THE OPENING EMAILS (PROOFS-R3, ruling 290). "Open Proofs to writers" first shows
//   every account with the writer badge, each with its number of scheduled stories, ticked; a
//   founder unticks anyone who shouldn't be emailed, and confirming opens Proofs AND emails the
//   ticked writers, in one server step (/api/proofs/writers). The switch is server-written now,
//   so nothing here can open Proofs without the list. "Send me a sample" mails every writer email,
//   with invented stories, to the signed-in founder's own address. Words: app/lib/proofMail.js.
// · THE QUEUE. Reports writers filed from a proof, newest first. Founders change a report's
//   status (Received → Fixed / Left as it is); the rules let them write the three status fields
//   and nothing else. A report never holds a story back, and nothing here touches a story.
import { useState } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { useReliableLoad } from '../../lib/useReliable';
import AdminLoad from '../../components/AdminLoad';
import { ref, get, update, serverTimestamp } from 'firebase/database';
import { isFounder } from '../../lib/founders';
import { isId } from '../../lib/ids';
import { PROOFS_ACCESS_PATH, PROOF_REPORTS_PATH, PROOFS_COPY as C, REPORT_STATUSES, londonWhen, isProofSlug, isReportId } from '../../lib/proofs';
import { PROOF_MAIL_ADMIN_COPY as M } from '../../lib/proofMail';

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

async function readWriters(user) {
  // Who has been emailed lives server-side (proofs_mail is unreadable from any client).
  try {
    const res = await fetch('/api/proofs/writers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ action: 'list' }),
    });
    return res.ok ? (await res.json()).writers : null;
  } catch { return null; }
}

async function readAll(user) {
  const [sw, rs, writers] = await Promise.all([get(ref(db, PROOFS_ACCESS_PATH)), get(ref(db, PROOF_REPORTS_PATH)), readWriters(user)]);
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
  return { access: sw.val() || { open: false }, reports, writers, titles: Object.fromEntries(titles), names: Object.fromEntries(names) };
}

export default function ProofsAdmin() {
  const { user, loading } = useAuth() || {};
  const founder = isFounder(user?.uid);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = useReliableLoad(async () => (user && founder ? readAll(user) : null), [user, founder]);
  const data = load.phase === 'ready' ? load.data : null;

  const [list, setList] = useState(null);       // the opening list, while it is showing
  const [ticked, setTicked] = useState({});
  const [said, setSaid] = useState('');          // the last result line
  const call = async (body) => {
    const res = await fetch('/api/proofs/writers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  };
  const showList = async () => {
    setBusy('switch'); setErr(''); setSaid('');
    try {
      const j = await call({ action: 'list' });
      setList(j.writers);
      setTicked(Object.fromEntries(j.writers.map((w) => [w.uid, w.state === 'new' && w.hasAddress])));
    } catch (e) { setErr(M.openFailed + (e?.message || e)); }
    setBusy('');
  };
  const confirmOpen = async () => {
    setBusy('open'); setErr('');
    try {
      const include = list.filter((w) => ticked[w.uid]).map((w) => w.uid);
      const r = await call({ action: 'open', include });
      setSaid(M.opened(r.sent || 0, r.failed || 0)); setList(null); await load.reload();
    } catch (e) { setErr(M.openFailed + (e?.message || e)); }
    setBusy('');
  };
  const close = async () => {
    setBusy('switch'); setErr(''); setSaid('');
    try { await call({ action: 'close' }); await load.reload(); }
    catch (e) { setErr('Could not change the switch: ' + (e?.message || e)); }
    setBusy('');
  };
  const sample = async () => {
    setBusy('sample'); setErr(''); setSaid('');
    try { const r = await call({ action: 'sample' }); setSaid(M.sampleSent(r.sent || 0)); }
    catch (e) { setErr(M.sampleFailed + (e?.message || e)); }
    setBusy('');
  };
  const include = async (uid) => {
    setBusy(uid); setErr(''); setSaid('');
    try { const r = await call({ action: 'include', uid }); if (r.result !== 'sent') throw new Error(r.result); setSaid(M.included); await load.reload(); }
    catch (e) { setErr(M.includeFailed + (e?.message || e)); }
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
              <button type="button" style={S.ghost} disabled={busy === 'switch' || !!list} onClick={() => (open ? close() : showList())}>{open ? C.adminClose : C.adminOpen}</button>
            </div>
            {said && <div style={S.card} role="status">{said}</div>}
            {list && (
              <div style={S.card} data-proofs-opening-list>
                <div style={{ fontSize: '1.15rem' }}>{M.listHeading}</div>
                <p style={{ ...S.sub, margin: '6px 0 12px' }}>{M.listIntro}</p>
                {list.map((w) => {
                  const can = w.state !== 'opened' && w.hasAddress;
                  return (
                    <label key={w.uid} data-writer={w.uid} style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, borderTop: '1px solid rgba(240,236,228,0.08)' }}>
                      <input type="checkbox" disabled={!can} checked={can && !!ticked[w.uid]} onChange={(e) => setTicked((t) => ({ ...t, [w.uid]: e.target.checked }))} style={{ width: 20, height: 20 }} />
                      <span style={{ flex: 1 }}>{w.name}</span>
                      <span style={S.quiet}>{M.scheduledCount(w.scheduled)}{w.state === 'opened' ? ` · ${w.openingSent === false ? M.notDelivered : M.alreadyEmailed}` : !w.hasAddress ? ` · ${M.noAddress}` : ''}</span>
                    </label>
                  );
                })}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button type="button" style={{ ...S.ghost, ...S.on }} disabled={busy === 'open'} onClick={confirmOpen} data-proofs-confirm>
                    {busy === 'open' ? M.opening : M.confirm(list.filter((w) => w.state !== 'opened' && w.hasAddress && ticked[w.uid]).length)}
                  </button>
                  <button type="button" style={S.ghost} disabled={busy === 'open'} onClick={() => setList(null)}>{M.cancel}</button>
                </div>
              </div>
            )}
            {open && data.writers?.some((w) => w.state === 'excluded') && (
              <div style={S.card} data-proofs-excluded>
                <div style={{ fontSize: '1.05rem' }}>{M.excludedHeading}</div>
                <p style={{ ...S.quiet, margin: '4px 0 8px' }}>{M.excludedIntro}</p>
                {data.writers.filter((w) => w.state === 'excluded').map((w) => (
                  <div key={w.uid} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                    <span>{w.name} <span style={S.quiet}>· {M.scheduledCount(w.scheduled)}{w.hasAddress ? '' : ` · ${M.noAddress}`}</span></span>
                    <button type="button" style={S.ghost} disabled={busy === w.uid || !w.hasAddress} onClick={() => include(w.uid)}>{M.includeButton}</button>
                  </div>
                ))}
              </div>
            )}
            {open && data.writers?.some((w) => w.state === 'new' && !w.hasAddress) && (
              <div style={S.card} data-proofs-no-address>
                <div style={{ fontSize: '1.05rem' }}>{M.noAddress}</div>
                <p style={{ ...S.quiet, margin: '4px 0 8px' }}>{M.noAddressIntro}</p>
                {data.writers.filter((w) => w.state === 'new' && !w.hasAddress).map((w) => <div key={w.uid}>{w.name} <span style={S.quiet}>· {M.scheduledCount(w.scheduled)}</span></div>)}
              </div>
            )}
            <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }} data-proofs-sample>
              <span style={S.quiet}>{M.sampleHelp}</span>
              <button type="button" style={S.ghost} disabled={busy === 'sample'} onClick={sample}>{busy === 'sample' ? M.sampleSending : M.sampleButton}</button>
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
