'use client';
import { useState, useEffect } from 'react';
import { ref, get } from 'firebase/database';
import { db } from './firebase';
import { useAuth } from './AuthContext';

export function useUserStoryTiers() {
  const { user } = useAuth();
  const [tiersMap, setTiersMap] = useState({});

  useEffect(() => {
    if (!user) { setTiersMap({}); return; }
    (async () => {
      try {
        const snap = await get(ref(db, `userStoryTiers/${user.uid}`));
        setTiersMap(snap.exists() ? snap.val() : {});
      } catch(e) {
        console.warn('useUserStoryTiers: fetch failed', e);
      }
    })();
  }, [user?.uid]);

  return tiersMap;
}
