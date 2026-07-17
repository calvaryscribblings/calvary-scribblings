// Build-time reads of cms_stories, for the gateway server page (app/page.js).
//
// SERVER ONLY. Mirrors app/lib/voices-build.js: deliberately does NOT import
// app/lib/firebase.js (that module calls getAuth()/getStorage() at import time, pulling
// browser-only surface into a Node build). This initialises the same project with only
// the RTDB pieces a build needs.
//
// Why bake at all — the gateway is contractually zero-Firebase at runtime (no client
// cms_stories fetch), so the honest story count and the door's rotating whispers must be
// baked into the static export at build time. The existing deploy-on-publish hook rebuilds
// the site on every CMS mutation, so the baked numbers self-update and are never stale for
// long. This is the same seed-at-build pattern the Voices pages use.
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

// "Published" here matches the public-library gate exactly (page.js line ~998):
// published !== false, and any publishAt has already passed as of the build.
function isPublished(s, now) {
  return s && s.published !== false && (!s.publishAt || new Date(s.publishAt) <= now);
}

const MAX_WHISPERS = 12;
const WHISPER_MAX_CHARS = 140;

// Returns { storyCount, whispers } baked for the gateway:
//   storyCount — count of published cms_stories (item 7, "the honest number").
//   whispers   — up to 12 published stories that carry a trailerQuote, preferring the
//                shortest (under ~140 chars) so the door's whisper stays to three lines.
//                Shape: { quote, title }. No author, no cover — the gateway needs nothing
//                more, and the smaller the baked payload the better.
// A failed read degrades to zeroes/empty rather than throwing: a Firebase blip should
// leave the gateway standing (count line hidden, no whispers), not fail the deploy.
export async function fetchGatewayData() {
  try {
    const snap = await get(ref(buildDB(), 'cms_stories'));
    if (!snap.exists()) return { storyCount: 0, whispers: [] };
    const data = snap.val() || {};
    const now = new Date();
    const published = Object.values(data).filter((s) => isPublished(s, now));

    const withQuote = published
      .map((s) => ({
        quote: typeof s.trailerQuote === 'string' ? s.trailerQuote.trim() : '',
        title: typeof s.title === 'string' ? s.title.trim() : '',
      }))
      .filter((w) => w.quote && w.title);

    // Prefer the shortest quotes (those under the cap lead), then take the first 12.
    withQuote.sort((a, b) => {
      const au = a.quote.length <= WHISPER_MAX_CHARS ? 0 : 1;
      const bu = b.quote.length <= WHISPER_MAX_CHARS ? 0 : 1;
      if (au !== bu) return au - bu;
      return a.quote.length - b.quote.length;
    });

    return { storyCount: published.length, whispers: withQuote.slice(0, MAX_WHISPERS) };
  } catch (e) {
    console.error('gateway build read: cms_stories fetch failed', e);
    return { storyCount: 0, whispers: [] };
  }
}
