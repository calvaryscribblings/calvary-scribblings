import { stories } from '../../lib/stories';
import { hasStaticPage } from '../../lib/storyAccess';
import { buildRead } from '../../lib/build-read.mjs';

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
  return {
    title: `${story.title} — Calvary Scribblings`,
    description: `By ${story.author} · ${story.categoryName} · Calvary Scribblings`,
    openGraph: {
      title: story.title,
      description: `By ${story.author} · ${story.categoryName}`,
      url,
      siteName: 'Calvary Scribblings',
      images: [{ url: image, width: 1200, height: 675, alt: story.title }],
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