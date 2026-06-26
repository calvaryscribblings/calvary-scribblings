import React from 'react';
import { Composition } from 'remotion';
import { OpenPagesVideo } from './OpenPagesVideo';
import { FPS, TOTAL_FRAMES } from './brand';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OpenPagesVideo"
      component={OpenPagesVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
