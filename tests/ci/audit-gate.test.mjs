// W1 / CI-03 — the audit gate's exceptions are by ADVISORY, and they LAPSE.
//
//   node --test tests/ci/audit-gate.test.mjs      (npm run test:ci)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, EXCEPTIONS } from '../../scripts/audit-gate.mjs';

const adv = (id, severity = 'critical') => ({
  source: 1, severity, title: `t ${id}`, url: `https://github.com/advisories/${id}`,
});
const report = (vulns) => ({ vulnerabilities: vulns });

// The mechanism is tested against a FIXTURE list — the live list is empty since W36.
const FIXTURE = [
  { advisory: 'GHSA-p293-qw3h-jr36', pkg: 'next', until: '2026-10-07', reason: 'r' },
  { advisory: 'GHSA-2xp9-vwfh-vxw4', pkg: 'next', until: '2026-10-07', reason: 'r' },
];
const NEXT_TWO = report({ next: { via: [adv('GHSA-p293-qw3h-jr36'), adv('GHSA-2xp9-vwfh-vxw4'), adv('GHSA-q4gf-8mx6-v5v3', 'high')] } });

test('W36: the live list is EMPTY — the next bump closed both, and nothing is excepted', () => {
  assert.deepEqual(EXCEPTIONS, []);
  assert.equal(judge(NEXT_TWO, '2026-10-07').blocking.length, 2, 'with no exceptions the same report blocks');
});

test('an exception holds until its date, and nothing else is excepted', () => {
  const v = judge(NEXT_TWO, '2026-09-24', FIXTURE);
  assert.equal(v.blocking.length, 0);
  assert.equal(v.excepted.length, 2);
});

test('the day after its date the exception has lapsed and the same report blocks', () => {
  const v = judge(NEXT_TWO, '2026-10-08', FIXTURE);
  assert.equal(v.blocking.length, 2);
  assert.equal(v.lapsed.length, 2);
});

test('a NEW critical in next still blocks — the exception is by advisory, not by package', () => {
  const v = judge(report({ next: { via: [adv('GHSA-aaaa-bbbb-cccc')] } }), '2026-09-24', FIXTURE);
  assert.deepEqual(v.blocking.map((b) => b.advisory), ['GHSA-aaaa-bbbb-cccc']);
});

test('the same advisory id on another package is not excepted', () => {
  const v = judge(report({ 'other-pkg': { via: [adv('GHSA-p293-qw3h-jr36')] } }), '2026-09-24', FIXTURE);
  assert.equal(v.blocking.length, 1);
});

test('highs and transitive string entries never block (the gate is critical-only, as before)', () => {
  const v = judge(report({ postcss: { via: [adv('GHSA-6g55-p6wh-862q', 'high')] }, x: { via: ['postcss'] } }), '2026-09-24');
  assert.equal(v.blocking.length, 0);
});
