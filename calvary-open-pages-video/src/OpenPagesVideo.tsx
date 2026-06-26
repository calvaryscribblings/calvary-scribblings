import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { COLORS, SCENES } from './brand';
import { S1Blank } from './scenes/S1Blank';
import { S2Invitation } from './scenes/S2Invitation';
import { S3Community } from './scenes/S3Community';
import { S4Gate } from './scenes/S4Gate';
import { S5Reader } from './scenes/S5Reader';
import { S6Earn } from './scenes/S6Earn';
import { S7Manifesto } from './scenes/S7Manifesto';

/*
 * Open Pages — a page is a place to begin.
 * 60s · 1920×1080 · 30fps · 1800 frames. Designed silent-first.
 *
 * S1 0:00 the blank page — cursor + typewriter
 * S2 0:08 the invitation — 'Now it's your turn.' + gold rule
 * S3 0:17 the community — catalogue cascade
 * S4 0:27 the gate — moderation passes, publishes live
 * S5 0:35 the reader — feed card expands to full read
 * S6 0:43 the earn — Pocket thresholds fill → POCKET READY
 * S7 0:51 the manifesto — three lines, then the cursor returns
 */

export const OpenPagesVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink }}>
      <Sequence from={SCENES.s1.from} durationInFrames={SCENES.s1.duration}>
        <S1Blank />
      </Sequence>
      <Sequence from={SCENES.s2.from} durationInFrames={SCENES.s2.duration}>
        <S2Invitation />
      </Sequence>
      <Sequence from={SCENES.s3.from} durationInFrames={SCENES.s3.duration}>
        <S3Community />
      </Sequence>
      <Sequence from={SCENES.s4.from} durationInFrames={SCENES.s4.duration}>
        <S4Gate />
      </Sequence>
      <Sequence from={SCENES.s5.from} durationInFrames={SCENES.s5.duration}>
        <S5Reader />
      </Sequence>
      <Sequence from={SCENES.s6.from} durationInFrames={SCENES.s6.duration}>
        <S6Earn />
      </Sequence>
      <Sequence from={SCENES.s7.from} durationInFrames={SCENES.s7.duration}>
        <S7Manifesto />
      </Sequence>
    </AbsoluteFill>
  );
};
