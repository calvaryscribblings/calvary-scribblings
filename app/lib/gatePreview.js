'use client';
// THE FOUNDER-ONLY PREVIEW OF THE 30 SEPTEMBER GATE — W4, made account-wide in W4b.
//
// So Ikenna can walk the site as it will be after the switch, before it. A founder turns it on
// in /admin; from then story pages and Series pages render the gate early — at the REAL current
// time, so this week's stories stay free exactly as they will on the day.
//
// ── WHERE THE FLAG LIVES (W4b) ───────────────────────────────────────────────────────
// On the ACCOUNT: founder_preview/{uid} = true (rules: that founder alone reads and writes it).
// /api/story and /api/series/stream read it themselves from the verified uid, so a story page
// locks whatever this browser remembers — a Home Screen copy of the site, another browser, an
// old tab. See app/lib/gatePreviewPolicy.js for why the browser-only flag of W4 was not enough.
//
// localStorage keeps a COPY, for one reason: the story page's inline script runs before paint,
// before Firebase, and can only read something synchronous. The copy is refreshed from the
// account whenever a founder is signed in, so it can go stale only until the next page load.
//
// It changes nothing for anyone else, three times over:
//   · the toggle is drawn only for a founder account;
//   · this hook answers true only when the signed-in uid is a founder;
//   · the endpoints honour it only for a founder uid, verified from the ID token — and it can
//     only ever LOCK, never unlock.

import { useEffect, useState } from 'react';
import { isFounder } from './founders.js';
import { founderPreviewPath } from './gatePreviewPolicy.js';

export const GATE_PREVIEW_KEY = 'cs:gatePreview';
const EVENT = 'cs:gatePreview';

export function readGatePreview() {
  try { return window.localStorage.getItem(GATE_PREVIEW_KEY) === '1'; } catch { return false; }
}

function writeLocalCopy(on) {
  try {
    if (on) window.localStorage.setItem(GATE_PREVIEW_KEY, '1');
    else window.localStorage.removeItem(GATE_PREVIEW_KEY);
  } catch { /* the account flag still holds; only the pre-paint lock is lost */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

async function accountRef(uid) {
  const [{ getDatabase, ref }, { default: app }] = await Promise.all([
    import('firebase/database'),
    import('./firebaseCore.js'),
  ]);
  return ref(getDatabase(app), founderPreviewPath(uid));
}

/**
 * Turn the preview on or off for this founder, on the account and in this browser.
 * Resolves when the ACCOUNT write has landed; rejects if it failed, so the toggle can say so
 * rather than show a state the story pages will not honour.
 */
export async function setGatePreview(on, user) {
  const uid = user?.uid;
  if (!isFounder(uid)) { writeLocalCopy(false); return; }
  const { set, remove } = await import('firebase/database');
  const r = await accountRef(uid);
  if (on) await set(r, true); else await remove(r);
  writeLocalCopy(on);
}

/** Pure: is the preview in force for this uid, given what is stored? */
export const gatePreviewActive = (uid, stored) => stored === true && isFounder(uid);

/** True only for a signed-in founder who has turned the preview on. */
export function useGatePreview(user) {
  return useGatePreviewState(user).on;
}

/**
 * { on, known }. `known` turns true once the ACCOUNT's value has arrived (or could not be read),
 * so the /admin switch never offers "turn on" for a preview that is already on — a tap in that
 * moment would flip it the wrong way.
 */
export function useGatePreviewState(user) {
  const uid = user?.uid || null;
  const [stored, setStored] = useState(false);
  const [known, setKnown] = useState(false);
  useEffect(() => {
    const sync = () => setStored(readGatePreview());
    const first = setTimeout(sync, 0);
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { clearTimeout(first); window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  // The account is the authority: follow it, and keep the local copy in step with it.
  useEffect(() => {
    if (!isFounder(uid)) return undefined;
    let off = null;
    let cancelled = false;
    (async () => {
      try {
        const { onValue } = await import('firebase/database');
        const r = await accountRef(uid);
        if (cancelled) return;
        off = onValue(r, (snap) => {
          const on = snap.val() === true;
          if (on !== readGatePreview()) writeLocalCopy(on);
          setStored(on);
          setKnown(true);
        }, () => { setKnown(true); /* unreadable: keep the local copy's answer */ });
      } catch { setKnown(true); /* keep the local copy's answer */ }
    })();
    return () => { cancelled = true; if (off) off(); };
  }, [uid]);
  return { on: gatePreviewActive(uid, stored), known: known || !isFounder(uid) };
}
