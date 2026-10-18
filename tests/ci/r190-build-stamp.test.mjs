// Ruling 190 (W52): no reader sees a build ID. The site footer draws the stamp for a founder only,
// by /admin's own check. This tests the condition with the founder uids as constants; no account,
// founder or otherwise, is created anywhere (not even in the emulator).
//
//   node --test tests/ci/r190-build-stamp.test.mjs      (part of npm run test:ci)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showsBuildStamp } from '../../app/lib/buildStampPolicy.js';
import { FOUNDER_UIDS, isFounder } from '../../app/lib/founders.js';

test('each founder sees the stamp', () => {
  assert.equal(FOUNDER_UIDS.length, 2);
  for (const uid of FOUNDER_UIDS) assert.equal(showsBuildStamp(uid), true);
});

test('signed out, or any other reader: no stamp', () => {
  for (const uid of [undefined, null, '', 'w52-test-reader', 'AAAAowner0000000000000000001', FOUNDER_UIDS[0].toLowerCase(), ` ${FOUNDER_UIDS[0]}`, 42, {}]) {
    assert.equal(showsBuildStamp(uid), false, String(uid));
  }
});

test('it is exactly /admin\'s founder check', () => {
  for (const uid of [...FOUNDER_UIDS, 'someone', null]) assert.equal(showsBuildStamp(uid), isFounder(uid));
});
