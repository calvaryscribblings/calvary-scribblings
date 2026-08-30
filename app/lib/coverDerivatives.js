'use client';
// Client-side cover derivative generation for the stories CMS — the "door does
// the sizing" technique proven on /admin/voices. The CMS is the only way a cover
// reaches the library, so it is where every cover is sized from birth: w360 +
// w720 WebP cut in the browser and uploaded beside the original, all with
// long-cache metadata. Path scheme matches scripts/backfill-cover-derivatives.mjs
// (covers/{slug}/w{width}.webp) so a re-upload replaces rather than accumulates.
//
// Encoder logic is intentionally identical to the voices copy; it lives here
// separately so the working voices path is never touched.

export const COVER_DERIVATIVE_WIDTHS = [360, 720];
export const coverSizeKey = (w) => `w${w}`;
export const COVER_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DERIVATIVE_QUALITY = 0.82;

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    return { bitmap: bmp, release: () => bmp.close && bmp.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('Could not decode that image.'));
    img.src = url;
  });
  return { bitmap: img, release: () => URL.revokeObjectURL(url) };
}

// Repeated halving until the last step avoids the aliasing a one-shot downscale
// inflicts on detailed art.
function drawScaled(bitmap, targetW) {
  const srcW = bitmap.width || bitmap.naturalWidth;
  const srcH = bitmap.height || bitmap.naturalHeight;
  if (!srcW || !srcH) throw new Error('Could not read the image dimensions.');

  let cur = document.createElement('canvas');
  cur.width = srcW; cur.height = srcH;
  cur.getContext('2d').drawImage(bitmap, 0, 0);

  let w = srcW;
  while (w > targetW * 2) {
    const next = document.createElement('canvas');
    next.width = Math.max(targetW, Math.round(w / 2));
    next.height = Math.round(next.width * srcH / srcW);
    const cx = next.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
    w = next.width;
  }

  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = Math.round(targetW * srcH / srcW);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

const encode = (canvas, type) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, DERIVATIVE_QUALITY));

