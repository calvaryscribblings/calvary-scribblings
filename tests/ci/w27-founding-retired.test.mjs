// W27 — ruling 108: every reader-facing mention of a founding price is retired. Billing is not:
// the founding generation, the portal pinned to it and the founding/foundingSince fields stay
// (functions/api/membership/*). This holds the two READER surfaces to it at the source; the
// rendered page is checked in tests/membership/copy.spec.mjs and the member states in
// tests/membership/page-member.spec.mjs.
//
//   node --test tests/ci/w27-founding-retired.test.mjs          (npm run test:ci)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('/membership carries no founding copy, box, class or clause', () => {
  const s = src('app/membership/page.js');
  assert.doesNotMatch(s, /founding/i);
  assert.match(s, /membership is active\. Thank you for keeping this place going\./);
});

test('Settings\' membership section carries no Founding badge, rule or field', () => {
  const s = src('app/components/MembershipSection.js');
  assert.doesNotMatch(s, /founding/i);
  assert.doesNotMatch(s, /ms-badge/);
});

test('billing keeps the founding generation (108 is copy only)', () => {
  assert.match(src('functions/api/membership/prices.js'), /CURRENT_GENERATION = 'founding'/);
  assert.match(src('functions/api/membership/paystack-plans.js'), /CURRENT_GENERATION = 'founding'/);
  assert.match(src('functions/api/membership/_membership.js'), /foundingSince/);
});
