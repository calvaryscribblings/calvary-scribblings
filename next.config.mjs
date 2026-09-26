import createMDX from '@next/mdx';
import { execSync } from 'node:child_process';

const withMDX = createMDX({});

// W16 — the build a page is RUNNING, baked into its scripts (app/lib/buildId.js). The same
// derivation as out/build.json (scripts/stamp-build-info.mjs) and out/sw.js (scripts/stamp-sw.mjs):
// the commit Cloudflare Pages built, else the local HEAD, first 12 characters. So the footer, the
// ?debug=bar readout, /build.json and the service worker all name a build the same way.
const BUILD_COMMIT = (process.env.CF_PAGES_COMMIT_SHA
  || (() => { try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()
).slice(0, 12);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: BUILD_COMMIT,
  },
};

export default withMDX(nextConfig);
