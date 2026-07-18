import { stories } from '../../lib/stories';
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
    const cmsSlugs = Object.keys(all).map(slug => ({ slug }));
    return [...staticSlugs, ...cmsSlugs].filter((s, i, arr) => arr.findIndex(x => x.slug === s.slug) === i);
  } catch (e) {
    console.error('generateStaticParams error:', e);
  }
  return staticSlugs;
}

// Server component (runs at build under output:export). It hands the client the
// story record so the PROSE ships in the static HTML — first paint carries the
// words without a Firebase round-trip. The client still fetches the single live
// record on mount for freshness/reads/reactions (see page-client). extractedText
// is dropped: the story page never renders it, and it is the one heavy field.
export default async function StoryPage({ params }) {
  const { slug } = await params;
  let initialStory = null;
  try {
    const all = await getAllStories();
    const rec = all[slug];
    if (rec) {
      const { extractedText, ...rest } = rec;
      initialStory = { id: slug, ...rest };
    }
  } catch (e) {
    console.error('StoryPage build fetch error:', e);
  }
  return <StoryPageClient params={params} initialStory={initialStory} />;
}
