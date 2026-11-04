// RULING 329 — scripts/account/clear-329.mjs clears exactly the two leftovers and refuses anything else.
//
//   node --test tests/ci/ruling-329.test.mjs      (npm run test:ci)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plan329, EXPECTED } from '../../scripts/account/clear-329.mjs';

const gone = () => true;

test('the two leftovers ruling 329 names, whole, and nothing else', () => {
  const p = plan329({ push_tokens: { u1: 1 }, library_notifications: { author_x: 1 } }, gone);
  assert.deepEqual(p.paths, ['push_tokens/u1', 'library_notifications/author_x']);
  assert.deepEqual(EXPECTED, { push_tokens: 1, library_notifications: 1 });
});

test('an owner still in Auth is not a leftover', () => {
  const p = plan329({ push_tokens: { u1: 1, live: 1 }, library_notifications: { author_x: 1 } }, (k) => k !== 'live');
  assert.deepEqual(p.paths, ['push_tokens/u1', 'library_notifications/author_x']);
});

test('a third profile-less owner appearing later is REFUSED, never swept up', () => {
  assert.throws(() => plan329({ push_tokens: { u1: 1, u2: 1 }, library_notifications: { author_x: 1 } }, gone), /REFUSED: push_tokens has 2/);
  assert.throws(() => plan329({ push_tokens: {}, library_notifications: { author_x: 1 } }, gone), /REFUSED: push_tokens has 0/);
});

test('a leftover bigger than the one counted is REFUSED', () => {
  assert.throws(() => plan329({ push_tokens: { u1: 9 }, library_notifications: { author_x: 1 } }, gone), /holds 9 record/);
});

test('it writes only through the SAFETY-1 guard, and prints no key', () => {
  const s = readFileSync(new URL('../../scripts/account/clear-329.mjs', import.meta.url), 'utf8');
  assert.match(s, /guard\.adminDb\(getDatabase\(\)\)/);
  assert.match(s, /loadServiceAccount\(\)/);
  assert.doesNotMatch(s, /console\.(log|error)\([^)]*\$\{(k|key|uid|p)\}/);
});
