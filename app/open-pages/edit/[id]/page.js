// Open Pages — edit route (server half). /open-pages/edit/[id]
//
// Same static-export pattern as app/open-pages/[id]/page.js: the site is an
// `output:'export'` build, so a dynamic segment must enumerate its paths at BUILD
// time via generateStaticParams. We list every post id from open_pages and let the
// client half (page-client.js) do the auth/ownership gating, pre-fill, and save.

import { buildRead } from '../../../lib/build-read.mjs';
import EditPageClient from './page-client';

export const metadata = {
  title: 'Edit story · Open Pages',
  robots: { index: false, follow: false },
};

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
  // PL-12 — guarded. The editor is reached from a reader's own post; an unreadable node emitted
  // only the throwaway id, so every "edit" link on the site 404'd while the posts themselves
  // rendered fine. Invisible until an author tried to fix a typo.
  const posts = await buildRead(
    'open_pages',
    '/open-pages/edit/[id] — the editor for every post its author can reach',
    async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, get } = await import('firebase/database');
      const app = getApps().length ? getApps()[0] : initializeApp(FB);
      const snap = await get(ref(getDatabase(app), 'open_pages'));
      return snap.exists() ? snap.val() || {} : {};
    },
  );
  const ids = Object.keys(posts);
  if (ids.length) return ids.map((id) => ({ id }));
  // Empty is a valid answer: no posts yet. output:'export' requires one path, and the client
  // half renders its not-found / permission states for anything not pre-rendered.
  return [{ id: 'none' }];
}

export default function EditOpenPagePage({ params }) {
  return <EditPageClient params={params} />;
}
