'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db } from './firebase';

const AuthContext = createContext(null);

const SUSPENDED_MESSAGE =
  'This account is scheduled for deletion. To recover it, email Ikennaworksfromhome@gmail.com from the email address on the account.';

// The isDeleted probe below is the ONLY thing standing between onAuthStateChanged firing
// and setLoading(false). RTDB's get() has no default timeout: offline with no cached value,
// or on a network that accepts the connection and then stalls, the promise can simply never
// settle. The surrounding try/catch does not help — a catch only runs if the promise
// SETTLES, and a hung promise never rejects. `loading` then stays true forever and every
// surface gated on it renders nothing. /my-library is the sharpest case (both its signed-out
// gate and its signed-in body sit behind `!loading`), so the offline shelf — the entire point
// of Round 2 — would never paint.
//
// The bound below closes that. It changes NO semantics: the existing catch already treats an
// unreadable isDeleted flag as "not deleted, proceed", with the cron worker as the durable
// backstop for hard-delete. This only widens "unreadable" to include "did not answer in 3s".
// A soft-deleted account whose flag reads true within the window is signed out exactly as
// before; one whose flag times out gets in, and is caught on the next load or by the cron —
// which is precisely the trade the catch block already made.
//
// It is also an improvement ONLINE: on a flaky connection the old code left the whole site
// stuck on its loading state until the socket gave up on its own schedule.
const IS_DELETED_TIMEOUT_MS = 3000;
const TIMED_OUT = Symbol('timeout');

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); }),
  ]);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // When non-null, the most recent sign-in attempt landed on a soft-deleted
  // account and we forced sign-out. AuthModal can read this to show feedback.
  const [signOutReason, setSignOutReason] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) { setUser(null); setLoading(false); return; }
      try {
        const snap = await withTimeout(get(ref(db, `users/${u.uid}/isDeleted`)), IS_DELETED_TIMEOUT_MS);
        if (snap !== TIMED_OUT && snap.exists() && snap.val() === true) {
          await signOut(auth);
          setUser(null);
          setSignOutReason(SUSPENDED_MESSAGE);
          setLoading(false);
          return;
        }
      } catch {
        // If the read fails, fall through and treat as normal sign-in.
        // The cron worker is the durable backstop for hard-delete.
      }
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const logout = () => signOut(auth);
  const clearSignOutReason = () => setSignOutReason(null);

  return (
    <AuthContext.Provider value={{ user, loading, logout, signOutReason, clearSignOutReason }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export { SUSPENDED_MESSAGE };
