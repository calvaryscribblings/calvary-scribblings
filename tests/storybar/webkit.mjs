// W16 — ONE WAY TO LAUNCH WEBKIT IN THIS CODESPACE, for every storybar harness.
//
// Found on 26 Sep 2026: Playwright's WebKit (build 2336) CRASHES loading any live story page
// here. Two separate triggers, both in this machine's graphics stack, neither in the site:
//   · on the default (GPU Skia, Mesa llvmpipe) path, ANY `box-shadow: inset …` kills the web
//     process — a bare <div> with one is enough (the story bar's hairline has been one since W9);
//   · with WEBKIT_SKIA_ENABLE_CPU_RENDERING=1, any `backdrop-filter` scrolling into view does.
// Mesa's `softpipe` driver renders both. It is slower than llvmpipe, and that is the only cost.
// This is a harness setting: iOS Safari draws inset shadows and backdrop filters every day, and
// nothing here changes a byte the site serves.
import { webkit } from '@playwright/test';

export const WEBKIT_ENV = Object.freeze({ GALLIUM_DRIVER: 'softpipe', LIBGL_ALWAYS_SOFTWARE: '1' });

export const launchWebKit = (opts = {}) => webkit.launch({ ...opts, env: { ...process.env, ...WEBKIT_ENV, ...(opts.env || {}) } });
