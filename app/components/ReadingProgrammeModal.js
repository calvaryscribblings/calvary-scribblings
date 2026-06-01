'use client';
import { useEffect, useState } from 'react';

const SLIDES = [
  { src: '/spring-reading-winners.jpg', alt: 'Spring reading programme winners' },
  { src: '/spring-reading-honourable.jpg', alt: 'Spring reading programme honourable mentions' },
];

const SLIDE_DURATION_MS = 10000;
const TICK_MS = 100;
const TICK_INCREMENT = (TICK_MS / SLIDE_DURATION_MS) * 100;

export default function ReadingProgrammeModal() {
  const [visible, setVisible] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('rp_spring_2026') === 'dismissed') return;
    const openTimer = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(openTimer);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const closeTimer = setTimeout(() => setShowClose(true), 3000);
    return () => clearTimeout(closeTimer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setProgress((prev) => Math.min(prev + TICK_INCREMENT, 100));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [visible, slideIndex]);

  const dismiss = () => {
    localStorage.setItem('rp_spring_2026', 'dismissed');
    setVisible(false);
  };

  const advance = () => {
    if (slideIndex < SLIDES.length - 1) {
      setSlideIndex((i) => i + 1);
      setProgress(0);
    } else {
      dismiss();
    }
  };

  const goBack = () => {
    if (slideIndex > 0) {
      setSlideIndex((i) => i - 1);
      setProgress(0);
    }
  };

  useEffect(() => {
    if (progress < 100) return;
    if (slideIndex < SLIDES.length - 1) {
      setSlideIndex((i) => i + 1);
      setProgress(0);
    } else {
      localStorage.setItem('rp_spring_2026', 'dismissed');
      setVisible(false);
    }
  }, [progress, slideIndex]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          position: 'relative',
          maxWidth: '380px',
          width: '90vw',
        }}
      >
        <img
          src={SLIDES[slideIndex].src}
          alt={SLIDES[slideIndex].alt}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            borderRadius: '16px',
            objectFit: 'cover',
          }}
        />

        <div
          onClick={goBack}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '50%',
            height: '100%',
            zIndex: 2,
            cursor: 'pointer',
          }}
        />
        <div
          onClick={advance}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '50%',
            height: '100%',
            zIndex: 2,
            cursor: 'pointer',
          }}
        />

        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            display: 'flex',
            gap: '4px',
            zIndex: 3,
          }}
        >
          {SLIDES.map((_, i) => {
            const fill = i < slideIndex ? 100 : i === slideIndex ? progress : 0;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: '3px',
                  borderRadius: '2px',
                  background: 'rgba(255,255,255,0.3)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${fill}%`,
                    height: '100%',
                    background: '#c9a84c',
                    borderRadius: '2px',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {showClose && (
        <button
          onClick={dismiss}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.5)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            zIndex: 10000,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
