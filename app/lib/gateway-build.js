// Build-time reads of cms_stories, for the gateway server page (app/page.js).
//
// SERVER ONLY. Mirrors app/lib/voices-build.js: deliberately does NOT import
// app/lib/firebase.js (that module calls getAuth()/getStorage() at import time, pulling
// browser-only surface into a Node build). This initialises the same project with only
// the RTDB pieces a build needs.
//
// Why bake at all — the gateway is contractually zero-Firebase at runtime (no client
// cms_stories fetch), so the honest story count and the door's rotating whispers must be
// baked into the static export at build time. The existing deploy-on-publish hook rebuilds
// the site on every CMS mutation, so the baked numbers self-update and are never stale for
// long. This is the same seed-at-build pattern the Voices pages use.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';
import { buildReadOptional } from './build-read.mjs';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

function buildDB() {
  return getDatabase(getApps().length ? getApps()[0] : initializeApp(FB));
}

// Read source is cms_stories_index (the slim ~85 KB public read-model), not the
// full 1.2 MB cms_stories node — the count and whispers need only published/
// publishAt/trailerQuote/title, all of which the index carries. The index already
// excludes hidden rows, so isPublished() below only re-applies the publishAt gate.
//
// "Published" here matches the public-library gate exactly (page.js line ~998):
// published !== false, and any publishAt has already passed as of the build.
function isPublished(s, now) {
  return s && s.published !== false && (!s.publishAt || new Date(s.publishAt) <= now);
}

const MAX_WHISPERS = 12;
const WHISPER_MAX_CHARS = 140;

// The cover wall (the hero under-layer). The WebP tiles and this manifest are cut at build
// time by scripts/generate-gateway-wall.mjs, which runs before `next build`. We read ONLY
// the manifest here — plain fs, no sharp — so the native module stays out of the Next app
// graph. A missing/broken manifest degrades to an empty wall (the gateway shows its
// radial-gradient background through instead), never a throw.
async function readWallManifest() {
  try {
    const raw = await readFile(resolve(process.cwd(), 'public', 'gateway-wall', 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.images) ? parsed.images : [];
  } catch {
    return [];
  }
}

// Returns { storyCount, whispers, wall } baked for the gateway:
//   storyCount — count of published cms_stories (item 7, "the honest number").
//   whispers   — up to 12 published stories that carry a trailerQuote, preferring the
//                shortest (under ~140 chars) so the epigraph stays to three lines.
//                Shape: { quote, title }. No author, no cover — the gateway needs nothing
//                more, and the smaller the baked payload the better.
//   wall       — the cover-wall tiles ({ src, w, h }) read from the manifest the pre-build
//                script cut. Independent of the Firebase read: the wall stands (or falls to
//                empty) on its own manifest, so a Firebase blip that zeroes the count still
//                leaves the wall, and a missing wall still leaves the count.
// A failed Firebase read degrades to zeroes/empty rather than throwing: a blip should leave
// the gateway standing (count line hidden, no whispers), not fail the deploy.
// ⛔ PL-12 — THE ONLY READ ALLOWED TO DEGRADE, AND THE ARGUMENT IS HERE.
//
// It was one of two until R24.1 (27 Aug 2026). The other, app/u/[handle]/page.js, was
// granted its exception on the premise that a static /u/<handle> page shadows the
// /u/:handle → /user?handle=:handle redirect. Measurement showed the reverse — Cloudflare
// applies the rule whether or not an asset matches — so the pages it was protecting had
// never been served, and the route went. Decoration is the whole of the remaining case.
//
// Ikenna's ruling of 27 August 2026 is that a build which cannot read the catalogue FAILS
// rather than publishing a diminished site. This is a named exception to it, accepted on the
// argument that WHAT THIS READ FEEDS IS DECORATION:
//
//   · storyCount — a number under the hero. Renders as 0.
//   · whispers   — the rotating quotes. The rotator simply has nothing to rotate.
//   · wall       — the cover mosaic behind the hero, already darkened to brightness(0.35)
//                  behind a scrim. The radial-gradient background shows through instead.
//
// NOTHING 404s. No link goes anywhere it did not go before, no page loses content, and no
// reader meets a dead end. That is the test to apply to any future candidate for this
// treatment, and it is the test the bookstore, the library, the voices, the series and Open
// Pages all FAIL — each of those pairs a live client-side index with static detail pages, so a
// missing read there ships a list whose items do not open.
//
// ⚠ IT STILL CARRIES THE DEADLINE AND THE FOUR ATTEMPTS. Degrading is about the OUTCOME, never
// about the waiting: firebase/database's get() never settles on an unreachable database
// (measured — see app/lib/build-read.mjs), so without the deadline this "harmless" read would
// hang the whole build just as completely as a required one. A hang is not a degraded build.
export async function fetchGatewayData() {
  const wall = await readWallManifest();
  const data = await buildReadOptional(
    'cms_stories_index',
    null,
    'the gateway\'s story count, whispers and cover wall are decoration — the gateway stands '
      + 'without them and nothing 404s',
    async () => {
      const snap = await get(ref(buildDB(), 'cms_stories_index'));
      return snap.exists() ? snap.val() || {} : {};
    },
  );
  if (!data) return { storyCount: 0, whispers: [], wall };

  const now = new Date();
  const published = Object.values(data).filter((s) => isPublished(s, now));

  const withQuote = published
    .map((s) => ({
      quote: typeof s.trailerQuote === 'string' ? s.trailerQuote.trim() : '',
      title: typeof s.title === 'string' ? s.title.trim() : '',
    }))
    .filter((w) => w.quote && w.title);

  // Prefer the shortest quotes (those under the cap lead), then take the first 12.
  withQuote.sort((a, b) => {
    const au = a.quote.length <= WHISPER_MAX_CHARS ? 0 : 1;
    const bu = b.quote.length <= WHISPER_MAX_CHARS ? 0 : 1;
    if (au !== bu) return au - bu;
    return a.quote.length - b.quote.length;
  });

  return { storyCount: published.length, whispers: withQuote.slice(0, MAX_WHISPERS), wall };
}
