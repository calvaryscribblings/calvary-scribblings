import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COLORS, FONTS } from '../brand';

// S5 — THE READER (240 frames · 8s)
// A feed of story cards drifts up; one opens to fill the frame. Free to read.

const CARD_BG = '#1a1326';

type CardData = {
  genre: string;
  title: string;
  initial: string;
  handle: string;
};

const CARDS: CardData[] = [
  {
    genre: 'LITERARY',
    title: 'A Quiet Kind of Leaving',
    initial: 'C',
    handle: '@chidera',
  },
  {
    genre: 'FLASH',
    title: 'Lagos, After Rain',
    initial: 'T',
    handle: '@tundewrites',
  },
  {
    genre: 'POETRY',
    title: 'Songs My Father Hummed',
    initial: 'I',
    handle: '@ibrahims',
  },
];

const Avatar: React.FC<{ initial: string; size: number }> = ({
  initial,
  size,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: `linear-gradient(135deg, ${COLORS.purpleL} 0%, ${COLORS.purple} 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FONTS.display,
      fontSize: size * 0.42,
      color: COLORS.cream,
      flexShrink: 0,
    }}
  >
    {initial}
  </div>
);

const Card: React.FC<{ data: CardData }> = ({ data }) => (
  <div
    style={{
      width: 620,
      backgroundColor: CARD_BG,
      border: `1px solid ${COLORS.line}`,
      borderRadius: 12,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}
  >
    <span
      style={{
        fontFamily: FONTS.display,
        fontSize: 9,
        letterSpacing: '0.2em',
        color: COLORS.gold,
        alignSelf: 'flex-start',
        border: `1px solid ${COLORS.goldSoft}`,
        borderRadius: 4,
        padding: '3px 8px',
      }}
    >
      {data.genre}
    </span>
    <span
      style={{ fontFamily: FONTS.serif, fontSize: 30, color: COLORS.cream }}
    >
      {data.title}
    </span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar initial={data.initial} size={30} />
      <span
        style={{
          fontFamily: FONTS.display,
          fontSize: 10,
          letterSpacing: '0.18em',
          color: COLORS.creamDim,
        }}
      >
        {data.handle}
      </span>
    </div>
  </div>
);

const EXPAND_START = 120; // frame 1170 — 4s into the scene
const EXPAND_DUR = 40;
const FREE_START = 200;

export const S5Reader: React.FC = () => {
  const frame = useCurrentFrame();

  // Slow upward parallax on the feed.
  const scroll = 0.4 * frame;

  // Cards fade out as the first one opens.
  const cardsOpacity = interpolate(
    frame,
    [EXPAND_START, EXPAND_START + 30],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Expanded reader scales and fades up from the card.
  const expandP = interpolate(
    frame,
    [EXPAND_START, EXPAND_START + EXPAND_DUR],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const expandScale = interpolate(expandP, [0, 1], [0.82, 1]);

  const freeOpacity = interpolate(frame, [FREE_START, FREE_START + 25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const sceneOpacity = interpolate(frame, [222, 239], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{ backgroundColor: COLORS.ink, opacity: sceneOpacity }}
    >
      {/* The feed. */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: cardsOpacity,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            transform: `translateY(${-scroll}px)`,
          }}
        >
          {CARDS.map((c) => (
            <Card key={c.title} data={c} />
          ))}
        </div>
      </AbsoluteFill>

      {/* The opened story. */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: expandP,
          transform: `scale(${expandScale})`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: 1100,
            padding: 60,
          }}
        >
          <div
            style={{ fontFamily: FONTS.serif, fontSize: 48, color: COLORS.cream }}
          >
            A Quiet Kind of Leaving
          </div>
          <div
            style={{
              fontFamily: FONTS.serif,
              fontStyle: 'italic',
              fontSize: 22,
              color: COLORS.creamDim,
              marginTop: 18,
            }}
          >
            He did not slam the door. That was the cruelty of it.
          </div>
          <div
            style={{
              fontFamily: FONTS.serif,
              fontStyle: 'italic',
              fontSize: 20,
              color: COLORS.gold,
              marginTop: 40,
              opacity: freeOpacity,
            }}
          >
            Free to read. Always.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
