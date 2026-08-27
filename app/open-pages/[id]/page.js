// Open Pages — post detail route (Stage 4). /open-pages/[id]
//
// The site is a static export (next.config.mjs: output:'export'), so a dynamic
// segment must enumerate its paths at BUILD time via generateStaticParams. We
// mirror the working app/stories/[slug] + app/reader/[slug] pattern: this server
// component lists every published post id from RTDB at build, and the actual
// fetch + render happens client-side in page-client.js (posts read live so the
// page reflects edits without a rebuild). Posts created after the last build are
// covered on the next deploy, exactly like CMS stories.

import { buildRead } from '../../lib/build-read.mjs';
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
// ⛔ PL-12 — ONE GUARDED READ OF open_pages, memoised, feeding both the params and every
// page's metadata.
//
// /open-pages is a client-side live query and ships whatever the node holds at view time; every
// /open-pages/{id} is static and enumerated below. An unreadable node emitted the single
// throwaway `none` id, so the index listed every community post and every card 404'd. The same
// shape as the bookstore shelf without its detail pages.
//
// It also replaces a per-post read whose catch returned null — a page shipping under the
// generic "Open Pages · Calvary Scribblings" title with no excerpt and no card image, which
// looks like a post nobody wrote rather than a build that half-failed.
let _openPages;
function readOpenPages() {
  if (!_openPages) {
    _openPages = buildRead(
      'open_pages',
      '/open-pages/[id] — the page for every post the index links to',
      async () => {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getDatabase, ref, get } = await import('firebase/database');
        const app = getApps().length ? getApps()[0] : initializeApp(FB);
        const snap = await get(ref(getDatabase(app), 'open_pages'));
        return snap.exists() ? snap.val() || {} : {};
      },
    );
  }
  return _openPages;
}

async function fetchPost(id) {
  return (await readOpenPages())[id] ?? null;
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
  const ids = Object.keys(await readOpenPages());
  if (ids.length) return ids.map((id) => ({ id }));
  // output:'export' requires a dynamic segment to emit at least one path. EMPTY IS A VALID
  // ANSWER — no posts published yet — so a throwaway id keeps the build green and
  // page-client.js renders its not-found state for it. Unreachable never reaches this line;
  // that is the split PL-12 put in. See app/lib/build-read.mjs.
  return [{ id: 'none' }];
}

export default function OpenPageDetailPage({ params }) {
  return <OpenPageDetailClient params={params} />;
}
