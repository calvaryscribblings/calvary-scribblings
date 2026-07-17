// Build-time generator for the gateway's cover wall (the hero under-layer at /).
//
// WHAT IT DOES
//   Selects the 12 most recent published cms_stories that carry a cover image, fetches
//   each cover, and cuts a small 2:3 WebP derivative (240×360) into public/gateway-wall/.
//   Writes public/gateway-wall/manifest.json listing the tiles the Gateway renders. The
//   selection is deterministic per build (newest-first by publishAt||date), so the wall
//   refreshes as the island publishes — the deploy-on-publish hook rebuilds on every CMS
//   mutation, exactly as the baked story count and whispers already do.
//
// WHY A PRE-BUILD SCRIPT (not app/lib/gateway-build.js)
//   sharp is a native module and the derivative-cutting must NOT be pulled into the Next
//   app graph (app/lib/gateway-build.js is imported by app/page.js). Keeping it here — a
//   plain node .mjs run before `next build`, the same slot generate-redirects.mjs occupies —
//   keeps the RSC render pure and sharp out of the bundle. gateway-build.js reads only the
//   manifest JSON this writes (fs, no sharp). The zero-runtime-Firebase contract is intact:
//   this reads Firebase at BUILD time, never at runtime.
//
// WHY REST, NOT THE FIREBASE SDK
//   The SDK opens a persistent WebSocket that keeps Node alive and hangs the build. We need
//   a single read of cms_stories, so REST is simpler and exits cleanly — the same reason and
//   the same public-read access generate-redirects.mjs relies on.
//
// NEVER FAILS THE BUILD OVER THE WALL
//   A cover fetch that errors is skipped. A Firebase read that fails degrades to an empty
//   manifest. The gateway stands with no wall (the radial-gradient background shows through)
//   rather than the deploy failing. Exit code is always 0.

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'public', 'gateway-wall');
const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const TILE_W = 240;
const TILE_H = 360; // 2:3, matches the mosaic tile the Gateway renders
const MAX_TILES = 12;
const PER_TILE_MAX = 25 * 1024; // ≤25KB each
const TOTAL_MAX = 300 * 1024; // ≤300KB for the whole wall
// Descending quality ladder: take the first rung that lands a tile under the per-tile cap.
// The wall is darkened to brightness(0.35) behind a scrim in the browser, so aggressive
// compression is invisible — these are glimpsed shelves, not a gallery.
const QUALITY_LADDER = [72, 60, 50, 42, 34, 28];

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// Mirrors app/public-library/page.js getStorySortTime: publishAt wins when valid, else date.
function sortTime(s) {
  if (s.publishAt) {
    const t = new Date(s.publishAt).getTime();
    if (!isNaN(t)) return t;
  }
  const d = new Date(s.date).getTime();
  return isNaN(d) ? 0 : d;
}

// Matches the public-library gate exactly: published !== false, and any publishAt has passed.
function isPublished(s, now) {
  return s && s.published !== false && (!s.publishAt || new Date(s.publishAt).getTime() <= now);
}

async function loadStories() {
  const res = await fetch(`${FB_DB}/cms_stories.json`);
  if (!res.ok) throw new Error(`cms_stories fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== 'object') return [];
  const now = Date.now();
  return Object.entries(data)
    .map(([slug, s]) => ({ slug, ...s }))
    .filter((s) => isPublished(s, now))
    .filter((s) => typeof s.cover === 'string' && /^https?:\/\//.test(s.cover))
    .sort((a, b) => sortTime(b) - sortTime(a))
    .slice(0, MAX_TILES);
}

// Fetch one cover and encode a 240×360 WebP under PER_TILE_MAX. Returns the buffer, or null
// on any failure (fetch error, non-image, encode failure) — the caller skips it.
async function encodeTile(story) {
  let res;
  try {
    res = await fetch(story.cover);
  } catch (e) {
    console.warn(`  ✗ ${story.slug} — cover fetch threw (${e.message}), skipped`);
    return null;
  }
  if (!res.ok) {
    console.warn(`  ✗ ${story.slug} — cover HTTP ${res.status}, skipped`);
    return null;
  }
  const original = Buffer.from(await res.arrayBuffer());
  let chosen = null;
  for (const quality of QUALITY_LADDER) {
    try {
      const out = await sharp(original)
        .resize({ width: TILE_W, height: TILE_H, fit: 'cover', position: 'attention' })
        .webp({ quality })
        .toBuffer();
      chosen = out;
      if (out.length <= PER_TILE_MAX) break; // good enough — stop stepping quality down
    } catch (e) {
      console.warn(`  ✗ ${story.slug} — sharp failed (${e.message}), skipped`);
      return null;
    }
  }
  return chosen; // smallest rung reached, even if still over cap (rare); budget check follows
}

async function main() {
  // Start clean so a shrinking selection never leaves last build's tiles behind.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  let stories = [];
  try {
    stories = await loadStories();
  } catch (e) {
    console.warn('[gateway-wall] CMS read failed, empty wall:', e.message);
  }

  console.log(`[gateway-wall] ${stories.length} candidate cover(s)`);

  const images = [];
  let total = 0;
  let i = 0;
  for (const story of stories) {
    const buf = await encodeTile(story);
    if (!buf) continue;
    // Hold the wall to its total budget: never let one more tile push us past 300KB.
    if (total + buf.length > TOTAL_MAX) {
      console.log(`  · budget reached (${kb(total)}), stopping before ${story.slug}`);
      break;
    }
    const name = `wall-${i}.webp`;
    await writeFile(resolve(OUT_DIR, name), buf);
    images.push({ src: `/gateway-wall/${name}`, w: TILE_W, h: TILE_H });
    total += buf.length;
    console.log(`  ✓ ${story.slug} → ${name} ${kb(buf.length)}`);
    i += 1;
  }

  const manifest = { images };
  await writeFile(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  console.log(`[gateway-wall] wrote ${images.length} tile(s), ${kb(total)} total`);
}

// Always exit 0: the wall is decorative, and a failed wall must never fail the deploy.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[gateway-wall] unexpected error, empty wall:', e);
    // Best effort: leave a valid empty manifest so the reader never chokes on a missing file.
    writeFile(resolve(OUT_DIR, 'manifest.json'), JSON.stringify({ images: [] }), 'utf8')
      .catch(() => {})
      .finally(() => process.exit(0));
  });
