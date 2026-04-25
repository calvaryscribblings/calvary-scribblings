import { stories } from '../../lib/stories';

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

export async function generateStaticParams() {
  const hardcoded = stories.map(s => ({ slug: s.id }));
  try {
    const { ref, get } = await import('firebase/database');
    const db = await getFirebaseDB();
    const snap = await get(ref(db, 'cms_stories'));
    if (snap.exists()) {
      const cmsData = snap.val();
      const cmsSlugs = Object.keys(cmsData).map(slug => ({ slug }));
      return [...hardcoded, ...cmsSlugs];
    }
  } catch (e) {
    console.error('generateStaticParams: Firebase fetch failed', e);
  }
  return hardcoded;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  let story = stories.find(s => s.id === slug);
  if (!story) {
    try {
      const { ref, get } = await import('firebase/database');
      const db = await getFirebaseDB();
      const snap = await get(ref(db, `cms_stories/${slug}`));
      if (snap.exists()) story = { id: slug, ...snap.val() };
    } catch (e) {}
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