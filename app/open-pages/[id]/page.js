// Open Pages — post detail route (Stage 4). /open-pages/[id]
//
// The site is a static export (next.config.mjs: output:'export'), so a dynamic
// segment must enumerate its paths at BUILD time via generateStaticParams. We
// mirror the working app/stories/[slug] + app/reader/[slug] pattern: this server
// component lists every published post id from RTDB at build, and the actual
// fetch + render happens client-side in page-client.js (posts read live so the
// page reflects edits without a rebuild). Posts created after the last build are
// covered on the next deploy, exactly like CMS stories.

import OpenPageDetailClient from './page-client';

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
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, get } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);
    const snap = await get(ref(db, 'open_pages'));
    if (snap.exists()) {
      return Object.keys(snap.val()).map((id) => ({ id }));
    }
  } catch (e) {
    console.error('open-pages generateStaticParams error:', e);
  }
  return [];
}

export default function OpenPageDetailPage({ params }) {
  return <OpenPageDetailClient params={params} />;
}
