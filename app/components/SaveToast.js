'use client';
// THE SAVE TOAST — mounted once in Providers. The rules of it are app/lib/saveToast.js.
//
// The live region is ALWAYS in the DOM, empty when nothing shows: a region created at the same
// moment as its text is not reliably announced. Its time on screen pauses while it is hovered or
// holds focus, so a reader reaching for Undo is never raced by the timer.
//
// Motion: it rises 12px as it fades in; under Reduce Motion it only fades.
//
// z-index 10000: ABOVE the cookie banner (9999). On a first visit the banner covers the bottom
// of the screen, and a toast underneath it had an Undo nobody could press. It is on screen for
// five seconds; the banner is still there when it goes.

import { useEffect, useRef, useState } from 'react';
import { subscribeToast, dismissToast, currentToast, TOAST_MS } from '../lib/saveToast';

export default function SaveToast() {
  const [toast, setToast] = useState(() => currentToast());
  // Paused is remembered per toast, so a replacement starts its own clock unpaused.
  const [pausedId, setPausedId] = useState(null);
  const paused = !!toast && pausedId === toast.id;
  const timer = useRef(null);

  useEffect(() => subscribeToast(setToast), []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!toast || paused) return undefined;
    const id = toast.id;
    timer.current = setTimeout(() => dismissToast(id), TOAST_MS);
    return () => clearTimeout(timer.current);
  }, [toast, paused]);

  useEffect(() => {
    if (!toast) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') dismissToast(toast.id); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toast]);

  return (
    <div className="st-region" role="status" aria-live="polite" aria-atomic="true">
      <style>{`
        .st-region { position: fixed; left: 0; right: 0; z-index: 10000; pointer-events: none;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 84px); display: flex; justify-content: center; padding: 0 16px; }
        @media (min-width: 768px) { .st-region { bottom: 28px; } }
        .st-toast { pointer-events: auto; display: flex; align-items: center; gap: 18px; max-width: 420px; width: max-content;
          background: #06040e; color: #f5f0e8; border: 1px solid rgba(201,168,76,0.35); border-radius: 10px;
          padding: 12px 14px 12px 18px; box-shadow: 0 18px 44px -18px rgba(0,0,0,0.7);
          font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; line-height: 1.3;
          animation: st-in 220ms ease-out both; }
        .st-action { background: none; border: none; padding: 6px 4px; margin: -6px -4px; cursor: pointer; flex-shrink: 0;
          font-family: 'Cormorant Garamond', Georgia, serif; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.14em;
          text-transform: uppercase; color: #c9a84c; text-decoration: none; }
        .st-action:focus-visible { outline: 2px solid #c9a84c; outline-offset: 2px; border-radius: 2px; }
        @keyframes st-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes st-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .st-toast { animation-name: st-fade; } }
      `}</style>
      {toast && (
        <div key={toast.id} className="st-toast" data-testid="save-toast"
          onMouseEnter={() => setPausedId(toast.id)} onMouseLeave={() => setPausedId(null)}
          onFocus={() => setPausedId(toast.id)} onBlur={() => setPausedId(null)}>
          <span>{toast.message}</span>
          {toast.action?.href && (
            <a className="st-action" href={toast.action.href} onClick={() => dismissToast(toast.id)}>{toast.action.label}</a>
          )}
          {toast.action?.onClick && (
            <button type="button" className="st-action" onClick={toast.action.onClick}>{toast.action.label}</button>
          )}
        </div>
      )}
    </div>
  );
}
