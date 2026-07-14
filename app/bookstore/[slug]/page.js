// Server wrapper for the bookstore title detail route. Matches the repo's static-export pattern
// (app/reader/[slug]/page.js): a server page owns generateStaticParams + generateMetadata and
// renders the client component. We keep both in page.js (no sibling [slug]/layout.js) — under
// Next 16 a dynamic-segment layout that also exports generateStaticParams stops the page's own
// copy from registering. noindex is still inherited from the parent app/bookstore/layout.js
// (robots.index === false), since we never set robots here.
//
// SENTINEL: under output:'export', Next 16 rejects a dynamic route whose generateStaticParams
// returns an EMPTY array ("missing generateStaticParams()"). At launch there are zero published
// titles, so when the real list is empty we emit one reserved slug ('__no-titles-yet__'). It
// contains underscores, which the title validator forbids, so it can never collide with a real
// slug — and BookDetailClient resolves it (like any unknown slug) straight to notFound().
import BookDetailClient from './page-detail';

const SENTINEL_SLUG = '__no-titles-yet__';

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
    const snap = await get(query(ref(db, 'bookstore_titles'), orderByChild('status'), equalTo('published')));
    if (snap.exists()) {
      snap.forEach((child) => {
        const slug = child.val()?.slug;
        if (slug) params.push({ slug });
        return false;
      });
    }
  } catch (e) {
    console.error('[bookstore/[slug]] generateStaticParams failed', e);
  }
  // Never return []; see SENTINEL note above.
  return params.length ? params : [{ slug: SENTINEL_SLUG }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (slug === SENTINEL_SLUG) return {};
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);
    const snap = await get(query(ref(db, 'bookstore_titles'), orderByChild('slug'), equalTo(slug)));
    if (!snap.exists()) return {};
    let title = null;
    snap.forEach((child) => { if (!title) title = child.val(); return false; });
    if (!title || title.status !== 'published') return {};
    const desc = (title.synopsis || `${title.title} by ${title.author}`).replace(/<[^>]+>/g, '').slice(0, 200);
    const url = `https://calvaryscribblings.co.uk/bookstore/${slug}`;
    const images = title.coverUrl ? [{ url: title.coverUrl, alt: title.title }] : undefined;
    // No robots here — noindex inherits from app/bookstore/layout.js.
    return {
      title: `${title.title} — Calvary Scribblings Book Store`,
      description: desc,
      openGraph: { title: title.title, description: desc, url, siteName: 'Calvary Scribblings', images, type: 'book' },
      twitter: { card: 'summary_large_image', title: title.title, description: desc, images: title.coverUrl ? [title.coverUrl] : undefined },
    };
  } catch (e) {
    return {};
  }
}

export default function BookDetailPage({ params }) {
  return <BookDetailClient params={params} />;
}
