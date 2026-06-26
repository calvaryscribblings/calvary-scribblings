import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COLORS, FONTS } from '../brand';
import { Cursor } from '../components/Cursor';

// S1 — THE BLANK PAGE (240 frames · 8s)
// Pure black. A lone cursor appears, blinks, then types one line. The silence
// is the point — nothing here is rushed.

const LINE = 'Every story begins the same way.';
const CURSOR_IN = 20; // cursor appears, centred
const TYPE_START = 60; // 2 full seconds of stillness first
const FRAMES_PER_CHAR = 4;

export const S1Blank: React.FC = () => {
  const frame = useCurrentFrame();

  // Cursor fades in at frame 20.
  const cursorAppear = interpolate(frame, [CURSOR_IN, CURSOR_IN + 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Typewriter: one character every 4 frames from frame 60.
  const charsShown = Math.max(
    0,
    Math.min(LINE.length, Math.floor((frame - TYPE_START) / FRAMES_PER_CHAR))
  );
  const text = LINE.slice(0, charsShown);
  const typing = frame >= TYPE_START && charsShown < LINE.length;

  // Fade the whole scene to black at the end, after holding the finished line.
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
          fontFamily: FONTS.serif,
          fontStyle: 'italic',
          fontSize: 52,
          letterSpacing: '0.01em',
          color: COLORS.cream,
          display: 'flex',
          alignItems: 'baseline',
          opacity: cursorAppear,
        }}
      >
        <span>{text}</span>
        <span
          style={{
            display: 'inline-flex',
            marginLeft: text.length > 0 ? 8 : 0,
            transform: 'translateY(6px)',
          }}
        >
          {/* Solid while typing (follows the last character), blinking when idle. */}
          <Cursor blinkFrame={frame} solid={typing} />
        </span>
      </div>
    </AbsoluteFill>
  );
};
