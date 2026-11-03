// EDGE-2 — a throwaway EDGE_LEDGER_KEY for one Actions job's own builds.
//
// `npm run build` ends with scripts/generate-edge-guard.mjs, which refuses to run without
// EDGE_LEDGER_KEY. The suites that build in Actions (reader-tests.yml, rules-and-hygiene.yml) build
// for tests only; nothing they build is ever deployed. So each job makes its own key here:
//
//   - 32 random bytes, generated in this process and written straight to $GITHUB_ENV, so the
//     job's later steps see it. It is never printed, never in a shell variable, never committed,
//     and it is never the Pages key (that one lives only in the Pages project).
//   - masked first (::add-mask::), so a later step that echoes it shows *** instead.
//   - EDGE_LEDGER=none beside it: the build bootstraps instead of reading the live ledger, which
//     is sealed under the Pages key and could not be read back under this one anyway.
//
// EDGE_LEDGER=none is refused on Cloudflare's own build (CF_PAGES set; see refusalOnPages in
// scripts/generate-edge-guard.mjs), so this can never make a production build skip the guard.
//
// Run as a step:   node scripts/ci/edge-ledger-throwaway.mjs
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const envFile = process.env.GITHUB_ENV;
if (!envFile) {
  console.error('[edge-ledger-throwaway] GITHUB_ENV is not set: this runs only as a GitHub Actions step.');
  process.exit(1);
}
if (process.env.CF_PAGES) {
  console.error('[edge-ledger-throwaway] CF_PAGES is set: a Cloudflare build uses the Pages key, never a throwaway.');
  process.exit(1);
}
const key = randomBytes(32).toString('base64url');
process.stdout.write(`::add-mask::${key}\n`);       // consumed by the runner; the log shows nothing
appendFileSync(envFile, `EDGE_LEDGER_KEY=${key}\nEDGE_LEDGER=none\n`);
console.log('[edge-ledger-throwaway] EDGE_LEDGER_KEY (throwaway, 32 bytes) and EDGE_LEDGER=none set for this job.');
