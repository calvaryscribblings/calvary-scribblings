// THE WRITE LAYER — everything that puts a generated cover into Storage and RTDB.
//
// This file exists because there are now TWO callers that flip a cover, and a flip is not a
// thing that may be written twice:
//
//   scripts/covers/migrate.mjs     — the one-off sweep that made the library typographic
//   scripts/covers/on-publish.mjs  — the standing reconciler that keeps it that way
//
// The migration learned four things the hard way, each of them a live incident, and every one
// of them is a property of the WRITE rather than of the render. Leaving them in migrate.mjs
// would mean the reconciler — which runs unattended, every day, forever — inherited none of
// them. So they live here, once:
//
//   1. THE UNIT IS SIX FIELDS ACROSS TWO NODES, IN ONE PATCH. `cover` is only the srcset's
//      top rung and the fallback; `coverSizes.w360` / `.w720` are what the site actually
//      renders nearly everywhere, and `coverHash` is the blurhash painted underneath. All
//      three are mirrored on cms_stories_index, which is what the app, search, profile and
//      author surfaces read. Flip a subset and the library is half-migrated in a way only a
//      reader would notice.
//
//   2. THE INDEX RECORD IS RE-PROJECTED, NEVER DEEP-PATHED. A deep path
//      (`cms_stories_index/<slug>/cover`) CREATES THE PARENT when the slug has no entry,
//      materialising a stub record with a cover and no title, no authorUid and no date, that
//      still counts as a member of the index. That is exactly how
//      cms_stories_index/your-money-cannot-save-you lost its authorUid and dropped a story
//      off its author's Voices page. buildIndexRecord projects the WHOLE record from the
//      merged story: complete by construction, and self-healing when the entry was missing.
//
//   3. GENERATION-2 PATHS ARE CONTENT-ADDRESSED. Objects carry
//      `cache-control: immutable, max-age=31536000`, and that promise is only honest if the
//      bytes at a URL never change. Keying the directory on the render's own sha makes the
//      path a function of the image: a changed cover always gets a fresh URL, an unchanged
//      one lands on the URL it already has, and no generation overwrites another.
//
//   4. `access_token=`, NOT `auth=`. The `auth` parameter is for legacy database secrets and
//      Firebase ID tokens; a Google OAuth2 access token presented there is rejected with a
//      bare HTTP 401 "Permission denied" that reads exactly like a rules problem and is not
//      one. It cost an entire 158-story run to learn.
//
// Nothing in this file renders. Nothing in it decides WHETHER a cover should change — that is
// the caller's business. It only knows how to put one somewhere without lying about it.
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { buildIndexRecord } from '../../app/lib/storyIndex.js';

export const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
export const BUCKET = 'calvary-scribblings.firebasestorage.app';
export const CACHE = 'public, max-age=31536000, immutable';
export const WIDTHS = [360, 720];
export const WEBP_QUALITY = 82;
export const NEW_PREFIX = 'covers-typographic';

// The ONE node any automatic cover writer ever reads. Named as a constant so callers can
// assert it, and so that widening the scope is a visible, deliberate edit rather than a quiet
// one. See assertStoryScope below.
export const SOURCE_NODE = 'cms_stories';

export const sha = (b) => createHash('sha256').update(b).digest('hex');
export const sha12 = (b) => sha(b).slice(0, 12);

/** The directory a render belongs in. A pure function of the slug and the bytes — see (3). */
export const coverDir = (slug, png) => `${NEW_PREFIX}/${slug}/${sha12(png)}`;

/**
 * SERIES IS OUT OF SCOPE BY RULING, AND THIS IS WHERE THE RULING IS ENFORCED.
 *
 * 18 Aug 2026, on seeing the Beta Princess poster survive the first sweep:
 *
 *     "Beautiful accident. I like the way it sits on the page. Let Series be the only
 *      category that will explore actual arts."
 *
 * The story library is typographic by rule; SERIES COVERS ARE CURATED ARTWORK BY RULE. See
 * CLAUDE.md, "Covers: two rules, and they are different rules". A sweep that "fixed" a series
 * poster would be reverting an editorial decision, not tidying up an omission.
 *
 * Records drawn from cms_stories cannot be series instalments, so in normal operation this
 * asserts something already true. It is asserted anyway, and it is asserted HERE rather than
 * in one caller, because the reconciler runs unattended: the cost of asserting is nothing and
 * the cost of a silent scope creep is a poster somebody chose being overwritten by a robot at
 * three in the morning.
 *
 * Throws. Never warns.
 */
