import { stories } from '../../lib/stories';
import ReaderGate from './reader-gate';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

export async function generateStaticParams() {
  const staticSlugs = stories.map(s => ({ slug: s.id }));
  const seen = new Set(staticSlugs.map(s => s.slug));
  const extra = [];
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, get, query, orderByChild, equalTo } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);

    // cms_stories — free content, unchanged.
    const snap = await get(ref(db, 'cms_stories'));
    if (snap.exists()) {
      Object.keys(snap.val()).forEach((slug) => {
        if (!seen.has(slug)) { seen.add(slug); extra.push({ slug }); }
      });
    }

    // Published bookstore titles — so /reader/{slug}?sample=1 has a static path to land on.
    // Under output:'export' the path must be enumerated here or the sample link 404s.
    const bs = await get(query(ref(db, 'bookstore_titles'), orderByChild('status'), equalTo('published')));
    if (bs.exists()) {
      bs.forEach((child) => {
        const slug = child.val()?.slug;
        if (slug && !seen.has(slug)) { seen.add(slug); extra.push({ slug }); }
        return false;
      });
    }
  } catch (e) {
    console.error('generateStaticParams error:', e);
  }
  return [...staticSlugs, ...extra];
}

export default function ReaderPage({ params }) {
  return <ReaderGate params={params} />;
}