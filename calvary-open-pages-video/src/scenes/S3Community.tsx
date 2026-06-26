import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COLORS, FONTS } from '../brand';

// S3 — THE COMMUNITY (300 frames · 10s)
// A living catalogue: three columns of titles scroll up at parallax speeds,
// author handles threaded between them, a purple glow breathing behind it all.
// At 5s the cascade recedes and one line surfaces.

type Item =
  | { kind: 'title'; text: string; size: number; opacity: number }
  | { kind: 'handle'; text: string };

const HANDLES = [
  '@adaeze',
  '@tundewrites',
  '@ngozi_e',
  '@byokpara',
  '@kaluwrites',
  '@dera_o',
  '@ibrahims',
];

// Deterministic-but-varied sizes/opacities for depth (no Math.random in Remotion).
const SIZES = [24, 18, 28, 20, 26, 22];
const OPACITIES = [1.0, 0.5, 0.8, 0.35, 0.62, 0.45];

const buildColumn = (titles: string[], handleOffset: number): Item[] => {
  const items: Item[] = [];
  titles.forEach((text, i) => {
    items.push({
      kind: 'title',
      text,
      size: SIZES[i % SIZES.length],
      opacity: OPACITIES[i % OPACITIES.length],
    });
    // Thread a handle after most titles for texture.
    if (i % 2 === 0) {
      items.push({
        kind: 'handle',
        text: HANDLES[(i + handleOffset) % HANDLES.length],
      });
    }
  });
  return items;
};

const LEFT = buildColumn(
  [
    'The Harmattan Letters',
    'Lagos, After Rain',
    'Small Gods of the Market',
    'Before the Generator Comes On',
    'Daughter of the Dry Season',
    'The Harmattan Letters',
  ],
  0
);
const CENTRE = buildColumn(
  [
    'A Quiet Kind of Leaving',
    'What the River Keeps',
    'Songs My Father Hummed',
    'An Appetite for Love',
    'The Years I Gave You',
    'A Quiet Kind of Leaving',
  ],
  2
);
const RIGHT = buildColumn(
  [
    'Halfway Around the Moon',
    'The Space Between Words',
    'Till Morning Comes',
    'The Mind Reader',
    'Asleep with the Sun',
    'Halfway Around the Moon',
  ],
  4
);

const Column: React.FC<{ items: Item[]; speed: number; frame: number }> = ({
  items,
  speed,
  frame,
}) => {
  // Estimate the height of one pass so we can wrap seamlessly.
  const ITEM_GAP = 54;
  const onePass = items.length * ITEM_GAP;
  const shift = (speed * frame) % onePass;

  // Render the list twice so the wrap is invisible.
  const doubled = [...items, ...items];

  return (
    <div style={{ position: 'relative', width: 460, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          transform: `translateY(${-shift}px)`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {doubled.map((item, i) => (
          <div
            key={i}
            style={{
              height: ITEM_GAP,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {item.kind === 'title' ? (
              <span
                style={{
                  fontFamily: FONTS.serif,
                  fontSize: item.size,
                  color: COLORS.cream,
                  opacity: item.opacity,
                  textAlign: 'center',
                }}
              >
                {item.text}
              </span>
            ) : (
              <span
                style={{
                  fontFamily: FONTS.display,
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  color: COLORS.gold,
                }}
              >
                {item.text}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const LINE_AT = 150; // frame 660 of the full timeline (5s into the scene)

export const S3Community: React.FC = () => {
  const frame = useCurrentFrame();

  // Purple radial glow pulsing on a 90-frame cycle (0.2 → 0.45).
  const pulse =
    0.2 + 0.125 * (1 - Math.cos((frame / 90) * Math.PI * 2)); // 0.2..0.45

  // Columns recede to 0.08 as the closing line surfaces.
  const columnsOpacity = interpolate(frame, [LINE_AT, LINE_AT + 40], [1, 0.08], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const lineOpacity = interpolate(
    frame,
    [LINE_AT + 10, LINE_AT + 45],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Fade to black at the end (after a 3s hold on the line).
  const sceneOpacity = interpolate(frame, [280, 300], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.ink,
        opacity: sceneOpacity,
        overflow: 'hidden',
      }}
    >
      {/* Breathing purple glow from centre. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${COLORS.purpleSoft} 0%, rgba(8,6,16,0) 55%)`,
          opacity: pulse,
        }}
      />

      <AbsoluteFill
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 40,
          opacity: columnsOpacity,
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
        }}
      >
        <Column items={LEFT} speed={0.6} frame={frame} />
        <Column items={CENTRE} speed={0.35} frame={frame} />
        <Column items={RIGHT} speed={0.5} frame={frame} />
      </AbsoluteFill>

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
            fontSize: 30,
            color: COLORS.creamDim,
            opacity: lineOpacity,
          }}
        >
          Stories the world almost never heard.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
