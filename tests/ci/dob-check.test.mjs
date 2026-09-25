// W5 · the under-18 check for existing accounts — app/lib/dobCheck.js.
//
// The cases are the ruling's (Ikenna, 24–25 Sep): under 18 or unreadable → confirm; confirmed
// under 18 → deleted; founders exempt; missing left alone. They are written by hand, not derived.
// ⚠ The app's lib/dobCheck.ts is in a repo this container cannot see: these are the web's cases,
// for the app's harness to run, not a copy of the app's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dobStatus, storedDob, mustConfirm, confirmOutcome, confirmedDobUpdate, DOB_STATUS,
} from '../../app/lib/dobCheck.js';

// Local noon, so the reader's-calendar rule in ageOn() has no midnight to trip on.
const NOW = new Date(2026, 8, 25, 12, 0, 0); // 25 Sep 2026
const READER = 'AAAAreader000000000000000001';
const FOUNDER = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

const CASES = [
  // [label, uid, dob, status]
  ['adult', READER, '1990-05-01', DOB_STATUS.OK],
  ['18 today', READER, '2008-09-25', DOB_STATUS.OK],
  ['18 tomorrow', READER, '2008-09-26', DOB_STATUS.UNDER_18],
  ['a child', READER, '2015-01-01', DOB_STATUS.UNDER_18],
  ['born this year', READER, '2026-01-01', DOB_STATUS.UNDER_18],
  ['missing: null', READER, null, DOB_STATUS.MISSING],
  ['missing: undefined', READER, undefined, DOB_STATUS.MISSING],
  ['missing: empty string', READER, '', DOB_STATUS.MISSING],
  ['unreadable: words', READER, 'yesterday', DOB_STATUS.UNREADABLE],
  ['unreadable: day-first', READER, '01/05/1990', DOB_STATUS.UNREADABLE],
  ['unreadable: 31 February', READER, '1990-02-31', DOB_STATUS.UNREADABLE],
  ['unreadable: in the future', READER, '2030-01-01', DOB_STATUS.UNREADABLE],
  ['unreadable: 131 years', READER, '1890-01-01', DOB_STATUS.UNREADABLE],
  ['unreadable: a number', READER, 631152000000, DOB_STATUS.UNREADABLE],
  ['founder, under-18 date', FOUNDER, '2015-01-01', DOB_STATUS.EXEMPT],
  ['founder, unreadable', FOUNDER, 'nonsense', DOB_STATUS.EXEMPT],
  ['founder, missing', FOUNDER, null, DOB_STATUS.EXEMPT],
];

for (const [label, uid, dob, want] of CASES) {
  test(`status · ${label} → ${want}`, () => {
    assert.equal(dobStatus({ uid, dob, now: NOW }), want);
  });
}

test('only under 18 and unreadable are asked; missing is left alone; founders never', () => {
  assert.equal(mustConfirm(DOB_STATUS.UNDER_18), true);
  assert.equal(mustConfirm(DOB_STATUS.UNREADABLE), true);
  assert.equal(mustConfirm(DOB_STATUS.MISSING), false);
  assert.equal(mustConfirm(DOB_STATUS.OK), false);
  assert.equal(mustConfirm(DOB_STATUS.EXEMPT), false);
});

test('the stored date: a public copy (old binary) wins, empty strings are nothing', () => {
  assert.equal(storedDob({ publicDob: '2012-01-01', privateDob: '1990-01-01' }), '2012-01-01');
  assert.equal(storedDob({ publicDob: '', privateDob: '1990-01-01' }), '1990-01-01');
  assert.equal(storedDob({ publicDob: null, privateDob: undefined }), null);
});

test('the confirmation: adult → ok, under 18 → the account goes, anything else → ask again', () => {
  assert.equal(confirmOutcome('1990-05-01', NOW), DOB_STATUS.OK);
  assert.equal(confirmOutcome('2010-05-01', NOW), DOB_STATUS.UNDER_18);
  assert.equal(confirmOutcome('', NOW), DOB_STATUS.MISSING);
  assert.equal(confirmOutcome('1990-02-31', NOW), DOB_STATUS.UNREADABLE);
});

test('a confirmed adult date is ONE update that also clears the public copy', () => {
  assert.deepEqual(confirmedDobUpdate(READER, '1990-05-01'), {
    [`users_private/${READER}/dob`]: '1990-05-01',
    [`users/${READER}/dob`]: null,
  });
});
