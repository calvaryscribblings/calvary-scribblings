#!/usr/bin/env node
// W7 — WHICH SCHEDULED RUN OF launch-check.yml IS THE REAL ONE. GitHub's cron is UTC only, and
// the checks belong to London times: 30 Sept at 00:10 and 08:05, then every Monday at 00:10.
// So the workflow carries each London time as the UTC cron(s) it can be, and this gate keeps the
// one that matches London's offset ON THE DAY, using the cron string that fired
// (github.event.schedule), so a run GitHub delays by half an hour still counts correctly.
//
//   node scripts/launch-check-gate.mjs "<cron>"   → prints run=true|false (for $GITHUB_OUTPUT)

import { pathToFileURL } from 'node:url';

/** London's offset from UTC at `ms`, in hours (0 or 1). */
export function londonOffsetHours(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 3600000);
}
const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** The crons, and when each one is the real London time. */
export const SCHEDULES = {
  '10 23 29 9 *': { label: '30 Sept 00:10 London (BST)', valid: (ms) => londonDate(ms) === '2026-09-30' && londonOffsetHours(ms) === 1 },
  '5 7 30 9 *': { label: '30 Sept 08:05 London (BST)', valid: (ms) => londonDate(ms) === '2026-09-30' && londonOffsetHours(ms) === 1 },
  '10 23 * * 0': { label: 'Monday 00:10 London, in BST (Sunday 23:10 UTC)', valid: (ms) => londonOffsetHours(ms) === 1 },
  '10 0 * * 1': { label: 'Monday 00:10 London, in GMT', valid: (ms) => londonOffsetHours(ms) === 0 },
};

/** Should this scheduled run go ahead? A manual dispatch (no cron) always does. */
export function shouldRun(schedule, ms = Date.now()) {
  if (!schedule) return true;
  const s = SCHEDULES[schedule];
  return !!s && s.valid(ms);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cron = process.argv[2] || '';
  const run = shouldRun(cron);
  console.log(`[gate] schedule="${cron || '(manual)'}" ${SCHEDULES[cron]?.label || ''} → run=${run}`);
  console.log(`run=${run}`);
}
