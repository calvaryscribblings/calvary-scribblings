export async function generateStaticParams() {
  const hardcoded = (await import('../../lib/stories')).stories.map(s => ({ slug: s.id }));
  const cmsSlugs = ["purple", "odeluwa", "my-dream-man", "notting-hill-carnival-a-new-spin", "dinner-at-my-family-table"];
  const cms = cmsSlugs.map(slug => ({ slug }));
  return [...hardcoded, ...cms];
}

import { stories } from '../../lib/stories';


export async function generateMetadata({ params }) {
  const { slug } = await params;
  let story = stories.find(s => s.id === slug);
  if (!story) {
    try {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, get } = await import('firebase/database');
      const firebaseConfig = {
        apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
        authDomain: 'calvary-scribblings.firebaseapp.com',
        databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
        projectId: 'calvary-scribblings',
        storageBucket: 'calvary-scribblings.firebasestorage.app',
        messagingSenderId: '1052137412283',
        appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
      };
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getDatabase(app);
      const snap = await get(ref(db, `cms_stories/${slug}`));
      if (snap.exists()) story = { id: slug, ...snap.val() };
    } catch(e) {}
  }
  if (!story) return {};

  const url = `https://calvaryscribblings.co.uk/stories/${slug}`;
  const image = story.cover && story.cover.startsWith('http') ? story.cover : `https://calvaryscribblings.co.uk${story.cover}`

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