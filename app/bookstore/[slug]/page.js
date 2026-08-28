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
import ReactDOM from 'react-dom';
import BookDetailClient from './page-detail';
// R26 — the two statements the preload has to make, read from the same modules the board
// itself reads. Neither carries 'use client', so a server component may read their values.
import { coverSrc, coverSrcSet } from '../../lib/bookstore/covers';
import { DETAIL_BOARD_WIDTH, boardSizes } from '../../lib/bookstore/board';
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
// generateMetadata already runs, and handed to the client as `seed`. When the live record
// lands it carries the same coverUrl, the <img> src does not change, and nothing repaints.
//
// ⚠ R26 CORRECTS ONE CLAIM THIS NOTE USED TO MAKE. It said the board is "in the parsed
// document at its final geometry before a byte of Firebase has arrived". It is not, and never
// was: BookDetailClient's whole tree hangs off `unlocked`, which is false during the prerender
// (the R9 gate reads localStorage in an effect), so `grep -c '<img' out/bookstore/<slug>.html`
// is 0 for every title. The seed puts the board on screen at the first CLIENT render, which is
// early enough for the view transition's first rendering opportunity and is what R22C measured
// — but it is not the parsed HTML, and the preload below exists precisely because it is not.
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
    // R26 — `genre` joins the list so the BREADCRUMB can be drawn in the loading state too.
    // Not decoration: the breadcrumb sits above the board in the block flow, so a breadcrumb
    // that appears only when the live record lands MOVES THE COVER — measured at 53.42px on a
    // laptop and 76.44px on a handset. It is a public field, printed on this page already.
    genre: t.genre || null,
    coverUrl: t.coverUrl || null,
    coverSizes: t.coverSizes || null,
    // R29 — the inline stand-in. It is listed here for the same reason the cover's rungs are:
    // the board is drawn from this object before a byte of Firebase has arrived, so a stand-in
    // that is not in the seed is a stand-in the detail page cannot paint at the moment it is
    // for. ~199 bytes of data URI on the average title, 311 on the largest of the twenty.
    coverLqip: t.coverLqip || null,
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

