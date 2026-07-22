export const dynamic = 'force-static';
import { stories } from './lib/stories';

const BASE_URL = 'https://calvaryscribblings.co.uk';

export default async function sitemap() {
  // Static routes
  // '' is the gateway; '/public-library' is the reading platform (the old homepage) and
  // carries the content, so both sit at the top of the priority list.
  const staticRoutes = [
    '', '/public-library', '/ai-policy', '/voices', '/about', '/contact', '/flash', '/short',
    '/poetry', '/news', '/inspiring', '/serial', '/square', '/search', '/rewards',
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
  let cmsStories = [];
  try {
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
    const db = getDatabase(app);
    const snap = await get(ref(db, 'cms_stories'));
    if (snap.exists()) {
      // publishAt future-gate: a story that is published:true but whose publishAt is
      // still in the future is scheduled-but-not-yet-live — keep it out of the sitemap.
      // Index membership is published !== false; the publishAt future-gate is a client
      // concern (the record carries publishAt exactly so surfaces can enforce it). An
      // unparseable publishAt (NaN) fails the > check, so it is treated as live.
      const now = Date.now();
      cmsStories = Object.entries(snap.val())
        .filter(([, s]) => s.published !== false && !(s.publishAt && Date.parse(s.publishAt) > now))
        .map(([slug]) => ({
          url: `${BASE_URL}/stories/${slug}`,
          lastModified: new Date(),
          changeFrequency: 'monthly',
          priority: 0.6,
        }));
    }
  } catch (e) {}

  return [...staticRoutes, ...hardcodedStories, ...cmsStories];
}