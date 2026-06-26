import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COLORS, FONTS } from '../brand';

// S2 — THE INVITATION (270 frames · 9s)
// 'Now it's your turn.' drifts up word by word, a gold rule draws beneath it,
// and the wordmark settles in.

const WORDS = ['Now', "it's", 'your', 'turn.'];
const LINE_IN = 20;
const WORD_FADE = 25; // frames each word takes to fade + drift
const WORD_STAGGER = 18; // frames between word starts

const RULE_START = 130;
const RULE_DUR = 40;
const RULE_WIDTH = 300;

const LABEL_START = 178;
const LABEL = 'OPEN PAGES · CALVARY SCRIBBLINGS';

export const S2Invitation: React.FC = () => {
  const frame = useCurrentFrame();

  // Fade everything to black over the last 30 frames.
  const sceneOpacity = interpolate(frame, [240, 270], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const ruleProgress = interpolate(
    frame,
    [RULE_START, RULE_START + RULE_DUR],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const labelOpacity = interpolate(
    frame,
    [LABEL_START, LABEL_START + 25],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.serif,
            fontStyle: 'italic',
            fontSize: 68,
            color: COLORS.cream,
            display: 'flex',
            gap: 18,
          }}
        >
          {WORDS.map((word, i) => {
            const start = LINE_IN + i * WORD_STAGGER;
            const o = interpolate(frame, [start, start + WORD_FADE], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const dy = interpolate(frame, [start, start + WORD_FADE], [12, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <span
                key={i}
                style={{ opacity: o, transform: `translateY(${dy}px)` }}
              >
                {word}
              </span>
            );
          })}
        </div>

        {/* Gold rule, drawn left to right. */}
        <div
          style={{
            marginTop: 38,
            width: RULE_WIDTH,
            height: 1,
            display: 'flex',
            justifyContent: 'flex-start',
          }}
        >
          <div
            style={{
              width: RULE_WIDTH * ruleProgress,
              height: 1,
              backgroundColor: COLORS.gold,
              boxShadow: `0 0 8px ${COLORS.goldSoft}`,
            }}
          />
        </div>

        <div
          style={{
            marginTop: 22,
            fontFamily: FONTS.display,
            fontSize: 11,
            letterSpacing: '0.32em',
            color: COLORS.gold,
            opacity: labelOpacity,
          }}
        >
          {LABEL}
        </div>
      </div>
    </AbsoluteFill>
  );
};
