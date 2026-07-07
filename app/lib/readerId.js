'use client';

// Stable per-reader identity for server-side read de-duplication.
//
// Prefers the signed-in Firebase uid so a read counts once across every device
// the reader is logged in on. Anonymous readers fall back to a random id kept in
// localStorage, so refreshing (or coming back later) still de-dupes on the same
// browser. functions/api/hit.js treats this purely as an opaque key: it only
// bumps stories/{slug}/hits the first time it sees a given (slug, readerId).
export async function getReaderId() {
  try {
    const { getApps } = await import('firebase/app');
    if (getApps().length) {
      const { getAuth } = await import('firebase/auth');
      const uid = getAuth(getApps()[0]).currentUser?.uid;
      if (uid) return uid;
    }
  } catch (e) {
    // firebase not ready — fall through to the anonymous localStorage id.
  }
  try {
    let id = localStorage.getItem('cs_reader_id');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('cs_reader_id', id);
    }
    return id;
  } catch (e) {
    // localStorage unavailable (private mode / SSR) — no stable id available.
    return null;
  }
}
