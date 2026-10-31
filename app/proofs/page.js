'use client';
// PROOFS (rulings 249–258) — a writer's scheduled stories, each exactly as it will publish.
//
// · The page is a shell. It holds no story data; after sign-in it asks /api/proofs, which
//   verifies the ID token and answers with the caller's own proofs only (a founder: everyone's,
//   grouped by writer). While Proofs is closed a writer gets the empty state, like someone with
//   nothing scheduled.
// · A proof is drawn by the story page's own component (app/stories/[slug]/page-client.js) with
//   `proof` set, the path NotFoundOrLiveStory already uses to draw a story from API data. So the
//   hero, cover, byline and prose are the published page's, not a copy of them. Nothing is
//   counted and nothing social is drawn.
// · The proof band (fixed, bottom) carries the go-live time in London time and the one action:
//   Report a discrepancy. A report goes to /api/proofs/report; it never holds a story back.
// · One address: /proofs, and /proofs?story=<slug> for one proof.
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import AuthModal from '../components/AuthModal';
import { PROOFS_COPY as C, londonWhen, REPORT_MAX, REPORT_MIN } from '../lib/proofs';

const StoryPageClient = dynamic(() => import('../stories/[slug]/page-client'), { ssr: false });

const FF = 'Cormorant Garamond, Georgia, serif';
const INK = '#0a0a0a';
const PAPER = '#e8e0d4';
const GOLD = '#c9a84c';
const QUIET = 'rgba(232,224,212,0.6)';

async function call(user, path, body) {
  const idToken = await user.getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let data = {};
  try { data = await res.json(); } catch { /* an empty or non-JSON answer is a failure below */ }
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.code = data.code; throw e; }
  return data;
}

const storyFromUrl = () => {
  try { const s = new URLSearchParams(window.location.search).get('story'); return s && /^[A-Za-z0-9_-]{1,200}$/.test(s) ? s : null; } catch { return null; }
};

