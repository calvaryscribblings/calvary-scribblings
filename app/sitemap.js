export const dynamic = 'force-static';
import { stories } from './lib/stories';
import { buildRead } from './lib/build-read.mjs';

const BASE_URL = 'https://calvaryscribblings.co.uk';

export default async function sitemap() {
  // Static routes
  // '' is the gateway; '/public-library' is the reading platform (the old homepage) and
  // carries the content, so both sit at the top of the priority list.
  const staticRoutes = [
    '', '/public-library', '/ai-policy', '/voices', '/about', '/contact', '/flash', '/short',
    // '/series' replaced '/serial' when the Series shipped. The entry is only honest because
    // the landing page is genuinely public — posters, synopses, instalment lists and visible
    // locks all render signed out, and only the FILES are gated. If /series ever becomes
    // members-only at the page level, this entry must come out in the same change and
    // app/series/layout.js must gain robots:{index:false}. A sitemap entry pointing at a wall
    // is a soft-404 signal; the two halves must not drift.
    '/poetry', '/news', '/inspiring', '/series', '/square', '/search', '/rewards',
  ].map(route => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' || route === '/public-library' ? 'daily' : 'weekly',
    priority: route === '' || route === '/public-library' ? 1 : 0.7,
  }));

  // Hardcoded stories
  const hardcodedStories = stories.map(s => ({
    url: `${BASE_URL}/stories/${s.id}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  // CMS stories
  //
  // ⛔ PL-12 — GUARDED, AND IT DOES NOT DEGRADE. A sitemap that quietly drops 165 story URLs is
  // the purest example of the failure this round exists to prevent: nothing 404s, nothing looks
  // wrong, and the island simply stops being indexed. There is no reader who would notice and
  // no test that was watching. Either the read completes or the build stops.
  const snapVal = await buildRead(
    'cms_stories',
    'sitemap.xml — the indexable URL of every published story',
    async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, get } = await import('firebase/database');
      const FB = {
        apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
        authDomain: 'calvary-scribblings.firebaseapp.com',
        databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
        projectId: 'calvary-scribblings',
        storageBucket: 'calvary-scribblings.firebasestorage.app',
        messagingSenderId: '1052137412283',
        appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
      };
      const app = getApps().length ? getApps()[0] : initializeApp(FB);
      const snap = await get(ref(getDatabase(app), 'cms_stories'));
      return snap.exists() ? snap.val() || {} : {};
    },
  );
  // publishAt future-gate: a story that is published:true but whose publishAt is still in the
  // future is scheduled-but-not-yet-live — keep it out of the sitemap. Index membership is
  // published !== false; the publishAt future-gate is a client concern (the record carries
  // publishAt exactly so surfaces can enforce it). An unparseable publishAt (NaN) fails the >
  // check, so it is treated as live.
  const now = Date.now();
  // Empty is a valid answer — a sitemap of static routes only, because the CMS says there are
  // no stories. Unreachable never reaches this line.
  const cmsStories = Object.entries(snapVal)
    .filter(([, s]) => s.published !== false && !(s.publishAt && Date.parse(s.publishAt) > now))
    .map(([slug]) => ({
      url: `${BASE_URL}/stories/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    }));

  return [...staticRoutes, ...hardcodedStories, ...cmsStories];
}