// toBlob does NOT reject an unsupported type — per spec it silently falls back to
// PNG, and a PNG derivative would be heavier than the original we are shrinking.
// So the blob is trusted only when it returns as the type actually asked for.
async function encodeBest(canvas) {
  const webp = await encode(canvas, 'image/webp');
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', type: 'image/webp' };
  const jpeg = await encode(canvas, 'image/jpeg');
  if (jpeg && jpeg.type === 'image/jpeg') return { blob: jpeg, ext: 'jpg', type: 'image/jpeg' };
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// R29 — THE INLINE STAND-IN, CUT AT THE SAME DOOR
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// A 16px-wide WebP data URI, from the SAME file and the SAME repeated-halving downscale the
// rungs above use. It is not uploaded anywhere: it is stored on the title record and travels
// inside a payload the page has already fetched, because a stand-in that needs its own request
// has not solved the problem it exists for. See coverLqip() in app/lib/bookstore/covers.js for
// the measurements and for why this is a data URI and not the blurhash the story library uses.
//
// ⚠ toDataURL RATHER THAN toBlob, and that is the whole reason this is a separate function
// rather than another width passed to buildCoverDerivatives: everything above ends as an
// upload and this one must end as a STRING.
//
// NEVER THROWS, for the same reason stated below and at uploadCoverDerivatives: a title that
// saves without a stand-in draws the plate it drew before this round. A cover that will not
// save is a book the shop does not have.
export async function buildCoverLqip(file, opts = {}) {
  const width = opts.width || 16;
  const quality = opts.quality ?? 0.4;
  let handle = null;
  try {
    handle = await loadBitmap(file);
    const canvas = drawScaled(handle.bitmap, width);
    // The same trust-what-you-asked-for check encodeBest makes: toDataURL silently falls back
    // to PNG for a type the browser cannot encode, and a PNG at this size is several times a
    // WebP. A PNG stand-in is not worth carrying, so an engine without WebP simply gets none.
    const uri = canvas.toDataURL('image/webp', quality);
    return uri.startsWith('data:image/webp') ? uri : null;
  } catch (err) {
    console.warn('[coverDerivatives] stand-in generation failed; the board keeps its plate', err);
    return null;
  } finally {
    try { handle?.release(); } catch { /* the bitmap is already gone */ }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════
// R30 — THE DOMINANT COLOUR, CUT AT THE SAME DOOR AND IN THE SAME BREATH
// ══════════════════════════════════════════════════════════════════════════════════════
//
// The shelf is arranged by colour now (Ikenna, 30 Aug 2026), so every cover has to know what
// colour it is — and it has to know BEFORE the shop paints, because a static export has no
// server and there is no moment in which twenty-two covers could be decoded to decide an
// order. So the colour is cut HERE, from the same File, on the same repeated-halving
// downscale, in the same handful of milliseconds R29 already spends cutting the stand-in.
//
// ⚠ THE ARITHMETIC IS NOT HERE. dominantColourFromPixels lives in
// app/lib/bookstore/spectrum.js and takes a raw pixel buffer, knowing nothing about canvases
// or files. That is deliberate and it is the reason this round has one extractor rather than
// two: the backfill runs the identical function over sharp's raw output. A browser copy and a
// node copy of a histogram would agree on the day they were written and drift by the second
// time either was touched, and the shelf order would then depend on WHICH DOOR a cover came
// through — the exact class of bug R20's two writers and R29's two writers were each built to
// avoid.
//
// NEVER THROWS, for the third time in this file and for the same reason. A title that saves
// without a colour is filed at the end of the walk by arrangeShelf, visible and obviously
// un-arranged. A cover that will not save is a book the shop does not have.
export async function buildCoverColour(file, opts = {}) {
  const width = opts.width || 48;
  let handle = null;
  try {
    handle = await loadBitmap(file);
    const canvas = drawScaled(handle.bitmap, width);
    const { data } = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height);
    const { dominantColourFromPixels } = await import('./bookstore/spectrum');
    const cut = dominantColourFromPixels(data, 4);
    if (!cut) return null;
    // `share` is an extraction statistic, not a property of a book — see the note on it in
    // spectrum.js. Only the five stored values leave this function.
    const { h, s, l, c, hex, v } = cut;
    return { h, s, l, c, hex, v };
  } catch (err) {
    console.warn('[coverDerivatives] colour extraction failed; the book files at the end of the walk', err);
    return null;
  } finally {
    try { handle?.release(); } catch { /* the bitmap is already gone */ }
  }
}

// Returns { w360, w720 } download URLs (partial or {} on failure). Never throws:
// a cover that uploads without derivatives simply falls back to the original in
// srcset — heavier, but a failed derivative must never block publishing.
// R20 — `opts` was added so the BOOKSTORE could reuse this encoder instead of becoming a
// third copy of it. The voices copy carries a note saying it exists "so the working voices
// path is never touched"; that argument justifies two copies, not three, and a third would be
// the same repeated-halving downscale and the same WebP/JPEG fallback maintained in yet
// another place.
//
// BOTH OPTIONS DEFAULT TO EXACTLY WHAT THIS FUNCTION ALREADY DID, so the stories CMS calls it
// unchanged and lands on the same `covers/{slug}/w{width}.webp` objects it always has. The
// bookstore passes its own because storage.rules matches `bookstore_covers/{titleId}` on a
// SINGLE path segment — a nested derivative there matches no rule and is denied both ways.
export async function buildCoverDerivatives(storage, file, slug, onProgress, opts = {}) {
  const widths = opts.widths || COVER_DERIVATIVE_WIDTHS;
  const pathFor = opts.pathFor || ((w, ext) => `covers/${slug}/${coverSizeKey(w)}.${ext}`);
  const out = {};
  let handle;
  try {
    handle = await loadBitmap(file);
  } catch (e) {
    console.warn('cover derivatives: could not decode the cover for resizing', e);
    return out;
  }
  try {
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    for (const w of widths) {
      try {
        if (onProgress) onProgress(w);
        const encoded = await encodeBest(drawScaled(handle.bitmap, w));
        if (!encoded) { console.warn(`cover derivatives: no WebP/JPEG encoder for ${w}w`); continue; }
        const dRef = ref(storage, pathFor(w, encoded.ext));
        await uploadBytes(dRef, encoded.blob, { contentType: encoded.type, cacheControl: COVER_CACHE_CONTROL });
        out[coverSizeKey(w)] = await getDownloadURL(dRef);
      } catch (e) {
        console.warn(`cover derivatives: ${w}w derivative failed`, e);
      }
    }
  } finally {
    handle.release();
  }
  return out;
}
