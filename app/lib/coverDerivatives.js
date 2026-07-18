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

// Returns { w360, w720 } download URLs (partial or {} on failure). Never throws:
// a cover that uploads without derivatives simply falls back to the original in
// srcset — heavier, but a failed derivative must never block publishing.
export async function buildCoverDerivatives(storage, file, slug, onProgress) {
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
    for (const w of COVER_DERIVATIVE_WIDTHS) {
      try {
        if (onProgress) onProgress(w);
        const encoded = await encodeBest(drawScaled(handle.bitmap, w));
        if (!encoded) { console.warn(`cover derivatives: no WebP/JPEG encoder for ${w}w`); continue; }
        const dRef = ref(storage, `covers/${slug}/${coverSizeKey(w)}.${encoded.ext}`);
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
