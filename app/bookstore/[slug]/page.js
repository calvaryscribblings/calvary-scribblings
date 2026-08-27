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

// ═════════════════════════════════════════════════════════════════════════════════════════
// R22C — THE SEED, AND WHY THE BOARD HAS TO BE IN THE PRERENDERED HTML
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The mock's requirement is that the cover PERSISTS from the shelf to this page — it never
// blinks out and back. The mechanism is a cross-document view transition
// (app/bookstore/components/bookTransition.js), and it has one unforgiving condition: the
// incoming named element must exist at the FIRST RENDERING OPPORTUNITY after `pagereveal`.
//
// MEASURED on the browser this ships to, mounting the incoming element four ways: during parse
// ✓, in a task ✓, in a requestAnimationFrame ✗, 300ms later ✗.
//
// BookDetailClient reads its title from Firebase at runtime and draws a SKELETON meanwhile —
// hundreds of milliseconds, firmly in the ✗ column. Without a seed the shelf's cover would pair
// with a grey rectangle, and the browser would fall back to its default cross-fade, which is
// exactly the blink the mock forbids.
//
// So the four fields a cover needs are read HERE, at build time, from the same query
// generateMetadata already runs, and handed to the client as `seed`. The board is then in the
// parsed document at its final geometry before a byte of Firebase has arrived. When the live
// record lands it carries the same coverUrl, the <img> src does not change, and nothing
// repaints.
//
// ⚠ IT IS A FIRST-PAINT HINT AND NEVER AN AUTHORITY. The client still reads the live record and
// still refuses to render the page unless it comes back `published` — so a title withdrawn or
// deleted since the build (R21) still resolves to notFound(), exactly as it did before. The
// seed can put a cover on screen for the ~200ms before that resolves, which the skeleton
// already occupied; it cannot put a page there.
//
// The fields are listed rather than spread on purpose: this object is serialised into the HTML
// of a public page, and a spread would put prices, territories and the publisher's id there the
// moment one of them is added to the record.
async function seedFor(slug) {
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);
    const snap = await get(query(ref(db, 'bookstore_titles'), orderByChild('slug'), equalTo(slug)));
    if (!snap.exists()) return null;
    let t = null;
    snap.forEach((child) => { if (!t) t = child.val(); return false; });
    if (!t || t.status !== 'published') return null;
    return {
      slug: t.slug,
      title: t.title || '',
      author: t.author || '',
      coverUrl: t.coverUrl || null,
      coverSizes: t.coverSizes || null,
    };
  } catch (e) {
    // A seed that cannot be read is not a build failure. The page renders its skeleton exactly
    // as it did before R22 and the transition degrades to a plain navigation — which is the
    // same thing that happens on a browser with no view-transition support.
    console.error('[bookstore/[slug]] seedFor failed', e);
    return null;
  }
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

export default async function BookDetailPage({ params }) {
  const { slug } = await params;
  // The sentinel exists only so generateStaticParams never returns []; it resolves to
  // notFound() in the client and has no title to seed.
  const seed = slug === SENTINEL_SLUG ? null : await seedFor(slug);
  return <BookDetailClient params={params} seed={seed} />;
}
