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

async function readSeriesNode() {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
  const app = getApps().length ? getApps()[0] : initializeApp(FB);
  const db = getDatabase(app);
  return get(query(ref(db, 'series'), orderByChild('status'), equalTo('published')));
}

export async function generateStaticParams() {
  const params = [];
  try {
    const snap = await readSeriesNode();
    if (snap.exists()) {
      snap.forEach((child) => {
        const slug = child.val()?.slug;
        if (slug) params.push({ slug });
        return false;
      });
    }
  } catch (e) {
    console.error('[series/[slug]] generateStaticParams failed', e);
  }
  return params.length ? params : [{ slug: SENTINEL_SLUG }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (slug === SENTINEL_SLUG) return {};
  try {
    const snap = await readSeriesNode();
    let doc = null;
    if (snap.exists()) {
      snap.forEach((child) => {
        if (!doc && child.val()?.slug === slug) doc = child.val();
        return false;
      });
    }
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
  } catch (e) {
    console.error('[series/[slug]] generateMetadata failed', e);
    return {};
  }
}

export default async function SeriesDetailPage({ params }) {
  const { slug } = await params;
  return <SeriesDetailClient slug={slug} sentinel={SENTINEL_SLUG} />;
}
