// W25 — the membership switch's live probe (scripts/money/membership-gate-probe.mjs). Its verdict
// is pure; this pins it, because Wednesday's "is the store open?" rests on it.
//
//   node --test tests/ci/w25-membership-switch.test.mjs          (npm run test:ci)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, CHECKOUTS } from '../../scripts/money/membership-gate-probe.mjs';

const signedOut = { status: 401, code: 'signed_out' };

test('the four checkouts, by path', () => {
  assert.deepEqual(CHECKOUTS.map((c) => c.path), ['checkout', 'paystack-checkout', 'pass-checkout', 'paystack-pass-checkout']);
});
test('closed: a placeholder token is refused at the gate, 409 not_configured', () => {
  assert.equal(verdict(signedOut, { status: 409, code: 'not_configured' }), 'closed');
});
test('open: the placeholder passes the gate and fails at identity, 401 signed_out', () => {
  assert.equal(verdict(signedOut, { status: 401, code: 'signed_out' }), 'open');
});
test('"401 signed out" alone proves nothing: it is the answer in BOTH states', () => {
  assert.equal(verdict({ status: 409, code: 'not_configured' }, signedOut), 'UNEXPECTED');
  assert.equal(verdict(signedOut, { status: 500, code: null }), 'UNEXPECTED');
  assert.equal(verdict(signedOut, { status: 409, code: 'not_offered' }), 'UNEXPECTED');
});
