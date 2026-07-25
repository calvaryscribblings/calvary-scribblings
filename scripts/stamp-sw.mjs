// Stamps the build id into the exported service worker.
//
// public/sw.js ships to git carrying the literal placeholder `__BUILD_ID__`. Next copies
// public/ verbatim into out/, and this script — which runs AFTER `next build` — rewrites
// out/sw.js with a real id. The tracked file therefore never carries a build-specific
// value and never shows up dirty in git status after a build.
//
// The id names the worker's cache generation (cs-shell-v<id>), which is what lets the
// activate handler drop every previous generation in one sweep. It must change on every
// deploy that changes any asset, and it must NOT change when nothing changed — otherwise
// every build throws away a warm cache for no reason. The commit sha satisfies both.
//
// Cloudflare Pages exports CF_PAGES_COMMIT_SHA for us; the git fallback covers local
// builds; the timestamp is a last resort that degrades to "new cache every build", which
// is wasteful but never wrong.
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'out', 'sw.js');
const PLACEHOLDER = '__BUILD_ID__';

function buildId() {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}

const id = buildId();
let src;
try {
  src = await readFile(OUT, 'utf8');
} catch {
  // The worker not reaching out/ is a real failure — the site would deploy with no shelf —
  // but it must not take the whole build down after next build has already succeeded.
  console.error(`[stamp-sw] out/sw.js not found. The service worker will NOT ship this build.`);
  process.exit(0);
}

if (!src.includes(PLACEHOLDER)) {
  // Already stamped, or someone renamed the constant. Either way, leaving a worker with an
  // unknown cache-version scheme in place is worse than shouting about it.
  console.warn(`[stamp-sw] ${PLACEHOLDER} not found in out/sw.js — leaving it untouched.`);
  process.exit(0);
}

await writeFile(OUT, src.replaceAll(PLACEHOLDER, id));
console.log(`[stamp-sw] out/sw.js stamped with build ${id}`);
