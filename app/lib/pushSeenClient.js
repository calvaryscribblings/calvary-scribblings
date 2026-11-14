// P4-B3 — after a list writes seenAt, tell POST /api/push/seen, so the reader's phones clear their
// number too (functions/api/push/seen.js). Fire and forget, like notifyClient: nothing awaits it,
// nothing is shown, nothing throws. The endpoint is dormant until personal pushes are armed.

/**
 * @param {{ getIdToken?: () => Promise<string> }|null} [user]  the signed-in Firebase user (default: auth.currentUser)
 * @returns {Promise<boolean>} true only if the endpoint answered 200. Never throws.
 */
export async function tellSeen(user, { fetchImpl = (...a) => fetch(...a) } = {}) {
  try {
    let u = user;
    if (!u) {
      const { auth } = await import('./firebaseCore');
      u = auth?.currentUser || null;
    }
    if (!u?.getIdToken) return false;
    const token = await u.getIdToken();
    if (!token) return false;
    const res = await fetchImpl('/api/push/seen', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
