export const dynamic = 'force-static';
import { stories } from './lib/stories';

const BASE_URL = 'https://calvaryscribblings.co.uk';

export default async function sitemap() {
  // Static routes
  const staticRoutes = [
    '', '/about', '/contact', '/flash', '/short', '/poetry',
    '/news', '/inspiring', '/serial', '/square', '/search', '/rewards',
  ].map(route => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? 'daily' : 'weekly',
    priority: route === '' ? 1 : 0.7,
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
      cmsStories = Object.entries(snap.val())
        .filter(([, s]) => s.published !== false)
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