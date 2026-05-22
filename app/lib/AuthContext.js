'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db } from './firebase';

const AuthContext = createContext(null);

const SUSPENDED_MESSAGE =
  'This account is scheduled for deletion. To recover it, email Ikennaworksfromhome@gmail.com from the email address on the account.';

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
        const snap = await get(ref(db, `users/${u.uid}/isDeleted`));
        if (snap.exists() && snap.val() === true) {
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
