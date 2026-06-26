import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COLORS, FONTS } from '../brand';
import { Cursor } from '../components/Cursor';

// S7 — THE MANIFESTO + CLOSING CURSOR (270 frames · 9s)
// Three lines state what Open Pages is. Two recede; the last brightens, then
// fades — and the cursor from S1 blinks back in, alone, in the dark.

const LINES = [
  'Open Pages is not a publishing house.',
  'It is not an algorithm.',
  'It is a page — and you begin.',
];

const LINE_START = 6;
const LINE_STAGGER = 18;
const LINE_FADE = 25;

const RECEDE_START = 120; // lines 1 & 2 fade, line 3 takes the frame
const RECEDE_DUR = 30;
const EMPHASIS_DUR = 50;

const LINE3_FADE_OUT = 200;
const CURSOR_IN = 232;

export const S7Manifesto: React.FC = () => {
  const frame = useCurrentFrame();

  // Per-line fade-in opacity.
  const lineIn = (i: number) => {
    const start = LINE_START + i * LINE_STAGGER;
    return interpolate(frame, [start, start + LINE_FADE], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  };

  // Lines 1 & 2 fade out during the recede.
  const recedeOut = interpolate(
    frame,
    [RECEDE_START, RECEDE_START + RECEDE_DUR],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Line 3: brightens 0.75 → 1.0 and scales 1.0 → 1.035, then fades out.
  const line3Bright = interpolate(
    frame,
    [RECEDE_START, RECEDE_START + EMPHASIS_DUR],
    [0.75, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const line3Scale = interpolate(
    frame,
    [RECEDE_START, RECEDE_START + EMPHASIS_DUR],
    [1, 1.035],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const line3FadeOut = interpolate(
    frame,
    [LINE3_FADE_OUT, LINE3_FADE_OUT + 22],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  // Before the recede, line 3 is at its fade-in value; after, it follows the emphasis.
  const line3Opacity =
    frame < RECEDE_START
      ? lineIn(2)
      : line3Bright * line3FadeOut;

  // Closing cursor blinks in, holds, then the scene fades to black.
  const cursorAppear = interpolate(frame, [CURSOR_IN, CURSOR_IN + 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cursorFadeOut = interpolate(frame, [262, 270], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink }}>
      {/* Manifesto lines */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.serif,
            fontStyle: 'italic',
            fontSize: 36,
            color: COLORS.cream,
            lineHeight: 1.7,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span style={{ opacity: lineIn(0) * recedeOut }}>{LINES[0]}</span>
          <span style={{ opacity: lineIn(1) * recedeOut }}>{LINES[1]}</span>
          <span
            style={{
              opacity: line3Opacity,
              transform: `scale(${frame < RECEDE_START ? 1 : line3Scale})`,
            }}
          >
            {LINES[2]}
          </span>
        </div>
      </AbsoluteFill>

      {/* Closing cursor — identical component to S1. */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: cursorAppear * cursorFadeOut,
        }}
      >
        <Cursor blinkFrame={frame - CURSOR_IN} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
