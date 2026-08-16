import { stories } from '../../lib/stories';
import { cutPreview } from '../../lib/previewCut';
import { GATING_ENABLED, hasStaticPage } from '../../lib/storyAccess';
import StoryPageClient from './page-client';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

// The whole cms_stories node, fetched ONCE per build worker and shared by both
// generateStaticParams (slugs) and every StoryPage render (prose). Previously the
// build fetched this wholesale just to throw away everything but the keys; now the
// same read also feeds each page's build-inlined prose. Memoised so 435 pages cost
// one fetch, not 435.
let _allStoriesPromise;
async function getAllStories() {
  if (!_allStoriesPromise) {
    _allStoriesPromise = (async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, get } = await import('firebase/database');
      const app = getApps().length ? getApps()[0] : initializeApp(FB);
      const snap = await get(ref(getDatabase(app), 'cms_stories'));
      return snap.exists() ? snap.val() : {};
    })();
  }
  return _allStoriesPromise;
}

export async function generateStaticParams() {
  const staticSlugs = stories.map(s => ({ slug: s.id }));
  try {
    const all = await getAllStories();
    // Same filter as the sibling layout — the two enumerate the same node and must agree, or
    // one builds a page the other has no metadata for. See storyAccess.js:hasStaticPage.
    const cmsSlugs = Object.entries(all)
      .filter(([, story]) => hasStaticPage(story))
      .map(([slug]) => ({ slug }));
    return [...staticSlugs, ...cmsSlugs].filter((s, i, arr) => arr.findIndex(x => x.slug === s.slug) === i);
  } catch (e) {
    console.error('generateStaticParams error:', e);
  }
  return staticSlugs;
}

// Server component (runs at build under output:export). It hands the client the
// story record so words ship in the static HTML — first paint carries prose without
// a Firebase round-trip. The client still fetches the live record on mount for
// freshness/reads/reactions, and the BODY from /api/story (see page-client).
//
// ── THE SECOND DOOR, CLOSED HERE (STORY-SERVING-CONTRACT.md §7.1) ──────────────
//
// This function used to inline the WHOLE body of every story into its static page.
// Gating the RTDB node while `view-source` still handed over the words would have
// been theatre of exactly the kind §4.4 refuses elsewhere: the endpoint would answer
// `access: 'preview'` to a free reader who already had the full text sitting in the
// HTML they had just downloaded.
//
// So the build inlines THE PREVIEW for any story that could be gated, and the full
// body only for stories that are free to everyone by policy (poetry). The preview is
// public by definition, first paint still arrives with real words and no round-trip,
// and the remainder — for a reader entitled to it — comes from /api/story after
// hydration.
//
// `contentIsPreview` tells the client which it got. Always present as a boolean, so
// the client branches on a fact rather than inferring from length.
//
// extractedText is dropped as it always was: the story page never renders it, and it
// is the one heavy field.
export default async function StoryPage({ params }) {
  const { slug } = await params;
  let initialStory = null;
  try {
    const all = await getAllStories();
    const rec = all[slug];
    if (rec) {
      const { extractedText, content, ...rest } = rec;
      let inlined = content || '';
      let isPreview = false;

      // ── WHY THIS IS NOT isGateable() ──────────────────────────────────────
      // isGateable() answers a RUNTIME question — "could the endpoint ever gate
      // this?" — and it says no for three different reasons: poetry (free by
      // policy), reader-mode (served at /reader), and UNPUBLISHED. Only the first
      // of those means "safe to ship in full".
      //
      // Reusing it here would have inlined the complete text of all 15 hidden
      // stories into public static pages, because "not gateable" and "free to
      // everyone" are not the same statement. generateStaticParams builds a page
      // for every key in cms_stories, hidden ones included, so those pages exist
      // and are fetchable by anyone who guesses the slug.
      //
      // The build's question is narrower and is asked directly: is this story free
      // to EVERYONE, always? Poetry is (contract §3.3). Nothing else is.
      //
      // ⛔ …AND WITH THE KILL SWITCH OFF, EVERY STORY IS FREE TO EVERYONE. That is
      // not a special case bolted on here; it is the same sentence `alwaysFree`
      // already asks, answered by the one constant that also turns the endpoint's
      // gate off (app/lib/storyAccess.js). Both halves must flip together: leaving
      // this one cutting previews while the Function serves full bodies would give
      // every reader a preview at first paint and the rest a round-trip later —
      // a flash of paywall on a site with no paywall, and nothing at all for a
      // reader without JS.
      const alwaysFree = !GATING_ENABLED || (rec.category === 'poetry' && !rec.epubUrl);

      if (!alwaysFree) {
        isPreview = true;
        try {
          inlined = cutPreview(content || '').html;
        } catch (e) {
          // A malformed body cannot be cut into a provably well-formed prefix, and
          // the build must NOT fall back to the full text — that would make bad
          // markup a paywall bypass in the static HTML, which is the one place we
          // could never revoke it. Ship no prose for this story and shout: the page
          // still renders (title, cover, byline) and the client fetches the body
          // from /api/story, which applies the same gate with the same cutter.
          //
          // scripts/repair-malformed-bodies.mjs exists for this, the composer
          // refuses to save a body that fails validation, and the corpus was clean
          // as of 2026-08-08 — so this is a backstop, not a path.
          console.error(`[build] PREVIEW FAILED for ${slug} — shipping no inline prose: ${e.message}`);
          inlined = '';
        }
      }

      initialStory = { id: slug, ...rest, content: inlined, contentIsPreview: isPreview };
    }
  } catch (e) {
    console.error('StoryPage build fetch error:', e);
  }
  return <StoryPageClient params={params} initialStory={initialStory} />;
}
