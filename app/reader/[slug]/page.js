import ReaderGate from './reader-gate';
import { hasStaticPage } from '../../lib/storyAccess';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

// R7.3 §C — the second consumer of the dead fast path, and the last one on this route.
// This used to seed itself with `stories.map(...)` from app/lib/stories.js and then treat
// everything from the CMS as `extra` merged on top. That array has been `[]` since the
// 2026-05-18 migration, so the seed contributed no path on any build since — the reader's
// entire route list has always come from the two reads below. Removing it changes no
// output; it stops the file claiming a source it does not have.
export async function generateStaticParams() {
  const seen = new Set();
  const slugs = [];
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, get, query, orderByChild, equalTo } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);

    // cms_stories — free content. FILTERED on hasStaticPage: a hidden story must not keep a
    // reader page either. This route is the sharper half of that hole — the story page at
    // least renders prose a hidden record no longer has, while /reader/<slug> resolves the
    // record's epubUrl, which for the whole Book Reader Collection was a permanent PUBLIC
    // Storage URL. A delisted book with a live reader page was a delisted book anyone holding
    // the link could still read end to end. See app/lib/storyAccess.js:hasStaticPage.
    const snap = await get(ref(db, 'cms_stories'));
    if (snap.exists()) {
      Object.entries(snap.val()).forEach(([slug, story]) => {
        if (!hasStaticPage(story)) return;
        if (!seen.has(slug)) { seen.add(slug); slugs.push({ slug }); }
      });
    }

    // Published bookstore titles — so /reader/{slug}?sample=1 has a static path to land on.
    // Under output:'export' the path must be enumerated here or the sample link 404s.
    const bs = await get(query(ref(db, 'bookstore_titles'), orderByChild('status'), equalTo('published')));
    if (bs.exists()) {
      bs.forEach((child) => {
        const slug = child.val()?.slug;
        if (slug && !seen.has(slug)) { seen.add(slug); slugs.push({ slug }); }
        return false;
      });
    }
  } catch (e) {
    console.error('generateStaticParams error:', e);
  }
  return slugs;
}

export default function ReaderPage({ params }) {
  return <ReaderGate params={params} />;
}