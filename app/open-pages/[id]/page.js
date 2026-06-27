// Open Pages — post detail route (Stage 4). /open-pages/[id]
//
// The site is a static export (next.config.mjs: output:'export'), so a dynamic
// segment must enumerate its paths at BUILD time via generateStaticParams. We
// mirror the working app/stories/[slug] + app/reader/[slug] pattern: this server
// component lists every published post id from RTDB at build, and the actual
// fetch + render happens client-side in page-client.js (posts read live so the
// page reflects edits without a rebuild). Posts created after the last build are
// covered on the next deploy, exactly like CMS stories.

import OpenPageDetailClient from './page-client';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

const SITE_URL = 'https://calvaryscribblings.co.uk';
const OG_DEFAULT = `${SITE_URL}/og-default.png`;

// Read a single published post by id at build time, using the same lazy
// firebase/app + firebase/database client pattern generateStaticParams uses.
// Returns the post object, or null if missing / on error.
async function fetchPost(id) {
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, get } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);
    const snap = await get(ref(db, `open_pages/${id}`));
    if (snap.exists()) return snap.val();
  } catch (e) {
    console.error('open-pages fetchPost error:', e);
  }
  return null;
}

// Strip Markdown to plain text and truncate to 160 chars for meta descriptions.
function plainExcerpt(markdown) {
  if (!markdown || typeof markdown !== 'string') return '';
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')      // fenced code blocks
    .replace(/`[^`]*`/g, ' ')             // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/^>+\s?/gm, '')              // blockquotes
    .replace(/^#{1,6}\s+/gm, '')          // headings
    .replace(/^\s*[-*+]\s+/gm, '')        // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')        // ordered list markers
    .replace(/[*_~]/g, '')                // emphasis / strikethrough
    .replace(/\s+/g, ' ')                 // collapse whitespace
    .trim();
  return text.length > 160 ? text.slice(0, 160) : text;
}

export async function generateMetadata({ params }) {
  const { id } = params;
  const post = await fetchPost(id);

  if (!post || !post.title) {
    return {
      title: 'Open Pages · Calvary Scribblings',
      description: 'Community writing on Calvary Scribblings.',
    };
  }

  const title = post.title;
  const description = plainExcerpt(post.body);
  const url = `${SITE_URL}/open-pages/${id}`;
  const image = post.coverImage || OG_DEFAULT;

  return {
    title: `${title} · Open Pages · Calvary Scribblings`,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Calvary Scribblings',
      images: [{ url: image, width: 1200, height: 630 }],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export async function generateStaticParams() {
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getDatabase, ref, get } = await import('firebase/database');
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const db = getDatabase(app);
    const snap = await get(ref(db, 'open_pages'));
    if (snap.exists()) {
      const ids = Object.keys(snap.val());
      if (ids.length) return ids.map((id) => ({ id }));
    }
  } catch (e) {
    console.error('open-pages generateStaticParams error:', e);
  }
  // output:'export' requires a dynamic segment to emit at least one path. When
  // there are no published posts yet (empty open_pages), emit a single throwaway
  // id so the build stays green — page-client.js renders its not-found state for
  // it, and real posts are picked up on the next deploy.
  return [{ id: 'none' }];
}

export default function OpenPageDetailPage({ params }) {
  return <OpenPageDetailClient params={params} />;
}
