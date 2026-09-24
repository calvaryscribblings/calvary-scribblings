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

const NEXT_TWO = report({ next: { via: [adv('GHSA-p293-qw3h-jr36'), adv('GHSA-2xp9-vwfh-vxw4'), adv('GHSA-q4gf-8mx6-v5v3', 'high')] } });

test('the two next criticals are excepted until 7 Oct, and nothing else is', () => {
  assert.deepEqual(EXCEPTIONS.map((e) => e.until), ['2026-10-07', '2026-10-07']);
  const v = judge(NEXT_TWO, '2026-09-24');
  assert.equal(v.blocking.length, 0);
  assert.equal(v.excepted.length, 2);
});

test('on 8 Oct the exception has lapsed and the same report blocks', () => {
  const v = judge(NEXT_TWO, '2026-10-08');
  assert.equal(v.blocking.length, 2);
  assert.equal(v.lapsed.length, 2);
});

test('a NEW critical in next still blocks — the exception is by advisory, not by package', () => {
  const v = judge(report({ next: { via: [adv('GHSA-aaaa-bbbb-cccc')] } }), '2026-09-24');
  assert.deepEqual(v.blocking.map((b) => b.advisory), ['GHSA-aaaa-bbbb-cccc']);
});

test('the same advisory id on another package is not excepted', () => {
  const v = judge(report({ 'other-pkg': { via: [adv('GHSA-p293-qw3h-jr36')] } }), '2026-09-24');
  assert.equal(v.blocking.length, 1);
});

test('highs and transitive string entries never block (the gate is critical-only, as before)', () => {
  const v = judge(report({ postcss: { via: [adv('GHSA-6g55-p6wh-862q', 'high')] }, x: { via: ['postcss'] } }), '2026-09-24');
  assert.equal(v.blocking.length, 0);
});
