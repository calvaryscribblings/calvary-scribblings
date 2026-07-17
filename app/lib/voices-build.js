// Build-time reads of cms_voices, for the server components under app/voices.
//
// SERVER ONLY. Deliberately does not import app/lib/firebase.js: that module calls
// getAuth()/getStorage() at import time, which pulls browser-only surface into a Node
// build. This initialises the same project with only the pieces a build needs.
//
// Why the pages seed at all — the morph (Phase 3) needs its target element to exist at
// the first paint of the new document. Both pages used to render their images only after
// a client-side read, so the browser found no matching view-transition-name and cut
// instead of morphing. Seeding also removes the hero's layout shift and gives direct and
// social traffic a painted page. The client still re-reads cms_voices on mount, so the
// CMS stays live truth; the seed is the opening frame, not the source of record. Every
// mutation fires the deploy hook, so the seed is never stale for long.
import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

function buildDB() {
  return getDatabase(getApps().length ? getApps()[0] : initializeApp(FB));
}

// The whole roster, keyed by slug, exactly as stored. Callers filter — generateStaticParams
// wants every slug including drafts, the grid wants published only.
// A failed read returns {} rather than throwing: a Firebase blip should degrade the build
// to an unseeded page, not fail the deploy outright.
export async function fetchVoicesNode() {
  try {
    const snap = await get(ref(buildDB(), 'cms_voices'));
    return snap.exists() ? snap.val() || {} : {};
  } catch (e) {
    console.error('voices build read: cms_voices fetch failed', e);
    return {};
  }
}

export async function fetchVoice(slug) {
  try {
    const snap = await get(ref(buildDB(), `cms_voices/${slug}`));
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    console.error(`voices build read: cms_voices/${slug} fetch failed`, e);
    return null;
  }
}
