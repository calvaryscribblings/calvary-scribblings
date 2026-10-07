// THE DEPENDENCY AUDIT GATE — `npm audit --omit=dev`, blocking on critical, with NAMED,
// DATED exceptions.
//
//   node scripts/audit-gate.mjs            (CI: rules-and-hygiene › hygiene)
//
// It replaces a bare `npm audit --omit=dev --audit-level=critical`, which had one setting for
// every advisory: block. That left two choices when an advisory could not reach production —
// fail CI until a framework bump lands, or drop the gate. CI took the first for 25 days
// (audit CI-03), and a red gate nobody can clear catches nothing else.
//
// So an advisory can be excepted here — BY ADVISORY, never by package, so a NEW critical in the
// same package still blocks — and every exception carries the reason it cannot reach the site
// and a date it LAPSES on. After that date the advisory blocks again with no edit: a quarantine
// cannot outlive the reason it was given.

import { execFileSync } from 'node:child_process';

// ── THE EXCEPTIONS ──────────────────────────────────────────────────────────────────────────
//
// NONE. W36 (7 Oct 2026) bumped next 16.2.1 → 16.3.8, the update Ikenna allowed the two next
// criticals to wait for (W1, 24 Sep: "allowed until 7 Oct, bump after launch"). Both advisories
// (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4) and the third that reddened CI from 3 Oct
// (GHSA-vcvr-r3jv-pc5j, next/og ImageResponse) are fixed in 16.3.8, so the list is empty and
// the gate blocks on any critical again.
//
// An exception is { advisory, pkg, until, reason }: by ADVISORY id on one package, and DATED, so
// it lapses on its own. Add one only on a ruling, with the reason nothing is exposed.
export const EXCEPTIONS = [];

const ghsa = (url) => (String(url || '').match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/) || [null])[0];

/**
 * The verdict, as a pure function of `npm audit --json` output and today's date (YYYY-MM-DD,
 * London is irrelevant at day granularity for a week-long exception).
 * Returns { blocking: [{pkg, advisory, title}], excepted: [...], lapsed: [...] }.
 */
export function judge(report, today, exceptions = EXCEPTIONS) {
  const blocking = [], excepted = [], lapsed = [];
  for (const [pkg, v] of Object.entries(report?.vulnerabilities || {})) {
    for (const via of v.via || []) {
      if (typeof via !== 'object' || via.severity !== 'critical') continue;
      const advisory = ghsa(via.url);
      const row = { pkg, advisory, title: via.title };
      const ex = exceptions.find((e) => e.advisory === advisory && e.pkg === pkg);
      if (!ex) blocking.push(row);
      else if (today > ex.until) { lapsed.push({ ...row, until: ex.until }); blocking.push(row); }
      else excepted.push({ ...row, until: ex.until, reason: ex.reason });
    }
  }
  return { blocking, excepted, lapsed };
}

function main() {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (e) {
    raw = e.stdout; // npm audit exits non-zero whenever it finds anything; the JSON is still there
  }
  let report;
  try { report = JSON.parse(raw); } catch {
    console.error('::error::npm audit produced no JSON — the gate cannot judge, so it blocks.');
    process.exit(2);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { blocking, excepted, lapsed } = judge(report, today);
  for (const r of excepted) console.log(`excepted until ${r.until}: ${r.pkg} ${r.advisory} — ${r.reason}`);
  for (const r of lapsed) console.error(`::error::exception LAPSED on ${r.until}: ${r.pkg} ${r.advisory}. Bump the package or re-decide it.`);
  for (const r of blocking) console.error(`::error::critical: ${r.pkg} ${r.advisory} — ${r.title}`);
  if (blocking.length) process.exit(1);
  console.log(`audit gate: no blocking critical advisory (${excepted.length} excepted by name).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
