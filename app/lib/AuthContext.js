'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';

const AuthContext = createContext(null);

// `loading` is true until Firebase Auth has answered once, and every surface that differs
// signed-in vs signed-out waits on it. It waits on NOTHING else: the isDeleted probe that used
// to sit here (a 3-second race against an RTDB read, for the 7-day soft-delete) is gone with
// the soft delete itself. Account deletion is immediate — POST /api/account/delete removes the
// Auth account — so a deleted reader cannot sign in at all and there is no flag to check.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
