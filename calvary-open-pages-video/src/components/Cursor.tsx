import React from 'react';
import { COLORS } from '../brand';

// The blinking cursor — shared, identical, between S1 (the blank page) and
// S7 (the closing dark). Blink cycle is every 18 frames: 9 on, 9 off.
export const BLINK_PERIOD = 18;
export const CURSOR_WIDTH = 4;
export const CURSOR_HEIGHT = 48;

type CursorProps = {
  // The frame used to drive the blink phase. Pass the same value in S1 and S7
  // so the cursor blinks on an identical cadence.
  blinkFrame: number;
  // While typing, the cursor stays solid and follows the last character.
  solid?: boolean;
  width?: number;
  height?: number;
};

export const Cursor: React.FC<CursorProps> = ({
  blinkFrame,
  solid = false,
  width = CURSOR_WIDTH,
  height = CURSOR_HEIGHT,
}) => {
  const on = solid || blinkFrame % BLINK_PERIOD < BLINK_PERIOD / 2 ? 1 : 0;

  return (
    <span
      style={{
        display: 'inline-block',
        width,
        height,
        backgroundColor: COLORS.gold,
        opacity: on,
        boxShadow: `0 0 18px ${COLORS.goldSoft}`,
      }}
    />
  );
};