export function assertStoryScope(sourceNode, stories) {
  if (sourceNode !== SOURCE_NODE) {
    throw new Error(`REFUSED — an automatic cover writer may only read ${SOURCE_NODE}, not ${sourceNode}`);
  }
  const seriesish = stories.filter((s) => {
    const r = s.story ?? s;
    return r?.seriesId || r?.instalmentId || r?.ordinal != null;
  });
  if (seriesish.length) {
    const names = seriesish.slice(0, 4).map((s) => s.slug ?? '(unnamed)').join(', ');
    throw new Error(
      `REFUSED — ${seriesish.length} record(s) look like series instalments: ${names}.\n` +
      '  Series covers are curated artwork BY RULING and no automatic generator ever touches them.',
    );
  }
}

/** Derivatives + blurhash from a rendered PNG. Same widths, quality and 4x3 components the
 *  CMS upload path uses (app/admin/page.js computeBlurhash), so a generated cover is
 *  indistinguishable from one uploaded through the door. */
export async function deriveFrom(png) {
  const sharp = (await import('sharp')).default;
  const { encode: blurhashEncode } = await import('blurhash');
  const sizes = {};
  for (const w of WIDTHS) {
    sizes[`w${w}`] = await sharp(png).resize({ width: w, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
  }
  const small = await sharp(png).resize({ width: 64 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hash = blurhashEncode(new Uint8ClampedArray(small.data), small.info.width, small.info.height, 4, 3);
  return { sizes, hash };
}

export const downloadUrl = (path, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

/** True when `url` is a Firebase download URL for exactly `path`. The staleness test in
 *  on-publish.mjs stands on this: the object path carries the render's own hash, so a URL
 *  that names the expected path IS the proof that the bytes behind it are the current ones. */
export function urlPointsAt(url, path) {
  return typeof url === 'string' && url.includes(`/o/${encodeURIComponent(path)}?`);
}

/** Upload the PNG and both WebP rungs into `dir`. Returns the three URLs. */
export async function uploadCoverSet(bucket, dir, png, sizes) {
  const put = async (path, buf, contentType) => {
    const t = randomUUID();
    await bucket.file(path).save(buf, {
      contentType,
      metadata: { cacheControl: CACHE, metadata: { firebaseStorageDownloadTokens: t } },
    });
    return downloadUrl(path, t);
  };
  const cover = await put(`${dir}/cover.png`, png, 'image/png');
  const coverSizes = {};
  for (const w of WIDTHS) coverSizes[`w${w}`] = await put(`${dir}/w${w}.webp`, sizes[`w${w}`], 'image/webp');
  return { cover, coverSizes };
}

/**
 * THE FLIP, AS A SET OF PATHS — one atomic patch, two nodes.
 *
 * A root-level PATCH with deep paths is applied by RTDB as a single transaction, which is
 * what makes a story's flip atomic: there is no instant at which cms_stories points at the
 * new cover while cms_stories_index still points at the old one.
 *
 * NOTE THE ASYMMETRY, WHICH IS NOT A STYLE CHOICE. cms_stories takes deep paths — a merge
 * that leaves every other field alone. cms_stories_index MUST NOT; it is re-projected whole.
 * See (2) at the top of this file.
 *
 * `extra` is for the fields that must not be allowed to travel SEPARATELY from the cover.
 * There are two, and both are the same kind of promise:
 *
 *   • `descriptor` — the three words the cover DISPLAYS. Writing the words in one patch and
 *     the picture in another leaves a window, however short, in which a story claims three
 *     words no reader can see on its cover.
 *   • `published`  — a story held back because it had no cover yet is published BY the patch
 *     that gives it one, so it is never visible without it.
 *
 * Both are merged into the record before the index is projected, so the index says the same
 * thing as the record in the same instant.
 */
export function coverFlipPaths(slug, story, { cover, coverSizes, coverHash }, extra = {}) {
  const merged = { ...story, cover, coverSizes, coverHash, ...extra };
  return {
    [`${SOURCE_NODE}/${slug}/cover`]: cover,
    [`${SOURCE_NODE}/${slug}/coverSizes`]: coverSizes,
    [`${SOURCE_NODE}/${slug}/coverHash`]: coverHash,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`${SOURCE_NODE}/${slug}/${k}`, v])),
    [`cms_stories_index/${slug}`]: buildIndexRecord(slug, merged),
  };
}

/** See (4) at the top of this file: `access_token=`, never `auth=`. */
export async function rtdbPatch(token, updates) {
  const res = await fetch(`${DB_URL}/.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`RTDB PATCH failed: HTTP ${res.status} ${await res.text()}`);
}

export async function accessToken(svc) {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    credentials: svc,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  return (await (await auth.getClient()).getAccessToken()).token;
}
