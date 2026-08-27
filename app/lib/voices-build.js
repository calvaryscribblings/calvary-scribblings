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
import { buildRead } from './build-read.mjs';

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
//
// ⛔ PL-12 — THIS USED TO RETURN {} ON A FAILED READ, and the comment that stood here said "a
// Firebase blip should degrade the build to an unseeded page, not fail the deploy outright."
// That was wrong about what it degraded to. /voices is a CLIENT-SIDE LIVE QUERY and would ship
// listing every voice; /voices/[slug] is STATIC and enumerated from this read, so {} emits the
// sentinel and nothing else. Every name on the roster would link to a 404 — the same shape as
// the bookstore's shelf-without-detail-pages, which is the failure PL-12 exists to prevent.
//
// It is also memoised now. generateStaticParams and both seeded pages wanted the same roster.
let _voicesNode;
export function fetchVoicesNode() {
  if (!_voicesNode) {
    _voicesNode = buildRead(
      'cms_voices',
      '/voices/[slug] — the page for every voice the roster links to',
      async () => {
        const snap = await get(ref(buildDB(), 'cms_voices'));
        return snap.exists() ? snap.val() || {} : {};
      },
    );
  }
  return _voicesNode;
}

export async function fetchVoice(slug) {
  // PL-12: served from the roster above rather than a second query per voice. The old per-slug
  // read returned null on failure, which seeded the page with nothing — the hero's layout shift
  // and the unseeded morph target the file's own header explains this seeding exists to remove.
  return (await fetchVoicesNode())[slug] ?? null;
}
