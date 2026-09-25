'use client';
// W4 — the founder-only preview of the 30 September gate: the toggle (in /admin) and the banner
// that says it is on (everywhere, for the founder who turned it on). Neither renders anything
// for any other account. See app/lib/gatePreview.js.

import { useEffect, useRef, useState } from 'react';
import { boxesClash } from '../lib/archiveLock';
import { useAuth } from '../lib/AuthContext';
import { useGatePreview, useGatePreviewState, setGatePreview } from '../lib/gatePreview';
import { isFounder } from '../lib/founders';
import { gatingOn } from '../lib/storyAccess';
import { LAUNCH_DATE_LABEL, LAUNCH_DATE_SHORT } from '../lib/launch';

const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

export function GatePreviewToggle() {
  const { user } = useAuth() || {};
  const { on, known } = useGatePreviewState(user);
  // W4b: the switch waits for the ACCOUNT write, and says so when it fails, rather than showing a
  // state the story pages would not honour.
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!isFounder(user?.uid) || gatingOn()) return null;
  const flip = async () => {
    setBusy(true); setFailed(false);
    try { await setGatePreview(!on, user); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return (
    <div style={{ margin: '0 0 1rem', padding: '0.9rem 1rem', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 10, background: 'rgba(201,168,76,0.07)' }}>
      <div style={{ fontFamily: LABEL, fontSize: 11, letterSpacing: '0.18em', color: '#e2c876' }}>{`FOUNDER PREVIEW — THE SITE AFTER ${LAUNCH_DATE_LABEL.toUpperCase()}`}</div>
      <p style={{ margin: '0.45rem 0 0.7rem', fontSize: 14, lineHeight: 1.55, color: '#e6ddce' }}>
        Shows this browser the archive gate and the Series tier gate as they will be after the
        switch, at today&rsquo;s date: this week&rsquo;s stories stay free, older ones show their
        preview and the locked panel. It follows your account, on every device you are signed in
        on. Nobody else is affected.
      </p>
      <button type="button" onClick={flip} disabled={busy || !known} aria-pressed={known ? on : undefined}
        style={{ fontFamily: LABEL, fontSize: 11, letterSpacing: '0.16em', padding: '0.55rem 1rem', borderRadius: 8, border: '1px solid #c9a84c', background: on ? 'transparent' : '#c9a84c', color: on ? '#f0dda0' : '#241a06', cursor: 'pointer' }}>
        {!known ? 'CHECKING…' : on ? 'TURN THE PREVIEW OFF' : 'TURN THE PREVIEW ON'}
      </button>
      {failed && (
        <p role="alert" style={{ margin: '0.6rem 0 0', fontSize: 13, color: '#f2b8a8' }}>
          That didn&rsquo;t save. Check your connection and try again.
        </p>
      )}
    </div>
  );
}

export default function GatePreviewBanner() {
  const { user } = useAuth() || {};
  const on = useGatePreview(user);
  const ref = useRef(null);
  // W9: never over the lock. The pill's RESTING box (left 12, bottom 12 — transforms aside) is
  // compared with every lock block on each scroll frame; on a clash the pill leaves AT ONCE (in
  // the frame the check runs, before paint — a 220ms slide-away was caught touching the lock on
  // live) and slides back once the block has passed.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0, aside = false;
    const check = () => {
      raf = 0;
      const w = el.offsetWidth, h = el.offsetHeight, vh = window.innerHeight;
      const rest = { left: 12, right: 12 + w, top: vh - 12 - h, bottom: vh - 12 };
      const clash = [...document.querySelectorAll('[data-archive-lock]')].some((b) => boxesClash(rest, b.getBoundingClientRect()));
      if (clash !== aside) { aside = clash; el.setAttribute('data-aside', clash ? '1' : '0'); }
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    // A lock can arrive after the pill (the gate answers after paint) — watch for it.
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { window.removeEventListener('scroll', queue); window.removeEventListener('resize', queue); mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [on]);
  if (!on || gatingOn()) return null;
  return (
    <div ref={ref} role="status" data-founder-pill="" data-aside="0" className="founder-pill" style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 900, display: 'flex', gap: 10, alignItems: 'center', padding: '0.5rem 0.8rem', borderRadius: 999, background: '#241a06', border: '1px solid #c9a84c', color: '#f0dda0', fontFamily: LABEL, fontSize: 10.5, letterSpacing: '0.14em' }}>
      <style>{`.founder-pill { transition: transform 220ms ease, opacity 220ms ease; }
        .founder-pill[data-aside="1"] { transform: translateY(calc(100% + 24px)); opacity: 0; pointer-events: none; transition: none; }
        @media (prefers-reduced-motion: reduce) { .founder-pill { transition: none; } }`}</style>
      {`FOUNDER PREVIEW · AFTER ${LAUNCH_DATE_SHORT.toUpperCase()}`}
      <button type="button" onClick={() => { setGatePreview(false, user).catch(() => {}); }}
        style={{ fontFamily: LABEL, fontSize: 10, letterSpacing: '0.14em', background: 'transparent', border: 'none', color: '#c9a84c', cursor: 'pointer', textDecoration: 'underline' }}>
        TURN OFF
      </button>
    </div>
  );
}
