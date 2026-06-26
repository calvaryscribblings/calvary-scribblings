// Author profile shorthand route — /u/[handle]
//
// Open Pages feed cards and detail pages link authors to /u/<handle>. The real
// profile page is /user?handle=<handle>. The primary forwarding happens at the
// Cloudflare edge via public/_redirects (/u/:handle -> /user?handle=:handle);
// this Next.js route is belt-and-braces so the link still resolves in contexts
// where the edge rule isn't applied (e.g. `next start` of the export, local dev).
//
// The site is a static export (next.config.mjs: output:'export'), so a dynamic
// segment must enumerate its paths at BUILD time via generateStaticParams and a
// true server-side redirect() is not available at request time — the redirect
// itself runs client-side (see page-client.js), mirroring the established
// app/open-pages/[id] pattern.

import UHandleRedirect from './page-client';

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
    const snap = await get(ref(db, 'usernames'));
    if (snap.exists()) {
      const handles = Object.keys(snap.val());
      if (handles.length) return handles.map((handle) => ({ handle }));
    }
  } catch (e) {
    console.error('u/[handle] generateStaticParams error:', e);
  }
  // output:'export' requires a dynamic segment to emit at least one path. Any
  // handle created after the last build is still covered by the edge _redirects
  // rule, and by the client redirect once this page loads.
  return [{ handle: 'none' }];
}

export default function UHandlePage({ params }) {
  return <UHandleRedirect params={params} />;
}
