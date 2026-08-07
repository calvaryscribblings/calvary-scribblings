// R11.6 — THE SHELF CAP AS A FUNCTION OF (kind, tier).
//
//   node --test tests/membership/shelf-caps.test.mjs      (npm run test:membership)
//
// app/lib/shelf.js is a browser module, but its cap table is pure arithmetic with no imports
// and no top-level touch of indexedDB, so bare Node can import it and assert the table
// directly. Everything below the table in that file needs a browser and is not tested here.
//
// THE THREE THINGS MOST WORTH BREAKING A BUILD OVER:
//
//   1. UNLIMITED IS Infinity. `existing.length >= cap` is the only gate in saveStory(), and
//      it is correct for Platinum without a branch ONLY because Infinity is a number. A null
//      or a -1 sentinel turns that comparison into "your shelf is full" for the tier that
//      paid the most.
//   2. AN UNKNOWN TIER FLOORS TO FREE, NOT TO ZERO. A membership record written by something
//      newer than this build must not take away the two slots every signed-in reader has.
//   3. BOOKS ARE 0 ON EVERY TIER, deliberately — the web has no book shelf to cap (master
//      EPUBs are read:false and streamed through a 300s signed URL). Raising this would let
//      saveStory() admit a record the web cannot store or re-open.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CAPS, capFor, isUnlimitedCap } from '../../app/lib/shelf.js';
import { TIERS } from '../../app/lib/membership.js';

describe('capFor(kind, tier)', () => {
  test('stories: free 2, gold 20, platinum unlimited', () => {
    assert.equal(capFor('story', 'free'), 2);
    assert.equal(capFor('story', 'gold'), 20);
    assert.equal(capFor('story', 'platinum'), Infinity);
  });

  test('unlimited is Infinity, so the save gate is false for every shelf', () => {
    const cap = capFor('story', 'platinum');
    assert.equal(Number.isFinite(cap), false);
    assert.equal(isUnlimitedCap(cap), true);
    for (const held of [0, 1, 20, 1e6]) {
      assert.equal(held >= cap, false, `a shelf of ${held} must not read as full`);
    }
  });

  test('finite caps are finite, so pip renderers may still draw them', () => {
    assert.equal(isUnlimitedCap(capFor('story', 'free')), false);
    assert.equal(isUnlimitedCap(capFor('story', 'gold')), false);
  });

  test('an unknown or malformed tier floors to free, never to zero', () => {
    for (const bad of ['PLATINUM', 'diamond', '', null, undefined, 0, {}, []]) {
      assert.equal(capFor('story', bad), 2, `${JSON.stringify(bad)} must fall back to free`);
    }
  });

  test('every tier the app knows about has a story row', () => {
    for (const tier of TIERS) {
      assert.equal(typeof capFor('story', tier), 'number');
      assert.ok(capFor('story', tier) >= 2, `${tier} must not hold less than free`);
    }
  });

  test('books are 0 on every tier — there is no web book shelf to cap', () => {
    for (const tier of [...TIERS, 'nonsense']) assert.equal(capFor('book', tier), 0);
  });

  test('an unknown kind is 0, which is different from an unknown tier on purpose', () => {
    assert.equal(capFor('audiobook', 'platinum'), 0);
    assert.equal(capFor(undefined, 'gold'), 20); // the kind default is 'story'
  });

  test('the table itself carries a row per kind, not a bare number', () => {
    for (const kind of Object.keys(CAPS)) {
      assert.equal(typeof CAPS[kind], 'object', `${kind} must be a tier row`);
      assert.ok('free' in CAPS[kind], `${kind} needs a free row to floor to`);
    }
  });
});
