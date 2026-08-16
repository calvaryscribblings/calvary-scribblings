// Server wrapper for the instalment reader. Same static-export pattern as
// app/series/[slug]/page.js and app/bookstore/[slug]/page.js.
//
// ── NO generateMetadata, AND THAT IS THE POINT ───────────────────────────────────────────
//
// A share card for a gated file would either be empty or would have to read
// series_instalments_detail at BUILD time with a service credential, baking an unreleased
// instalment's title into static HTML that ships to a CDN before its release date. The whole
// release gate would then be defeated by curl on the build output. The reader route carries
// no metadata; the SERIES page is the shareable surface and it is public by design.
//
// The route is flat — /series/read/{instalmentId} rather than /series/{slug}/read/{id} —
// because instalment ids are globally unique (`<seriesSlug>-i<ordinal>`, see
// app/lib/series/admin-writes.js:instalmentId) and one dynamic segment static-exports without
// a nested parameter matrix.
//
// SENTINEL, for the same reason as the series route: Next 16 rejects an empty
// generateStaticParams under output:'export'.
import SeriesReaderClient from './page-reader';

const SENTINEL_ID = '__no-instalments-yet__';

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
  const params = [];
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);
    // The PUBLIC row node only. Reading the detail node here would be both denied and wrong:
    // the ids are already public (that node is `.read: true`) but the titles are not, and a
    // build step has no business holding them.
    const snap = await get(query(ref(db, 'series_instalments'), orderByChild('status'), equalTo('published')));
    if (snap.exists()) {
      snap.forEach((child) => { params.push({ instalmentId: child.key }); return false; });
    }
  } catch (e) {
    console.error('[series/read] generateStaticParams failed', e);
  }
  return params.length ? params : [{ instalmentId: SENTINEL_ID }];
}

export default async function SeriesReadPage({ params }) {
  const { instalmentId } = await params;
  return <SeriesReaderClient instalmentId={instalmentId} sentinel={SENTINEL_ID} />;
}
