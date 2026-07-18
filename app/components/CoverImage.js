'use client';
import { useEffect, useRef, useState } from 'react';

// One cover image, done right (Phase B):
//   • reserves its box up front (aspect-ratio or explicit w/h) → ZERO CLS,
//   • paints the blurhash from coverHash as an instant placeholder,
//   • serves w360/w720 WebP derivatives via srcset (the original only when `hero`),
//   • fades the real image in over the blurhash once decoded.
//
// The 150/150 coverHash strings finally earn their keep here. Everything degrades:
// no coverSizes → the original; no coverHash → a flat tint; no JS → the <img> with
// its srcset still loads.

// ── Minimal blurhash decoder (woltapp/blurhash reference algorithm, inlined so no
//    client dependency is added to hot routes). Decodes to an RGBA byte array. ──
const D83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const dec83 = (s) => { let v = 0; for (let i = 0; i < s.length; i++) v = v * 83 + D83.indexOf(s[i]); return v; };
const toLinear = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const toSRGB = (v) => { const x = Math.max(0, Math.min(1, v)); return x <= 0.0031308 ? Math.round(x * 12.92 * 255 + 0.5) : Math.round((1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255 + 0.5); };
const signPow = (v, e) => (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e);

function decodeBlurhash(hash, width, height, punch = 1) {
  if (!hash || hash.length < 6) return null;
  try {
    const sizeFlag = dec83(hash[0]);
    const numY = Math.floor(sizeFlag / 9) + 1;
    const numX = (sizeFlag % 9) + 1;
    const maxAC = (dec83(hash[1]) + 1) / 166;
    const colors = new Array(numX * numY);
    for (let i = 0; i < colors.length; i++) {
      if (i === 0) {
        const v = dec83(hash.substring(2, 6));
        colors[i] = [toLinear(v >> 16), toLinear((v >> 8) & 255), toLinear(v & 255)];
      } else {
        const v = dec83(hash.substring(4 + i * 2, 6 + i * 2));
        const q = maxAC * punch;
        colors[i] = [
          signPow((Math.floor(v / (19 * 19)) - 9) / 9, 2) * q,
          signPow((Math.floor(v / 19) % 19 - 9) / 9, 2) * q,
          signPow((v % 19 - 9) / 9, 2) * q,
        ];
      }
    }
    const px = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < numY; j++) {
          for (let i = 0; i < numX; i++) {
            const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
            const c = colors[i + j * numX];
            r += c[0] * basis; g += c[1] * basis; b += c[2] * basis;
          }
        }
        const k = (y * width + x) * 4;
        px[k] = toSRGB(r); px[k + 1] = toSRGB(g); px[k + 2] = toSRGB(b); px[k + 3] = 255;
      }
    }
    return px;
  } catch { return null; }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch {}
  }, []);
  return reduced;
}

export default function CoverImage({
  cover, coverSizes, coverHash, alt = '',
  sizes = '50vw', hero = false, fill = false,
  width, height, aspectRatio = '3 / 4', radius = 0,
  loading, decoding = 'async', style, imgStyle, className,
}) {
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !coverHash) return;
    const w = 32, h = 40; // 4:5-ish tiny raster; CSS stretches it under object-fit
    const px = decodeBlurhash(coverHash, w, h);
    if (!px) return;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(px, w, h), 0, 0);
  }, [coverHash]);

  // srcset: cards pull only the derivatives; the hero adds the original as the top rung.
  const rungs = [];
  if (coverSizes?.w360) rungs.push(`${coverSizes.w360} 360w`);
  if (coverSizes?.w720) rungs.push(`${coverSizes.w720} 720w`);
  if (hero && cover) rungs.push(`${cover} 1600w`);
  const srcSet = rungs.length ? rungs.join(', ') : undefined;
  const src = hero ? cover : (coverSizes?.w360 || coverSizes?.w720 || cover);

  const wrapStyle = {
    position: fill ? 'absolute' : 'relative',
    ...(fill ? { inset: 0 } : { width: width ?? '100%', height: height ?? undefined, aspectRatio: height ? undefined : aspectRatio }),
    overflow: 'hidden',
    background: '#1a1030',
    borderRadius: radius || undefined,
    ...style,
  };
  const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

  return (
    <span className={className} style={wrapStyle}>
      <canvas ref={canvasRef} aria-hidden style={{ ...layer, opacity: loaded ? 0 : 1, transition: reduced ? 'none' : 'opacity 0.5s ease 0.05s' }} />
      <img
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        loading={loading || (hero ? 'eager' : 'lazy')}
        decoding={decoding}
        onLoad={() => setLoaded(true)}
        style={{ ...layer, opacity: loaded ? 1 : 0, transition: reduced ? 'none' : 'opacity 0.5s ease', ...imgStyle }}
      />
    </span>
  );
}