const CSS = `
  html, body { background: ${INK}; }
  .pf-page { min-height: 100vh; background: ${INK}; color: ${PAPER}; font-family: ${FF}; padding: 72px 16px 96px; }
  .pf-wrap { max-width: 720px; margin: 0 auto; }
  .pf-mast { display: block; font-family: ${FF}; font-size: 0.78rem; letter-spacing: 0.22em; text-transform: uppercase; color: ${GOLD}; text-decoration: none; margin: 0 0 28px; }
  .pf-h1 { font-family: ${FF}; font-weight: 400; font-size: 2.4rem; line-height: 1.1; margin: 0 0 10px; color: ${PAPER}; }
  .pf-intro { font-size: 1.12rem; line-height: 1.55; color: ${QUIET}; margin: 0 0 32px; }
  .pf-group { margin: 0 0 36px; }
  .pf-writer { font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: ${GOLD}; margin: 0 0 12px; padding: 0 0 8px; border-bottom: 1px solid rgba(201,168,76,0.25); }
  .pf-list { list-style: none; margin: 0; padding: 0; }
  .pf-item { margin: 0 0 12px; }
  .pf-card { display: grid; grid-template-columns: 64px 1fr; gap: 16px; align-items: center; width: 100%; padding: 12px; border: 1px solid rgba(232,224,212,0.12); border-radius: 10px; background: #121214; color: inherit; text-align: left; font: inherit; cursor: pointer; }
  .pf-card:hover, .pf-card:focus-visible { border-color: rgba(201,168,76,0.55); outline: none; }
  .pf-thumb { width: 64px; height: 96px; object-fit: cover; border-radius: 3px; background: #1d1d22; display: block; }
  .pf-title { font-size: 1.25rem; line-height: 1.25; margin: 0 0 6px; color: ${PAPER}; }
  .pf-when { font-size: 0.95rem; line-height: 1.4; color: ${QUIET}; margin: 0; }
  .pf-flag { display: inline-block; margin: 6px 0 0; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: ${GOLD}; }
  .pf-note { font-size: 1.05rem; line-height: 1.55; color: ${QUIET}; margin: 0 0 20px; }
  .pf-btn { font-family: ${FF}; font-size: 1rem; padding: 10px 18px; min-height: 44px; border-radius: 8px; border: 1px solid ${GOLD}; background: ${GOLD}; color: ${INK}; cursor: pointer; }
  .pf-btn[disabled] { opacity: 0.6; cursor: default; }
  .pf-ghost { font-family: ${FF}; font-size: 1rem; padding: 10px 18px; min-height: 44px; border-radius: 8px; border: 1px solid rgba(232,224,212,0.3); background: transparent; color: ${PAPER}; cursor: pointer; }

  /* The proof band: fixed to the bottom, above the story, below the sign-in modal. */
  /* Opaque, and on the story bar's own gutters (2rem; 1.2rem on a phone), so its text starts
     where the story's title does. */
  .pf-band { position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001; background: ${INK}; border-top: 1px solid rgba(201,168,76,0.4); padding: 10px 2rem calc(10px + env(safe-area-inset-bottom)); font-family: ${FF}; color: ${PAPER}; }
  .pf-band-row { display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; }
  .pf-band-text { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pf-band-label { font-size: 0.7rem; letter-spacing: 0.22em; text-transform: uppercase; color: ${GOLD}; }
  .pf-band-when { font-size: 1rem; line-height: 1.3; }
  .pf-band-actions { display: flex; gap: 8px; flex: 0 0 auto; }
  .pf-band-back { font-family: ${FF}; font-size: 0.95rem; color: ${QUIET}; text-decoration: none; padding: 10px 6px; min-height: 44px; display: inline-flex; align-items: center; background: none; border: 0; cursor: pointer; }
  body.pf-proofing { padding-bottom: 120px; }
  body.pf-proofing .back-to-top { bottom: calc(96px + env(safe-area-inset-bottom)); }
  @media (max-width: 640px) { .pf-band { padding-left: 1.2rem; padding-right: 1.2rem; } }
  @media (max-width: 520px) { .pf-band-actions { width: 100%; justify-content: space-between; } .pf-band-back { padding-left: 0; } }

  /* The report sheet. */
  .pf-scrim { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; justify-content: center; }
  .pf-sheet { width: 100%; max-width: 560px; max-height: 92vh; overflow: auto; background: #141417; color: ${PAPER}; font-family: ${FF}; border: 1px solid rgba(201,168,76,0.35); border-radius: 14px 14px 0 0; padding: 22px 16px calc(22px + env(safe-area-inset-bottom)); }
  @media (min-width: 640px) { .pf-scrim { align-items: center; } .pf-sheet { border-radius: 14px; padding: 26px 24px; } }
  .pf-sheet h2 { font-weight: 400; font-size: 1.6rem; margin: 0 0 8px; }
  .pf-sheet p { font-size: 1rem; line-height: 1.55; color: ${QUIET}; margin: 0 0 14px; }
  .pf-text { width: 100%; min-height: 140px; resize: vertical; font-family: ${FF}; font-size: 16px; line-height: 1.5; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(232,224,212,0.25); background: #0e0e10; color: ${PAPER}; }
  .pf-count { font-size: 0.85rem; color: ${QUIET}; text-align: right; margin: 4px 0 12px; }
  .pf-err { color: #e0574f; font-size: 0.98rem; margin: 0 0 12px; }
  .pf-ok { color: ${GOLD}; font-size: 1.02rem; margin: 0 0 14px; }
  .pf-actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
  .pf-reports { margin: 18px 0 0; padding: 14px 0 0; border-top: 1px solid rgba(232,224,212,0.12); }
  .pf-reports h3 { font-weight: 400; font-size: 0.75rem; letter-spacing: 0.18em; text-transform: uppercase; color: ${GOLD}; margin: 0 0 10px; }
  .pf-report { margin: 0 0 12px; }
  .pf-report-status { font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: ${GOLD}; }
  .pf-report-msg { font-size: 1rem; line-height: 1.5; color: ${PAPER}; margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

function latestStatus(reports, slug) {
  const r = reports.find((x) => x.slug === slug);
  return r ? C.status[r.status] || C.status.received : null;
}

function ProofCard({ s, reports, onOpen }) {
  const status = latestStatus(reports, s.slug);
  return (
    <li className="pf-item">
      <button type="button" className="pf-card" onClick={() => onOpen(s.slug)}>
        {/* A 64px thumbnail of a cover that already has its own sized derivative (w360): next/image
            has nothing to add in a static export. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s.cover ? <img className="pf-thumb" src={s.coverSizes?.w360 || s.cover} alt="" loading="lazy" /> : <span className="pf-thumb" aria-hidden="true" />}
        <span>
          <span className="pf-title" style={{ display: 'block' }}>{s.title}</span>
          <span className="pf-when" style={{ display: 'block' }}>{C.goesLive(londonWhen(s.goLiveMs))}</span>
          {status && <span className="pf-flag">{status}</span>}
        </span>
      </button>
    </li>
  );
}

function ReportSheet({ user, slug, reports, onClose, onFiled }) {
  const [text, setText] = useState('');
  const [state, setState] = useState('idle');   // idle | sending | sent
  const [err, setErr] = useState('');
  const trimmed = text.trim().length;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const send = async () => {
    if (trimmed < REPORT_MIN) { setErr(C.reportTooShort); return; }
    if (trimmed > REPORT_MAX) { setErr(C.reportTooLong); return; }
    setState('sending'); setErr('');
    try {
      await call(user, '/api/proofs/report', { slug, message: text });
      setState('sent'); setText('');
      onFiled();
    } catch (e) {
      setState('idle');
      setErr(e.code === 'rate_limited' ? C.reportRateLimited : e.code === 'too_short' ? C.reportTooShort : e.code === 'too_long' ? C.reportTooLong : C.reportFailed);
    }
  };
  return (
    <div className="pf-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-sheet" role="dialog" aria-modal="true" aria-labelledby="pf-report-h">
        <h2 id="pf-report-h">{C.reportHeading}</h2>
        <p>{C.reportHelp}</p>
        {state === 'sent' && <p className="pf-ok" role="status">{C.reportSent}</p>}
        <label htmlFor="pf-report-text" style={{ position: 'absolute', left: -9999 }}>{C.reportHeading}</label>
        <textarea id="pf-report-text" className="pf-text" value={text} maxLength={REPORT_MAX + 200}
          placeholder={C.reportPlaceholder} onChange={(e) => { setText(e.target.value); if (state === 'sent') setState('idle'); }} />
        <div className="pf-count" aria-live="polite">{trimmed} / {REPORT_MAX}</div>
        {err && <p className="pf-err" role="alert">{err}</p>}
        <div className="pf-actions">
          <button type="button" className="pf-ghost" onClick={onClose}>{C.reportCancel}</button>
          <button type="button" className="pf-btn" onClick={send} disabled={state === 'sending'}>{state === 'sending' ? C.reportSending : C.reportSend}</button>
        </div>
        {reports.length > 0 && (
          <div className="pf-reports">
            <h3>{C.yourReports}</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {reports.map((r) => (
                <li key={r.id} className="pf-report">
                  <span className="pf-report-status">{C.status[r.status] || C.status.received}</span>
                  <p className="pf-report-msg">{r.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Proof({ user, slug, onBack }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(null);
  const [sheet, setSheet] = useState(false);
  const params = useMemo(() => Promise.resolve({ slug }), [slug]);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    call(user, '/api/proofs', { action: 'proof', slug })
      .then((d) => { if (live) { setData(d); setFailed(null); } })
      .catch((e) => { if (live) setFailed(e.status === 404 ? 'notFound' : 'failed'); });
    return () => { live = false; };
  }, [user, slug, attempt]);
  useEffect(() => {
    document.body.classList.add('pf-proofing');
    return () => document.body.classList.remove('pf-proofing');
  }, []);
  useEffect(() => { if (data?.story?.title) document.title = `${C.proofLabel}: ${data.story.title} — Calvary Scribblings`; }, [data]);

  if (failed) {
    return (
      <div className="pf-page"><div className="pf-wrap">
        <p className="pf-note">{failed === 'notFound' ? C.notFound : C.failed}</p>
        <div className="pf-actions" style={{ justifyContent: 'flex-start' }}>
          {failed === 'failed' && <button type="button" className="pf-btn" onClick={load}>{C.retry}</button>}
          <button type="button" className="pf-ghost" onClick={onBack}>{C.back}</button>
        </div>
      </div></div>
    );
  }
  if (!data) return <div className="pf-page"><div className="pf-wrap"><p className="pf-note" role="status">{C.loading}</p></div></div>;

  const { story, goLiveMs, reports } = data;
  const { slug: _s, ...meta } = story;
  const initialStory = { id: slug, ...meta, contentIsPreview: false, lockAtMs: null, previewLockAtMs: null, previewHtml: null };
  return (
    <>
      <StoryPageClient params={params} initialStory={initialStory} proof={{ goLiveMs }} />
      <div className="pf-band" role="region" aria-label={C.proofLabel}>
        <div className="pf-band-row">
          <div className="pf-band-text">
            <span className="pf-band-label">{C.proofLabel}</span>
            <span className="pf-band-when">{C.goesLive(londonWhen(goLiveMs))}</span>
          </div>
          <div className="pf-band-actions">
            <button type="button" className="pf-band-back" onClick={onBack}>← {C.back}</button>
            <button type="button" className="pf-btn" onClick={() => setSheet(true)}>{C.reportButton}</button>
          </div>
        </div>
      </div>
      {sheet && <ReportSheet user={user} slug={slug} reports={reports || []} onClose={() => setSheet(false)} onFiled={load} />}
    </>
  );
}

export default function ProofsPage() {
  const { user, loading } = useAuth() || {};
  const [slug, setSlug] = useState(null);
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [signIn, setSignIn] = useState(false);

  useEffect(() => {
    // The address is read after mount (the shell is prerendered without it), on the next tick.
    const onPop = () => setSlug(storyFromUrl());
    queueMicrotask(onPop);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [attempt, setAttempt] = useState(0);
  const loadList = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!user || slug) return undefined;
    let live = true;
    call(user, '/api/proofs', { action: 'list' })
      .then((d) => { if (live) { setList(d); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [user, slug, attempt]);

  const open = (s) => { window.history.pushState(null, '', `/proofs?story=${encodeURIComponent(s)}`); setSlug(s); window.scrollTo(0, 0); };
  const back = () => { window.history.pushState(null, '', '/proofs'); setSlug(null); window.scrollTo(0, 0); };

  let body;
  if (loading) body = <p className="pf-note" role="status">{C.loading}</p>;
  else if (!user) {
    body = (
      <>
        <h1 className="pf-h1">{C.pageTitle}</h1>
        <p className="pf-intro">{C.signedOut}</p>
        <button type="button" className="pf-btn" onClick={() => setSignIn(true)}>{C.signIn}</button>
      </>
    );
  } else if (slug) {
    return (<><style>{CSS}</style><Proof user={user} slug={slug} onBack={back} /></>);
  } else if (failed) {
    body = (
      <>
        <h1 className="pf-h1">{C.pageTitle}</h1>
        <p className="pf-note">{C.failed}</p>
        <button type="button" className="pf-btn" onClick={loadList}>{C.retry}</button>
      </>
    );
  } else if (!list) body = (<><h1 className="pf-h1">{C.pageTitle}</h1><p className="pf-note" role="status">{C.loading}</p></>);
  else {
    const { founder, stories, groups, reports } = list;
    body = (
      <>
        <h1 className="pf-h1">{C.pageTitle}</h1>
        <p className="pf-intro">{founder ? C.founderIntro : C.intro}</p>
        {stories.length === 0 ? <p className="pf-note">{C.empty}</p>
          : founder ? groups.map((g) => (
            <section key={g.authorUid || 'none'} className="pf-group">
              <h2 className="pf-writer">{g.author || g.authorUid || '—'}</h2>
              <ul className="pf-list">{g.stories.map((s) => <ProofCard key={s.slug} s={s} reports={reports} onOpen={open} />)}</ul>
            </section>
          ))
          : <ul className="pf-list">{stories.map((s) => <ProofCard key={s.slug} s={s} reports={reports} onOpen={open} />)}</ul>}
      </>
    );
  }

  return (
    <div className="pf-page">
      <style>{CSS}</style>
      <div className="pf-wrap">
        <Link href="/" className="pf-mast">Calvary Scribblings</Link>
        {body}
      </div>
      {signIn && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={(e) => { if (e.target === e.currentTarget) setSignIn(false); }}>
          <AuthModal onClose={() => setSignIn(false)} />
        </div>
      )}
    </div>
  );
}
