import ReaderGate from './reader-gate';
import { hasStaticPage } from '../../lib/storyAccess';
import { buildRead } from '../../lib/build-read.mjs';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

// R7.3 §C — the second consumer of the dead fast path, and the last one on this route.
// This used to seed itself with `stories.map(...)` from app/lib/stories.js and then treat
// everything from the CMS as `extra` merged on top. That array has been `[]` since the
// 2026-05-18 migration, so the seed contributed no path on any build since — the reader's
// entire route list has always come from the two reads below. Removing it changes no
// output; it stops the file claiming a source it does not have.
// ⚠ PL-12 — TWO READS, AND THE OLD try/catch WRAPPED BOTH OF THEM TOGETHER.
//
// That is worth spelling out because it is the sharpest version of the defect. `cms_stories`
// and `bookstore_titles` were read inside ONE try block, so a failure on the SECOND kept
// whatever the first had produced and returned it as if it were the whole answer. The build
// went green with every free story's reader page present and every book's ?sample=1 path
// missing — a shop whose samples do not open, indistinguishable from a healthy build.
//
// They are now two separately guarded reads. Either completes or the build stops. A partial
// answer is no longer representable.
export async function generateStaticParams() {
  const seen = new Set();
  const slugs = [];

  // cms_stories — free content. FILTERED on hasStaticPage: a hidden story must not keep a
  // reader page either. This route is the sharper half of that hole — the story page at least
  // renders prose a hidden record no longer has, while /reader/<slug> resolves the record's
  // epubUrl, which for the whole Book Reader Collection was a permanent PUBLIC Storage URL. A
  // delisted book with a live reader page was a delisted book anyone holding the link could
  // still read end to end. See app/lib/storyAccess.js:hasStaticPage.
  const cms = await buildRead(
    'cms_stories',
    '/reader/[slug] — the reading room for every free story',
    async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, get } = await import('firebase/database');
      const app = getApps().length ? getApps()[0] : initializeApp(FB);
      const snap = await get(ref(getDatabase(app), 'cms_stories'));
      return snap.exists() ? snap.val() || {} : {};
    },
  );
  Object.entries(cms).forEach(([slug, story]) => {
    if (!hasStaticPage(story)) return;
    if (!seen.has(slug)) { seen.add(slug); slugs.push({ slug }); }
  });

  // Published bookstore titles — so /reader/{slug}?sample=1 has a static path to land on.
  // Under output:'export' the path must be enumerated here or the sample link 404s.
  const bs = await buildRead(
    'bookstore_titles (status = published)',
    '/reader/[slug]?sample=1 — the sample reader for every book in the shop',
    async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
      const app = getApps().length ? getApps()[0] : initializeApp(FB);
      const db = getDatabase(app);
      const snap = await get(query(ref(db, 'bookstore_titles'), orderByChild('status'), equalTo('published')));
      const out = [];
      if (snap.exists()) snap.forEach((child) => { const sl = child.val()?.slug; if (sl) out.push(sl); return false; });
      return out;
    },
  );
  bs.forEach((slug) => { if (!seen.has(slug)) { seen.add(slug); slugs.push({ slug }); } });

  // Empty is a valid answer — see app/lib/build-read.mjs. An island with no free stories and no
  // published books has no reader pages, and `output:'export'` will say so plainly. Unreachable
  // never reaches this line.
  return slugs;
}

export default function ReaderPage({ params }) {
  return <ReaderGate params={params} />;
}