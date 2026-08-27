// Server wrapper for a series detail page. Matches the repo's static-export pattern
// (app/bookstore/[slug]/page.js, app/reader/[slug]/page.js): the server page owns
// generateStaticParams + generateMetadata and renders the client component. Both stay in
// page.js with no sibling [slug]/layout.js — under Next 16 a dynamic-segment layout that
// also exports generateStaticParams stops the page's own copy from registering.
//
// SENTINEL: under output:'export', Next 16 rejects a dynamic route whose generateStaticParams
// returns an EMPTY array ("missing generateStaticParams()"). There are zero published series
// on the day this ships, so an empty real list emits one reserved slug. It contains
// underscores, which validateSeries' kebab-case SLUG_RE forbids, so it can never collide with
// a real series — and the client resolves it, like any unknown slug, to notFound().
//
// METADATA IS BUILT FROM THE PARENT RECORD ONLY. Never from an instalment's detail record:
// that node is denied until release, so a build running before an instalment lands would
// simply get nothing, and a build running after would start leaking instalment titles into
// <meta> tags for pages that were generated at a different moment. The parent is public at
// all times and says everything a share card needs.
import { buildRead } from '../../lib/build-read.mjs';
import SeriesDetailClient from './page-detail';

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

// ⛔ PL-12 — ONE GUARDED READ, memoised, feeding both the params and the metadata.
//
// /series is a client-side live query and ships whatever the CMS holds at view time; every
// /series/{slug} is static and enumerated here. A read that returned nothing therefore did not
// produce a smaller Series — it produced a landing page listing series whose pages 404. The
// same shape as the bookstore shelf, and not allowed to degrade for the same reason.
//
// Flattened to a slug-keyed map inside the read so generateMetadata is a lookup rather than a
// second query with a second, quieter failure policy (it used to catch and return {} — a page
// shipping with no title and no card image, invisible until someone shared the link).
let _seriesBySlug;
function readSeries() {
  if (!_seriesBySlug) {
    _seriesBySlug = buildRead(
      'series (status = published)',
      '/series/[slug] — the page for every series The Series links to',
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
  // Empty is a valid answer and keeps the sentinel — there are legitimately zero published
  // series today. Unreachable never reaches this line. See app/lib/build-read.mjs.
  const params = [...(await readSeries()).keys()].map((slug) => ({ slug }));
  return params.length ? params : [{ slug: SENTINEL_SLUG }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (slug === SENTINEL_SLUG) return {};
  const doc = (await readSeries()).get(slug);
  if (!doc) return {};
  return {
    title: `${doc.title} — The Series | Calvary Scribblings`,
    description: doc.synopsis || undefined,
    openGraph: {
      title: doc.title,
      description: doc.synopsis || undefined,
      images: doc.coverUrl ? [doc.coverUrl] : undefined,
    },
  };
}

export default async function SeriesDetailPage({ params }) {
  const { slug } = await params;
  return <SeriesDetailClient slug={slug} sentinel={SENTINEL_SLUG} />;
}
