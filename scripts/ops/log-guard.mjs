#!/usr/bin/env node
// W12 — THE LOG GUARD. Every scheduled GitHub job pipes its output through this:
//
//   node scripts/account/scrub.mjs --apply 2>&1 | node scripts/ops/log-guard.mjs
//
// It passes each line through with anything identifier-SHAPED (an account ID, a push token, an
// email — scripts/ops/redact.mjs) masked BEFORE it reaches the public log, and, if it had to mask
// anything, fails the step once the input ends. The scripts are written to print counts only;
// this is the second layer, so a slip costs a red run instead of a reader's ID in public.
//
// The workflow step runs under `shell: bash` (pipefail), so the script's own failure still fails
// the step too.
import { createInterface } from 'node:readline';
import { findIdentifiers, mask } from './redact.mjs';

const seen = {};
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const hits = findIdentifiers(line);
  for (const h of hits) seen[h.kind] = (seen[h.kind] || 0) + 1;
  process.stdout.write(`${hits.length ? mask(line) : line}\n`);
}
const kinds = Object.entries(seen);
if (kinds.length) {
  process.stdout.write(`::error::[log-guard] masked ${kinds.map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ')} — a script printed something that names a reader. Fix the script (W12: counts only).\n`);
  process.exit(1);
}
