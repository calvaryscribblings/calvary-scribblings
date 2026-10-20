// THE CARD CODE — a QR of the story's own URL, and the proof that it scans.
//
// Encoding is `qrcode` and decoding is `jsQR`, both pinned exactly in scripts/cards/package.json
// so neither reaches the site's install. The decoder is run with inversionAttempts 'dontInvert'.
// A phone that reads a light-on-dark code is being generous. The spec is dark modules on a light
// ground, and a code that only scans inverted is a code that fails on some readers.
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { QR, SITE, PX_PER_MM } from './geometry.mjs';

/**
 * The code's matrix for a site path (`/stories/slug`), at the ruled error correction. `version`
 * pins the symbol size, so a set of cards can share one (the picture cards do); without it the
 * encoder picks the smallest that fits.
 */
export function encode(path, { version } = {}) {
  const text = `${SITE}${path}`;
  const q = QRCode.create(text, { errorCorrectionLevel: QR.ecc, ...(version ? { version } : {}) });
  return { text, version: q.version, size: q.modules.size, get: (r, c) => q.modules.get(r, c) };
}

/** Panel side in device px, quiet zone included. */
export const panelPx = (code) => (code.size + 2 * QR.quietModules) * QR.modulePx;

/**
 * Draw the code with its panel's top-left at device px (x, y). Whole device pixels throughout,
 * so every module is exactly modulePx square and no edge is anti-aliased.
 * `panel` null draws no panel (the modules sit on the ground as it is).
 */
export function drawCode(ctx, code, x, y, { dark, panel }) {
  const m = QR.modulePx;
  const X = Math.round(x), Y = Math.round(y);
  ctx.save();
  ctx.resetTransform?.();
  ctx.imageSmoothingEnabled = false;
  if (panel) { ctx.fillStyle = panel; ctx.fillRect(X, Y, panelPx(code), panelPx(code)); }
  ctx.fillStyle = dark;
  const o = QR.quietModules * m;
  for (let r = 0; r < code.size; r++) {
    for (let c = 0; c < code.size; c++) if (code.get(r, c)) ctx.fillRect(X + o + c * m, Y + o + r * m, m, m);
  }
  ctx.restore();
}

/** Decode from a raster, never trying the inverted image. Returns the text or null. */
export function decode(imageData) {
  const hit = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
  return hit ? hit.data : null;
}

export const moduleMm = QR.modulePx / PX_PER_MM;
