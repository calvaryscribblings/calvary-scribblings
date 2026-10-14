// READERS' NOTES — THE ROOM, /series/{slug}/notes?i={instalmentId} (W46, §4).
//
// One static page per series; the instalment travels in the query (roomHref() builds it), so a
// new instalment needs no rebuild. Same static-export construction as ../page.js: the server
// page owns generateStaticParams and the metadata, and under output:'export' an empty param list
// is refused, so zero published series emits the reserved SENTINEL slug, which the client
// resolves to nothing.
//
// The room is never indexed: what it holds is readers' words behind a finished instalment, and
// the page itself is a shell until the reader's own reads say what they may see.
//
// The params read is a separate, memoised copy of ../page.js's. Both are the same PL-12 guarded
// read (app/lib/build-read.mjs); the parent's is module-private, and a series page linking to a
// room the build never made would 404, so this list is the parent's list by construction.
import { Suspense } from 'react';
import { buildRead } from '../../../lib/build-read.mjs';
import RoomClient from './RoomClient';

const SENTINEL_SLUG = '__no-series-yet__';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

let _seriesBySlug;
function readSeries() {
  if (!_seriesBySlug) {
    _seriesBySlug = buildRead(
      'series (status = published)',
      "/series/[slug]/notes — the Readers' Notes room for every series The Series links to",
      async () => {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
        const app = getApps().length ? getApps()[0] : initializeApp(FB);
        const db = getDatabase(app);
        const snap = await get(query(ref(db, 'series'), orderByChild('status'), equalTo('published')));
        const bySlug = new Map();
        if (snap.exists()) {
          snap.forEach((child) => { const d = child.val(); if (d?.slug) bySlug.set(d.slug, d); return false; });
        }
        return bySlug;
      },
    );
  }
  return _seriesBySlug;
}

export async function generateStaticParams() {
  const params = [...(await readSeries()).keys()].map((slug) => ({ slug }));
  return params.length ? params : [{ slug: SENTINEL_SLUG }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = slug === SENTINEL_SLUG ? null : (await readSeries()).get(slug);
  return {
    title: doc ? `Readers’ Notes — ${doc.title} | Calvary Scribblings` : 'Readers’ Notes | Calvary Scribblings',
    robots: { index: false, follow: false },
  };
}

export default async function SeriesNotesPage({ params }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<div style={{ background: '#080610', minHeight: '100vh' }} />}>
      <RoomClient slug={slug} sentinel={SENTINEL_SLUG} />
    </Suspense>
  );
}
