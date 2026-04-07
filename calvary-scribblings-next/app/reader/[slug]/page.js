import { stories } from '../../lib/stories';
import StoryReaderClient from './page-reader';

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
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, get } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);
    const snap = await get(ref(db, 'cms_stories'));
    if (snap.exists()) {
      const cmsSlugs = Object.keys(snap.val()).map(slug => ({ slug }));
      return [...staticSlugs, ...cmsSlugs].filter((s, i, arr) => arr.findIndex(x => x.slug === s.slug) === i);
    }
  } catch (e) {
    console.error('generateStaticParams error:', e);
  }
  return staticSlugs;
}

export default function ReaderPage({ params }) {
  return <StoryReaderClient params={params} />;
}