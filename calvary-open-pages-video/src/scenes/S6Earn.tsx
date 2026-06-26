import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, FONTS } from '../brand';

// S6 — THE EARN (240 frames · 8s)
// A writer's profile, four Pocket thresholds filling in, then the badge.

const THRESHOLDS = [
  '8 WEEKS CONSISTENT POSTING',
  '100 FOLLOWERS',
  '200 COMMENTS RECEIVED',
  '10 PUBLISHED STORIES',
];

const BAR_WIDTH = 320;
const ROW_START = 30;
const ROW_STAGGER = 20;
const FILL_DUR = 50;

const BADGE_START = 150;
const SUBTITLE_START = 195;

const ThresholdRow: React.FC<{
  label: string;
  start: number;
  frame: number;
}> = ({ label, start, frame }) => {
  const appear = interpolate(frame, [start, start + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fill = interpolate(frame, [start, start + FILL_DUR], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const checkOpacity = interpolate(
    frame,
    [start + FILL_DUR, start + FILL_DUR + 12],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <div style={{ opacity: appear, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span
        style={{
          fontFamily: FONTS.display,
          fontSize: 10,
          letterSpacing: '0.15em',
          color: COLORS.creamDim,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: BAR_WIDTH,
            height: 3,
            backgroundColor: COLORS.line,
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: BAR_WIDTH * fill,
              height: 3,
              backgroundColor: COLORS.gold,
              boxShadow: `0 0 8px ${COLORS.goldSoft}`,
            }}
          />
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ opacity: checkOpacity }}>
          <path
            d="M2 6.5 L5 9 L10 3"
            fill="none"
            stroke={COLORS.gold}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};

export const S6Earn: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const profileOpacity = interpolate(frame, [0, 25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Badge pulses in: scale 0.8 → 1.0, opacity 0 → 1 over ~30 frames.
  const badgeSpring = spring({
    frame: frame - BADGE_START,
    fps,
    config: { damping: 14, mass: 0.7 },
    durationInFrames: 30,
  });
  const badgeScale = interpolate(badgeSpring, [0, 1], [0.8, 1]);
  const badgeOpacity = interpolate(frame, [BADGE_START, BADGE_START + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const subtitleOpacity = interpolate(
    frame,
    [SUBTITLE_START, SUBTITLE_START + 22],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const sceneOpacity = interpolate(frame, [222, 239], [1, 0], {
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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 30,
        }}
      >
        {/* Profile */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            opacity: profileOpacity,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${COLORS.purpleL} 0%, ${COLORS.purple} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONTS.display,
              fontSize: 14,
              color: COLORS.cream,
            }}
          >
            I
          </div>
          <div style={{ fontFamily: FONTS.serif, fontSize: 22, color: COLORS.cream }}>
            Ikenna Okpara
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontSize: 10,
              letterSpacing: '0.18em',
              color: COLORS.creamFaint,
            }}
          >
            @byokpara
          </div>
        </div>

        {/* Thresholds */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {THRESHOLDS.map((label, i) => (
            <ThresholdRow
              key={label}
              label={label}
              start={ROW_START + i * ROW_STAGGER}
              frame={frame}
            />
          ))}
        </div>

        {/* Badge */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: 6,
          }}
        >
          <div
            style={{
              position: 'absolute',
              width: 600,
              height: 600,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: `radial-gradient(circle, ${COLORS.purpleSoft} 0%, rgba(8,6,16,0) 50%)`,
              opacity: badgeOpacity,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'relative',
              fontFamily: FONTS.display,
              fontSize: 36,
              letterSpacing: '0.12em',
              color: COLORS.gold,
              opacity: badgeOpacity,
              transform: `scale(${badgeScale})`,
              textShadow: `0 0 24px ${COLORS.goldSoft}`,
            }}
          >
            POCKET READY
          </div>
          <div
            style={{
              position: 'relative',
              fontFamily: FONTS.serif,
              fontStyle: 'italic',
              fontSize: 19,
              color: COLORS.creamDim,
              marginTop: 18,
              opacity: subtitleOpacity,
            }}
          >
            Write consistently. Build your readers. Earn.
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
