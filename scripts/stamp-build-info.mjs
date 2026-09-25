// W7 — out/build.json: when THIS build ran, and which build it is.
//
// scripts/launch-check.mjs asks "was the site rebuilt after the latest London midnight?" — the
// free week rolls over and the archive gate switches on at London midnights, and a static page
// built before one carries a body that has just gone to the archive. The Next build id in the
// served HTML says a build CHANGED, not WHEN; this file says when. It carries no secret: a time,
// the Next build id (already in every page), and the commit (already in sw.js).
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const commit = process.env.CF_PAGES_COMMIT_SHA
  || (() => { try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } })();
let nextBuildId = null;
try { nextBuildId = (await readFile(resolve(process.cwd(), '.next', 'BUILD_ID'), 'utf8')).trim(); } catch { /* reported as null */ }

const info = { builtAt: Date.now(), builtAtIso: new Date().toISOString(), nextBuildId, commit: commit ? commit.slice(0, 12) : null };
await writeFile(resolve(process.cwd(), 'out', 'build.json'), JSON.stringify(info) + '\n');
console.log(`[stamp-build-info] out/build.json ${JSON.stringify(info)}`);
