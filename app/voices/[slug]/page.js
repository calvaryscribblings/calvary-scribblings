// Server wrapper for a voice's author page. Matches the repo's static-export pattern
// (app/bookstore/[slug]/page.js): the server page owns generateStaticParams +
// generateMetadata and renders the client component. There is deliberately no sibling
// [slug]/layout.js — under Next 16 a dynamic-segment layout that also exports
// generateStaticParams stops the page's own copy from registering.
//
// SENTINEL: under output:'export', Next 16 rejects a dynamic route whose
// generateStaticParams returns an EMPTY array ("missing generateStaticParams()"). The
// roster can legitimately be empty (it was, until Phase 1), so an empty list emits one
// reserved slug. It contains underscores, which slugify() strips, so it can never
// collide with a real slug — and the client resolves it, like any unknown slug, to the
// not-found state.
import VoicePageClient from './page-client';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

const SENTINEL = '__no-voices-yet__';
const BASE_URL = 'https://calvaryscribblings.co.uk';

async function getFirebaseDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getDatabase } = await import('firebase/database');
  const app = getApps().length ? getApps()[0] : initializeApp(FB);
  return getDatabase(app);
}

// Every slug is built, published or not — the same way cms_stories builds all 148
// including the 20 unpublished. Building only published voices would return an empty
// array whenever the roster is all drafts and fail the build outright. The client gates
// on `published`, so a draft's page exists but resolves to not-found.
export async function generateStaticParams() {
  try {
    const { ref, get } = await import('firebase/database');
    const db = await getFirebaseDB();
    const snap = await get(ref(db, 'cms_voices'));
    if (snap.exists()) {
      const slugs = Object.keys(snap.val() || {});
      if (slugs.length) return slugs.map((slug) => ({ slug }));
    }
  } catch (e) {
    console.error('voices generateStaticParams: Firebase fetch failed', e);
  }
  return [{ slug: SENTINEL }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  let voice = null;
  try {
    const { ref, get } = await import('firebase/database');
    const db = await getFirebaseDB();
    const snap = await get(ref(db, `cms_voices/${slug}`));
    if (snap.exists()) voice = snap.val();
  } catch (e) {}

  // A draft gets no metadata and no indexing — its page exists only because the build
  // enumerates every slug.
  if (!voice || voice.published !== true) {
    return { title: 'Voices of the Island — Calvary Scribblings', robots: { index: false, follow: false } };
  }

  const name = voice.displayName || 'Voices of the Island';
  const title = `${name} — Voices of the Island`;
  const description = voice.message || voice.genreTag || `${name} — a voice of Calvary Scribblings.`;
  const url = `${BASE_URL}/voices/${slug}`;
  // The 1080×1350 card is the share asset this feature exists for, so it is the OG
  // image rather than the site favicon.
  const image = voice.cardImage || `${BASE_URL}/favicon.png`;

  return {
    metadataBase: new URL(BASE_URL),
    title,
    description,
    alternates: { canonical: `/voices/${slug}` },
    openGraph: {
      type: 'profile',
      url,
      siteName: 'Calvary Scribblings',
      title,
      description,
      images: [{ url: image, width: 1080, height: 1350, alt: `${name} — Voices of the Island` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default function VoicePage({ params }) {
  return <VoicePageClient params={params} />;
}