// ═════════════════════════════════════════════════════════════════════════════════════════
// R26 — THE COVER IS ASKED FOR AT NAVIGATION, NOT AFTER THE TITLE READ
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna, 27 Aug 2026: "the cover assembles in two beats when the detail page is opened."
// Measured on the built export, handset 390 @dpr3, the second beat is the cover face landing
// ~190ms after a board that arrived empty. The reason it arrived empty is here:
//
//   THE <img> IS NOT IN THE SERVED DOCUMENT. `grep -c '<img' out/bookstore/<slug>.html` is 0,
//   for every title. BookDetailClient's whole tree hangs off `unlocked`, which is false during
//   the prerender (it is read from localStorage in an effect — the R9 gate), so the export
//   contains no board, no <img>, and no cover URL anywhere the PRELOAD SCANNER can see it.
//
// So the request could not start until the HTML had been parsed, the bundle fetched, React
// hydrated, the gate's effect run and a re-render committed. MEASURED: navigation responseEnd
// at 4ms; the cover request started at 124ms. On a laptop against localhost. On Ikenna's
// handset over a real network that gap is the whole of the first beat.
//
// THE LINK BELOW IS THE ANSWER, and it is the only one available while the gate stands. It is
// in the <head> of the served document, so the preload scanner starts the fetch off the raw
// bytes — before the bundle, before React, before the gate. By the time the board mounts, the
// image is in the cache and paints with it rather than after it.
//
// ⚠ THE PRELOAD MUST NAME THE RUNG THE BOARD ACTUALLY DRAWS. A preload whose `imagesizes`
// disagrees with the <img>'s `sizes` warms one rung and draws another: a wasted request AND a
// late cover, strictly worse than no preload. That is why boardSizes/DETAIL_BOARD_WIDTH are
// imported rather than restated — one expression decides both. See app/lib/bookstore/board.js.
//
// ⚠ AND IT MUST NAME THE SAME FILE THE SHELF ALREADY DREW. It does, by construction: the two
// rungs are 360w and 720w, the shelf states 190px (or 33vw) and this board states 220px, and
// at every device pixel ratio those two land on the same rung. tests/bookstore/cover-arrival
// asserts it against the live catalogue rather than trusting the arithmetic.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// TWO THINGS R28 FOUND HERE, RECORDED AND DELIBERATELY NOT FIXED IN R29
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Both were re-measured on 28 Aug 2026 against the built export and the live catalogue. Both
// are structural rather than urgent, and neither has a fix that is small enough to be obvious.
//
// ── 1. THE PRELOAD EMITS NO PLAIN href AT ALL ──────────────────────────────────────────────
//
// VERIFIED in out/bookstore/*.html: the emitted tag is
//
//     <link rel="preload" as="image" fetchPriority="high" imageSrcSet="…360w, …720w" imageSizes="220px"/>
//
// with NO href attribute. That is ReactDOM.preload's own behaviour — it drops the href once an
// imageSrcSet is given. So an engine that does not support imagesrcset on rel=preload gets
// nothing from this tag rather than the fallback rung it could have had.
//
// NOT FIXED, for two reasons. The fix is not small: the href cannot be forced back through
// ReactDOM.preload, and the alternative — rendering our own <link> — is the exact thing the
// note above says was tried and abandoned, because React 19 hoists a rendered <link> into the
// head AND emits its own directive for it, so the document carried the tag twice.
//
// AND R29 HAS ALREADY TAKEN MOST OF THE COST AWAY. What such an engine loses is not the cover
// — the <img> still carries src and srcset, which are universally supported — it is only the
// HEAD START this preload buys. That head start exists to shorten the window in which the
// board is empty, and as of R29 that window is not empty any more: it is the stand-in. The
// engines in question would see a blurred cover for slightly longer, not a blank plate.
//
// ── 2. THE SEED IS BAKED AT BUILD TIME ─────────────────────────────────────────────────────
//
// seedFor() reads Firebase during the export, so a cover re-uploaded BETWEEN deploys leaves
// this page preloading a URL the <img> will never request — a wasted request, and one that
// does not warm the file the board draws.
//
// MEASURED AGAIN 28 Aug 2026, all twenty published titles: 0 stale cover URLs and 0 stale
// stand-ins. Unchanged from R28's count.
//
// NOT FIXED. It self-corrects: this page is a client component that re-reads the title from
// Firebase, and the seed is only a bootstrap, so a stale seed costs one wasted preload and
// nothing else. R29 adds coverLqip to the same seed and inherits the same property — a stale
// stand-in is a blur of the PREVIOUS cover, which is still a filled plate and is replaced the
// moment the real file lands. Closing this would mean giving up the build-time seed, and the
// seed is what lets the preload scanner see a cover URL at all while the R9 gate stands.
export default async function BookDetailPage({ params }) {
  const { slug } = await params;
  // The sentinel exists only so generateStaticParams never returns []; it resolves to
  // notFound() in the client and has no title to seed.
  const seed = slug === SENTINEL_SLUG ? null : await seedFor(slug);
  const href = seed ? coverSrc(seed) : null;
  const imageSrcSet = seed ? coverSrcSet(seed) : undefined;
  // ReactDOM.preload rather than a rendered <link>: React 19 hoists a rendered <link> into the
  // head AND emits its own preload directive for it, so the document carried the same tag
  // twice. This emits exactly one, and it lands in the first 200 bytes of the head — ahead of
  // the stylesheet, ahead of every script — which is the whole point.
  //
  // `imageSizes` only alongside an imagesrcset, exactly as on the <img> itself: without rungs
  // it would tell the browser about a choice it does not have.
  if (href) {
    ReactDOM.preload(href, {
      as: 'image',
      imageSrcSet,
      imageSizes: imageSrcSet ? boardSizes(DETAIL_BOARD_WIDTH) : undefined,
      fetchPriority: 'high',
    });
  }
  // No cover, no preload — a title with neither coverUrl nor derivatives draws the typographic
  // fallback face, which needs no network at all.
  return <BookDetailClient params={params} seed={seed} />;
}
