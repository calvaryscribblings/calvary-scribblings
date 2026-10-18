'use client';

// W53 — the signed-in reader's mute and block lists, live, and the two switches.
// The words and the decisions are in app/lib/squareSafety.js.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ref, onValue, set, remove } from 'firebase/database';
import { db } from '../../lib/firebaseCore';
import { hiddenUids } from '../../lib/squareSafety';

export default function useSafety(uid) {
  // Each list remembers whose it is, so a sign-out or a change of reader shows nothing stale.
  const [mutedOf, setMutedOf] = useState({ uid: null, list: {} });
  const [blockedOf, setBlockedOf] = useState({ uid: null, list: {} });
  const muted = useMemo(() => (mutedOf.uid === uid ? mutedOf.list : {}), [mutedOf, uid]);
  const blocked = useMemo(() => (blockedOf.uid === uid ? blockedOf.list : {}), [blockedOf, uid]);

  useEffect(() => {
    if (!uid) return undefined;
    // A list that can't be read is treated as empty: the reader sees everything, never less.
    const offM = onValue(ref(db, `muted_users/${uid}`), (s) => setMutedOf({ uid, list: s.val() || {} }), () => setMutedOf({ uid, list: {} }));
    const offB = onValue(ref(db, `blocked_users/${uid}`), (s) => setBlockedOf({ uid, list: s.val() || {} }), () => setBlockedOf({ uid, list: {} }));
    return () => { offM(); offB(); };
  }, [uid]);

  const hidden = useMemo(() => hiddenUids(muted, blocked), [muted, blocked]);

  const toggle = useCallback(async (node, other, on, setLocal) => {
    if (!uid || !other || other === uid) return;
    // Optimistic, and put back if the write is refused.
    const flip = (add) => setLocal((cur) => { const n = { ...(cur.uid === uid ? cur.list : {}) }; if (add) n[other] = true; else delete n[other]; return { uid, list: n }; });
    flip(on);
    try {
      const r = ref(db, `${node}/${uid}/${other}`);
      if (on) await set(r, true); else await remove(r);
    } catch (e) {
      console.error(`${node} change failed:`, e);
      flip(!on);
      throw e;
    }
  }, [uid]);

  const setMute = useCallback((other, on) => toggle('muted_users', other, on, setMutedOf), [toggle]);
  const setBlock = useCallback((other, on) => toggle('blocked_users', other, on, setBlockedOf), [toggle]);

  return {
    hidden, setMute, setBlock,
    isMuted: (o) => muted[o] === true,
    isBlocked: (o) => !!blocked[o],
  };
}
