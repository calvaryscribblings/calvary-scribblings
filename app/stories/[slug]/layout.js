import { stories } from '../../lib/stories';
import { hasStaticPage } from '../../lib/storyAccess';
import { buildRead } from '../../lib/build-read.mjs';
// The generator's own canvas constant, imported rather than transcribed so the declared
// og:image size cannot drift from the size the renderer actually produces. layout.mjs is pure
// frozen constants with no imports of its own, so this pulls no build machinery into the app.
import { CANVAS as COVER_CANVAS } from '../../../scripts/covers/layout.mjs';

const firebaseConfig = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

async function getFirebaseDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getDatabase } = await import('firebase/database');
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getDatabase(app);
}

// PL-12 — the layout's own read of the same node. It is deliberately NOT shared with the
// page's: a layout and a page are separate modules in separate graphs, and wiring one to the
// other's memo would couple them for the sake of one read per build. What they DO share is the
// policy — both go through buildRead, so they can no longer disagree about what a failure means.
let _cmsStories;
function readCmsStories() {
  if (!_cmsStories) {
    _cmsStories = buildRead(
      'cms_stories',
      '/stories/[slug] — the layout that enumerates and titles every story page',
      async () => {
        const { ref, get } = await import('firebase/database');
        const db = await getFirebaseDB();
        const snap = await get(ref(db, 'cms_stories'));
        return snap.exists() ? snap.val() || {} : {};
      },
    );
  }
  return _cmsStories;
}

export async function generateStaticParams() {
  const hardcoded = stories.map((s) => ({ slug: s.id }));
  const cmsData = await readCmsStories();
  // hasStaticPage, not every key: an unpublished story must not keep a page at a URL a reader
  // can still type. See app/lib/storyAccess.js for the measurement behind it and for why
  // scheduled stories are deliberately still built.
  //
  // Empty is a valid answer and returns `hardcoded` — which is [] since the migration, and
  // would fail the export. That is CORRECT and it is not this file's decision to soften: an
  // empty cms_stories means the CMS has no stories, and a site with no story pages has nothing
  // for this route to enumerate. Unreachable never reaches here.
  const cmsSlugs = Object.entries(cmsData)
    .filter(([, story]) => hasStaticPage(story))
    .map(([slug]) => ({ slug }));
  return [...hardcoded, ...cmsSlugs];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  let story = stories.find((s) => s.id === slug);
  // PL-12: read from the node already fetched above rather than issuing one more query per
  // page. The old per-slug read had an EMPTY catch — `catch (e) {}` — so a page whose metadata
  // read failed shipped with no title, no description and no card image, silently, and the
  // only way to notice was to share the link. There is no second read to fail now.
  if (!story) {
    const rec = (await readCmsStories())[slug];
    if (rec) story = { id: slug, ...rec };
  }
  if (!story) return {};
  const url = `https://calvaryscribblings.co.uk/stories/${slug}`;
  const image = `https://og.calvaryscribblings.co.uk/?slug=${slug}`;
  // THE DECLARED SIZE MUST BE THE FILE'S REAL SIZE, and for four months it was not: this
  // said 1200 × 675 while every generated cover is CANVAS — 1600 × 2400. The 1200 × 675 was
  // presumably written in the belief that the OG worker composites a landscape card. It does
  // not. og.calvaryscribblings.co.uk is a BYTE PASSTHROUGH: it resolves cms_stories/{slug}/cover
  // and returns those bytes unchanged, verified byte-for-byte against the stored object. What
  // a scraper receives is the cover itself, at its own dimensions.
  //
  // ⚠ SO THE CARD IS NOW RIGHT-BUT-CROPPED, and that is a known, accepted state rather than a
  // finished one. `summary_large_image` and Facebook's large card both want a landscape frame
  // near 1200 × 630; a 2:3 portrait dropped into one is CENTRE-CROPPED HARD — roughly the
  // middle third of the cover survives, so the title band usually reads and the ornament and
  // lower rule are cut away. That is a real improvement on the bare link it replaces and it is
  // not the final answer. Making it a true 1200 × 630 composite means changing the OG worker,
  // whose source is in no repository here, and it is a separate editorial decision about what
  // the card should BE — a cropped cover, a letterboxed cover on a house ground, or a
  // purpose-composed card. Do not fake it from this side by declaring landscape numbers again.
  //
  // Dimensions are declared ONLY for the generated covers, whose size is known from the
  // generator's own constant. A legacy `covers/` cover is a photograph of arbitrary size, so
  // this omits width/height there and lets the scraper measure rather than assert a number it
  // cannot stand behind.
  const generated = /covers-typographic/.test(story.cover || '');
  const imageEntry = generated
    ? { url: image, width: COVER_CANVAS.w, height: COVER_CANVAS.h, type: 'image/png', alt: story.title }
    : { url: image, alt: story.title };
  return {
    title: `${story.title} — Calvary Scribblings`,
    description: `By ${story.author} · ${story.categoryName} · Calvary Scribblings`,
    openGraph: {
      title: story.title,
      description: `By ${story.author} · ${story.categoryName}`,
      url,
      siteName: 'Calvary Scribblings',
      images: [imageEntry],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: story.title,
      description: `By ${story.author} · ${story.categoryName}`,
      images: [image],
    },
  };
}

export default function StoryLayout({ children }) {
  return children;
}