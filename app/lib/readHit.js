'use client';
// THE WEBSITE COUNTS A READ ONCE, AFTER SIGN-IN SETTLES (W49 §2, ruling 180).
//
// The story page and the story reader each fire their own hit, so whatever identity they send
// must be the same one. Before W49 the identity was auth.currentUser at the moment of the hit,
// which is often null for a signed-in reader whose session is still being restored. They were
// counted once under the device id and again under the uid. Now both wait for Firebase Auth to
// SETTLE (authStateReady, or the first auth callback where that is missing), then send:
//
//   signed in:   Authorization: Bearer <ID token>   — the server takes the uid from it
//   signed out:  { readerId: <device id> }           — never "null"
//
// sendInstalmentRead is the Series reader's half (functions/api/series/read.js): signed in only.
import { getReaderId } from './readerId.js';

/** The signed-in user once Auth has settled, or null. Never the half-restored state. */
export async function settledUser(auth) {
  if (!auth) return null;
  if (typeof auth.authStateReady === 'function') await auth.authStateReady();
  else {
    const { onAuthStateChanged } = await import('firebase/auth');
    await new Promise((resolve) => { const off = onAuthStateChanged(auth, () => { off(); resolve(); }); });
  }
  return auth.currentUser || null;
}

/** POST /api/hit for a story. Resolves to { count, counted } or null. Never throws. */
export async function sendReadHit(slug, auth, { fetchImpl = (...a) => fetch(...a) } = {}) {
  try {
    const user = await settledUser(auth);
    const headers = { 'Content-Type': 'application/json' };
    // `client: 'web'` so this call is ATTRIBUTED. Everything unattributed in story_clients is read
    // as the un-migrated app fleet (functions/api/_telemetry.js).
    const body = { slug, client: 'web' };
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
    else {
      const id = getReaderId();
      if (id) body.readerId = id;
    }
    // The slug rides in the query as well: older deployments read it from there.
    const res = await fetchImpl(`/api/hit?slug=${encodeURIComponent(slug)}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** POST /api/series/read for an instalment. Signed in only. Resolves to { count, counted } or null. */
export async function sendInstalmentRead(inst, user, { fetchImpl = (...a) => fetch(...a) } = {}) {
  try {
    if (!user || !inst) return null;
    const res = await fetchImpl('/api/series/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ inst }),
    });
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}
