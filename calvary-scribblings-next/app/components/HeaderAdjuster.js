'use client';
import { useState, useRef, useEffect } from 'react';

/**
 * Full-screen banner adjuster. Drag to reposition.
 * On Done: produces a cropped Blob matching banner aspect ratio.
 *
 * Props:
 *   file      — the uploaded File object
 *   onDone    — (croppedBlob, previewDataUrl) => void
 *   onCancel  — () => void
 */
export default function HeaderAdjuster({ file, onDone, onCancel }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [imgDims, setImgDims] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const containerRef = useRef(null);
  const [contDims, setContDims] = useState({ w: 0, h: 0 });

  // Load image and measure
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImgSrc(url);
      setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Measure container
  useEffect(() => {
    function measure() {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setContDims({ w: r.width, h: r.height });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [imgSrc]);

  if (!imgSrc || !imgDims) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0a0a0a', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem' }}>
        Loading image…
      </div>
    );
  }

  // Compute image display size: scale image so its shorter side fills the container
  // Then clamp offset so image edges don't show gaps.
  const imgAspect = imgDims.w / imgDims.h;
  const contAspect = contDims.w / contDims.h || 1;
  let displayW, displayH;
  if (imgAspect > contAspect) {
    // image wider than container — fit height, overflow horizontally
    displayH = contDims.h;
    displayW = displayH * imgAspect;
  } else {
    // image taller — fit width, overflow vertically
    displayW = contDims.w;
    displayH = displayW / imgAspect;
  }

  const maxOffsetX = Math.max(0, (displayW - contDims.w) / 2);
  const maxOffsetY = Math.max(0, (displayH - contDims.h) / 2);
  const clamp = (v, max) => Math.max(-max, Math.min(max, v));

  function onPointerDown(e) {
    e.preventDefault();
    setDragging(true);
    const p = e.touches ? e.touches[0] : e;
    dragStart.current = { x: p.clientX, y: p.clientY, offsetX: offset.x, offsetY: offset.y };
  }
  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - dragStart.current.x;
    const dy = p.clientY - dragStart.current.y;
    setOffset({
      x: clamp(dragStart.current.offsetX + dx, maxOffsetX),
      y: clamp(dragStart.current.offsetY + dy, maxOffsetY),
    });
  }
  function onPointerUp() { setDragging(false); }

  async function handleDone() {
    // Banner aspect ratio target: 1200 x 360 (3.33:1) — matches ~240 height / 720+ width
    const TARGET_W = 1600;
    const TARGET_H = 480;
    const targetAspect = TARGET_W / TARGET_H;

    // Visible region of the source image, in source pixel coords
    const scale = imgDims.w / displayW; // source px per display px
    const srcVisibleW = contDims.w * scale;
    const srcVisibleH = contDims.h * scale;
    // Center of visible region in source coords:
    // offset of 0 = center. positive offset.x = dragged right = show more left of image
    const srcCenterX = imgDims.w / 2 - offset.x * scale;
    const srcCenterY = imgDims.h / 2 - offset.y * scale;
    const srcX = srcCenterX - srcVisibleW / 2;
    const srcY = srcCenterY - srcVisibleH / 2;

    // But the visible region's aspect ratio = contAspect, which we want to match targetAspect
    // They might differ slightly. Crop to targetAspect centered within visible region.
    let cropW, cropH, cropX, cropY;
    if (contAspect > targetAspect) {
      cropH = srcVisibleH;
      cropW = cropH * targetAspect;
      cropX = srcX + (srcVisibleW - cropW) / 2;
      cropY = srcY;
    } else {
      cropW = srcVisibleW;
      cropH = cropW / targetAspect;
      cropX = srcX;
      cropY = srcY + (srcVisibleH - cropH) / 2;
    }

    // Draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, TARGET_W, TARGET_H);
      canvas.toBlob(blob => {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        onDone(blob, dataUrl);
      }, 'image/jpeg', 0.9);
    };
    img.src = imgSrc;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0a', zIndex: 3000, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={onCancel} style={{ background: 'transparent', border: 'none', color: '#a63d4c', fontFamily: 'Inter, sans-serif', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: '0.5rem 0.75rem' }}>Cancel</button>
        <div style={{ fontFamily: 'Georgia, serif', color: '#f0ead8', fontSize: '0.95rem' }}>Position your header</div>
        <button onClick={handleDone} style={{ background: '#6b2fad', color: '#f0ead8', border: 'none', borderRadius: 6, fontFamily: 'Inter, sans-serif', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: '0.55rem 1rem' }}>Done</button>
      </div>

      {/* Instructions */}
      <div style={{ padding: '1rem 1.25rem 0', textAlign: 'center' }}>
        <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '0.88rem', color: 'rgba(240,234,216,0.55)' }}>Drag the image to reposition</p>
      </div>

      {/* Crop area — matches banner aspect ratio */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem 1rem' }}>
        <div
          ref={containerRef}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 720,
            aspectRatio: '10 / 3',
            overflow: 'hidden',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.08)',
            background: '#000',
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <img
            src={imgSrc}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              width: displayW,
              height: displayH,
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}
