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
// PL-12 — every build-time read goes through here. The deadline is the fix, not a belt: see
// that file's header for the measurement (get() never settles on an unreachable DB, and a full
// build hung 420s producing an empty out/).
import { buildRead } from '../../lib/build-read.mjs';

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

// ═════════════════════════════════════════════════════════════════════════════════════════
// ⛔ PL-12 — ONE GUARDED READ, SHARED BY ALL THREE CONSUMERS OF THIS FILE
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// generateStaticParams (the slugs), generateMetadata (per page) and seedFor (per page) all
// want the same thing: the published catalogue. They used to make that query THREE TIMES —
// once for the list and twice more for every single title — each behind its own try/catch,
// each with its own idea of what to do when it failed. Three failure policies for one fact.
//
// It is one read now, memoised for the worker (Next collects page data with a single worker),
// and it either completes or the build stops. The per-title lookups are map reads.
//
// ── AND THIS IS THE ROUTE THAT MADE PL-12 URGENT ─────────────────────────────────────────
//
// MEASURED, 27 Aug 2026, with only this read failing and every other read succeeding:
//
//     BUILD EXIT: 0
//     out/bookstore/*.html  →  1     (just __no-titles-yet__.html)
//     out/reader/*.html     →  188
//
// The shelf at /bookstore is a CLIENT-SIDE LIVE QUERY, so it shipped and listed all nineteen
// titles. Every detail page is STATIC and enumerated here, and there was exactly one of them.
// So every "Full details" link 404'd, and so did every ?sample=1 reader path — a shop whose
// books do not open, deployed green, with one line of console.error in a log nobody reads.
//
// That is why this read is not allowed to degrade, and why the sentinel below is now reachable
// ONLY from a successful empty read.
let _publishedTitles;
function readPublishedTitles() {
  if (!_publishedTitles) {
    _publishedTitles = buildRead(
      'bookstore_titles (status = published)',
      '/bookstore/[slug] — the detail page for every book on the shelf',
      async () => {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
        const app = getApps().length ? getApps()[0] : initializeApp(FB);
        const db = getDatabase(app);
        const snap = await get(query(ref(db, 'bookstore_titles'), orderByChild('status'), equalTo('published')));
        // Flattened to a plain map INSIDE the guarded read, so nothing downstream holds a
        // Firebase snapshot and every caller is reading the same object.
        const bySlug = new Map();
        if (snap.exists()) {
          snap.forEach((child) => {
            const t = child.val();
            if (t?.slug) bySlug.set(t.slug, t);
            return false;
          });
        }
        return bySlug;
      },
    );
  }
  return _publishedTitles;
}

export async function generateStaticParams() {
  const bySlug = await readPublishedTitles();
  // ⭑ EMPTY IS NOT UNREACHABLE. Reaching this line means the read COMPLETED — an unreadable
  // catalogue never gets here, it ends the build with a message naming Firebase and this route.
  // An empty map is the CMS answering honestly that nothing is published yet, which is the
  // launch-day state and exactly what the sentinel exists for. The two used to arrive at this
  // line together, through one try/catch, and produce the same output; that was the defect.
  const params = [...bySlug.keys()].map((slug) => ({ slug }));
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
  // PL-12: a map read now. It used to be its own Firebase query with its own catch, whose
  // comment said "a seed that cannot be read is not a build failure" — true of a seed, and the
  // reason it was wrong is that it was not reading a seed, it was re-reading the catalogue. The
  // catalogue is read once, above, and the build has already stopped if it could not be.
  const t = (await readPublishedTitles()).get(slug);
  if (!t || t.status !== 'published') return null;
  // The fields are listed rather than spread on purpose: this object is serialised into the
  // HTML of a public page, and a spread would put prices, territories and the publisher's id
  // there the moment one of them is added to the record.
  return {
    slug: t.slug,
    title: t.title || '',
    author: t.author || '',
    coverUrl: t.coverUrl || null,
    coverSizes: t.coverSizes || null,
  };
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (slug === SENTINEL_SLUG) return {};
  // PL-12: the same memoised read. Its own catch used to return {} — a page silently shipped
  // with no title, no description and no card image, which is invisible until someone shares
  // a link. One read, one policy.
  const title = (await readPublishedTitles()).get(slug);
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
}

export default async function BookDetailPage({ params }) {
  const { slug } = await params;
  // The sentinel exists only so generateStaticParams never returns []; it resolves to
  // notFound() in the client and has no title to seed.
  const seed = slug === SENTINEL_SLUG ? null : await seedFor(slug);
  return <BookDetailClient params={params} seed={seed} />;
}
