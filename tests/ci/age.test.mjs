// THE MINIMUM AGE — 18, as app/terms and app/privacy publish it.
//
//   node --test tests/ci/age.test.mjs      (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_AGE, ageOn, ageProblem, AGE_COPY } from '../../app/lib/age.js';

const on = (y, m, d) => new Date(y, m - 1, d, 12);

describe('the number comes from the published pages', () => {
  test('MIN_AGE is 18, and the Terms and the Privacy policy both say 18', () => {
    assert.equal(MIN_AGE, 18);
    const terms = readFileSync(new URL('../../app/terms/page.js', import.meta.url), 'utf8');
    const privacy = readFileSync(new URL('../../app/privacy/page.js', import.meta.url), 'utf8');
    assert.match(terms, /18 years of age or older/);
    assert.match(privacy, /adults aged 18 and over/);
  });
});

describe('whole years, on the reader\'s own calendar day', () => {
  test('the day before the 18th birthday is 17; the birthday is 18', () => {
    assert.equal(ageOn('2008-09-24', on(2026, 9, 23)), 17);
    assert.equal(ageOn('2008-09-24', on(2026, 9, 24)), 18);
  });
  test('a 29 February birthday turns over on 1 March in a common year', () => {
    assert.equal(ageOn('2008-02-29', on(2026, 2, 28)), 17);
    assert.equal(ageOn('2008-02-29', on(2026, 3, 1)), 18);
  });
  for (const bad of ['', '2008-13-01', '2008-02-30', '08-01-01', 'yesterday', '2030-01-01', '1800-01-01']) {
    test(`unreadable or impossible: ${JSON.stringify(bad)}`, () => assert.equal(ageOn(bad, on(2026, 9, 23)), null));
  }
});

describe('what the reader is told', () => {
  test('under 18 → the published age, plainly', () => assert.equal(ageProblem('2010-01-01', on(2026, 9, 23)), AGE_COPY.under));
  test('missing → asked for it', () => assert.equal(ageProblem('', on(2026, 9, 23)), AGE_COPY.missing));
  test('impossible → asked to check it', () => assert.equal(ageProblem('2026-12-31', on(2026, 9, 23)), AGE_COPY.unreadable));
  test('18 and over → nothing', () => assert.equal(ageProblem('2000-01-01', on(2026, 9, 23)), null));
  test('the refusal names the number the Terms name', () => assert.match(AGE_COPY.under, /18/));
});
