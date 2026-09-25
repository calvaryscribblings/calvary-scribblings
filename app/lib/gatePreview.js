'use client';
// THE FOUNDER-ONLY PREVIEW OF THE 30 SEPTEMBER GATE — W4.
//
// So Ikenna can walk the site as it will be after the switch, before it. A founder turns it on
// in /admin; from then, on that browser, story pages and Series pages ask the endpoints with
// `previewGate: true`, and the endpoints apply the gate early — at the REAL current time, so
// this week's stories stay free exactly as they will on the day.
//
// It changes nothing for anyone else, three times over:
//   · the toggle is drawn only for a founder account;
//   · this hook answers true only when the signed-in uid is a founder;
//   · /api/story and /api/series/stream honour previewGate only for a founder uid, verified
//     from the ID token — and it can only ever LOCK, never unlock.

import { useEffect, useState } from 'react';
import { isFounder } from './founders.js';

export const GATE_PREVIEW_KEY = 'cs:gatePreview';
const EVENT = 'cs:gatePreview';

export function readGatePreview() {
  try { return window.localStorage.getItem(GATE_PREVIEW_KEY) === '1'; } catch { return false; }
}

export function setGatePreview(on) {
  try {
    if (on) window.localStorage.setItem(GATE_PREVIEW_KEY, '1');
    else window.localStorage.removeItem(GATE_PREVIEW_KEY);
  } catch { /* private mode: the preview simply stays off */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

/** Pure: is the preview in force for this uid, given what is stored? */
export const gatePreviewActive = (uid, stored) => stored === true && isFounder(uid);

/** True only for a signed-in founder who has turned the preview on, on this browser. */
export function useGatePreview(user) {
  const [stored, setStored] = useState(false);
  useEffect(() => {
    const sync = () => setStored(readGatePreview());
    const first = setTimeout(sync, 0);
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { clearTimeout(first); window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return gatePreviewActive(user?.uid || null, stored);
}
