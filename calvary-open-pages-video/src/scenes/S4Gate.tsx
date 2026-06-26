import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COLORS, FONTS } from '../brand';

// S4 — THE GATE (240 frames · 8s)
// A story is typed into the composer, three moderation checks clear one by one,
// and it goes live instantly.

const TITLE = 'What the River Keeps';
const BODY =
  'My grandmother could name every drowned thing the Niger had taken…';

const TITLE_START = 20;
const TITLE_RATE = 3; // chars per frame
const BODY_START = 30;
const BODY_RATE = 3;

const CHECKS = ['Content safety', 'Age-appropriate', 'Not spam'];
const CHECKS_START = 64;
const CHECK_STAGGER = 25;
const CHECK_DUR = 20;

const PUBLISHED_START = 150;
const LIVE_START = 165;

const typed = (text: string, frame: number, start: number, rate: number) => {
  const n = Math.max(0, Math.min(text.length, Math.floor((frame - start) * rate)));
  return text.slice(0, n);
};

const CheckRow: React.FC<{ label: string; start: number; frame: number }> = ({
  label,
  start,
  frame,
}) => {
  const p = interpolate(frame, [start, start + CHECK_DUR], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Radial flash 0 → 0.4 → 0 around completion.
  const flash = interpolate(
    frame,
    [start + CHECK_DUR - 6, start + CHECK_DUR, start + CHECK_DUR + 14],
    [0, 0.4, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const filled = p > 0.5;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '6px 0',
        opacity: interpolate(frame, [start - 8, start], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -10,
          top: '50%',
          width: 120,
          height: 120,
          transform: 'translateY(-50%)',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.purple} 0%, rgba(8,6,16,0) 70%)`,
          opacity: flash,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `1.5px solid ${filled ? COLORS.purple : COLORS.line}`,
          backgroundColor: filled ? COLORS.purple : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'none',
          boxShadow: filled ? `0 0 10px ${COLORS.purpleSoft}` : 'none',
        }}
      >
        {/* Checkmark drawn with an SVG, scaling in once filled. */}
        <svg width="11" height="11" viewBox="0 0 12 12" style={{ opacity: interpolate(frame, [start + CHECK_DUR * 0.5, start + CHECK_DUR], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <path
            d="M2 6.5 L5 9 L10 3"
            fill="none"
            stroke={COLORS.cream}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span
        style={{
          fontFamily: FONTS.display,
          fontSize: 11,
          letterSpacing: '0.15em',
          color: COLORS.creamDim,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </div>
  );
};

export const S4Gate: React.FC = () => {
  const frame = useCurrentFrame();

  const panelIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Panel dims to 0.6 while checks run, returns to full once they clear.
  const checksEnd = CHECKS_START + (CHECKS.length - 1) * CHECK_STAGGER + CHECK_DUR;
  const panelDim = interpolate(
    frame,
    [CHECKS_START - 4, CHECKS_START + 6, checksEnd, checksEnd + 16],
    [1, 0.6, 0.6, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const publishedOpacity = interpolate(
    frame,
    [PUBLISHED_START, PUBLISHED_START + 25],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const liveOpacity = interpolate(frame, [LIVE_START, LIVE_START + 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const sceneOpacity = interpolate(frame, [216, 239], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.ink,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: sceneOpacity,
      }}
    >
      <div
        style={{
          width: 680,
          borderRadius: 14,
          border: `1px solid ${COLORS.line}`,
          backgroundColor: COLORS.panel,
          padding: '34px 40px',
          opacity: panelIn * panelDim,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.serif,
            fontSize: 28,
            color: COLORS.cream,
            minHeight: 38,
          }}
        >
          {typed(TITLE, frame, TITLE_START, TITLE_RATE)}
        </div>
        <div
          style={{
            fontFamily: FONTS.serif,
            fontStyle: 'italic',
            fontSize: 18,
            color: COLORS.creamDim,
            marginTop: 10,
            minHeight: 26,
            lineHeight: 1.5,
          }}
        >
          {typed(BODY, frame, BODY_START, BODY_RATE)}
        </div>

        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column' }}>
          {CHECKS.map((label, i) => (
            <CheckRow
              key={label}
              label={label}
              start={CHECKS_START + i * CHECK_STAGGER}
              frame={frame}
            />
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontFamily: FONTS.serif,
              fontStyle: 'italic',
              fontSize: 26,
              color: COLORS.cream,
              opacity: publishedOpacity,
            }}
          >
            Published to Open Pages.
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontSize: 10,
              letterSpacing: '0.25em',
              color: COLORS.gold,
              marginTop: 10,
              opacity: liveOpacity,
            }}
          >
            LIVE · INSTANTLY
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
