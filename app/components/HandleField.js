'use client';
// THE HANDLE FIELD — one field, one check, one set of words, wherever a handle is chosen: email
// signup (AuthModal), the completion step after a first Google sign-in (ProfileCompletion), and
// a rename on /profile. The rules and copy are app/lib/handle.js.
//
// The input's look comes from the host (`inputClassName`), so it sits in each surface's own
// form; the @ prefix and the status line are styled here.

import { useEffect, useState } from 'react';
import { checkHandle, handleStatusLine, normaliseHandle, HANDLE_COPY, HANDLE_MAX } from '../lib/handle';

/** Who holds usernames/{handle}? World-readable; null when nobody does. */
export async function readHandleOwner(handle) {
  const [{ getApp }, { getDatabase, ref, get }] = await Promise.all([import('firebase/app'), import('firebase/database')]);
  const snap = await get(ref(getDatabase(getApp()), `usernames/${handle}`));
  return snap.exists() ? snap.val() : null;
}

/**
 * The live availability check: 400ms after the last keystroke, only the latest answer shown.
 * A check that could not run reads as 'unknown', never as taken. `uid` makes a handle this reader
 * already holds read as available (a rename to their own handle, or a reserved one they keep).
 */
export function useHandleCheck(handle, { uid = null, enabled = true } = {}) {
  const [check, setCheck] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    if (!handle) { setCheck(null); return; }
    let live = true;
    setCheck({ state: 'checking', handle: normaliseHandle(handle) });
    const t = setTimeout(async () => {
      const r = await checkHandle(handle, readHandleOwner, { uid });
      if (live) setCheck(r);
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [handle, uid, enabled]);
  return [check, setCheck];
}

export default function HandleField({ id = 'handle', value, onChange, check, inputClassName, labelClassName, hintClassName, label = HANDLE_COPY.label }) {
  const line = handleStatusLine(check);
  return (
    <>
      <style>{`
        .hf-wrap { position: relative; }
        .hf-at {
          position: absolute; left: 0.95rem; top: 50%; transform: translateY(-50%);
          color: rgba(255,255,255,0.32); font-size: 0.92rem; pointer-events: none;
          font-family: 'Cormorant Garamond', Georgia, serif;
        }
        input.hf-input { padding-left: 1.75rem; }
        .hf-help { color: rgba(255,255,255,0.42) !important; }
        .hf-status {
          font-size: 0.74rem; margin-top: 0.35rem; min-height: 1.1em;
          font-family: 'Cormorant Garamond', Georgia, serif;
        }
        .hf-status[data-tone='good'] { color: #86efac; }
        .hf-status[data-tone='bad'] { color: #fca5a5; }
        .hf-status[data-tone='quiet'] { color: rgba(255,255,255,0.4); font-style: italic; }
      `}</style>
      <label className={labelClassName} htmlFor={id}>{label}</label>
      <div className="hf-wrap">
        <span className="hf-at" aria-hidden="true">@</span>
        <input
          id={id}
          className={`${inputClassName || ''} hf-input`}
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          placeholder="yourhandle"
          maxLength={HANDLE_MAX + 1}
          value={value}
          onChange={(e) => onChange(normaliseHandle(e.target.value))}
          aria-describedby={`${id}-help ${id}-status`}
        />
      </div>
      <div className={`${hintClassName || ''} hf-help`} id={`${id}-help`}>{HANDLE_COPY.helper}</div>
      <div className="hf-status" id={`${id}-status`} role="status" aria-live="polite" data-tone={line?.tone || 'quiet'}>
        {line?.text || ''}
      </div>
    </>
  );
}
