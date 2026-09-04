// THE HORIZON'S DECISION, asserted without a database.
//
// planSweep() is pure so that the two rulings it implements can be tested
// directly rather than inferred from what a sweep happened to do:
//
//   · a thread moves as ONE UNIT, aged on its parent — so orphans are
//     structurally impossible rather than merely unlikely;
//   · a pinned thread survives, AND SO DO ITS REPLIES — which is what tonight's
//     winners announcement needs.
//
// The second of those is the one worth having a test for. It is easy to write a
// sweep that exempts the pinned post and takes the thirteen congratulations
// underneath it with everything else, and the failure would only be visible two
// days after the announcement, when it is much too late to fix.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planSweep, HORIZON_MS, londonHour, BELL_HOUR } from '../../scripts/square/horizon.mjs';

const NOW = Date.UTC(2026, 8, 2, 19, 0, 0);      // 2 Sep 2026, 20:00 London (BST)
const hoursAgo = (h) => NOW - h * 3600000;

const post = (id, over = {}) => ({ id, authorUid: 'u1', text: 't', createdAt: hoursAgo(1), parentId: null, ...over });
const reply = (id, parentId, over = {}) => post(id, { parentId, ...over });

const ids = (records) => records.map((r) => r.id).sort();

describe('the horizon — what moves and what stays', () => {
  test('a thread inside 48 hours stays, parent and replies together', () => {
    const p = planSweep([
      post('a', { createdAt: hoursAgo(10) }),
      reply('a1', 'a', { createdAt: hoursAgo(9) }),
      reply('a2', 'a', { createdAt: hoursAgo(8) }),
    ], NOW);
    assert.deepEqual(ids(p.keep), ['a', 'a1', 'a2']);
    assert.equal(p.move.length, 0);
  });

  test('a thread past 48 hours moves whole', () => {
    const p = planSweep([
      post('a', { createdAt: hoursAgo(60) }),
      reply('a1', 'a', { createdAt: hoursAgo(59) }),
    ], NOW);
    assert.deepEqual(ids(p.move), ['a', 'a1']);
    assert.equal(p.keep.length, 0);
  });

  test('THE ORPHAN CASE: a fresh reply under an old parent goes WITH its parent', () => {
    // The failure this prevents. A reply is always NEWER than its parent, so
    // per-post ageing archives every parent first and orphans its replies — not
    // a rare edge but the guaranteed outcome for every thread in the room. Aged
    // on the parent, the whole thread leaves together and nothing is stranded.
    const p = planSweep([
      post('old', { createdAt: hoursAgo(60) }),
      reply('fresh', 'old', { createdAt: hoursAgo(1) }),
    ], NOW);
    assert.deepEqual(ids(p.move), ['fresh', 'old'], 'the fresh reply must not be left behind');
    assert.equal(p.keep.length, 0);
  });

  test('and the reverse: an old reply under a young parent is NOT taken early', () => {
    const p = planSweep([
      post('young', { createdAt: hoursAgo(2) }),
      reply('r', 'young', { createdAt: hoursAgo(1) }),
    ], NOW);
    assert.equal(p.move.length, 0);
  });

  test('⭑ A PINNED THREAD SURVIVES, AND SO DO ITS REPLIES', () => {
    // Tonight's announcement: thirteen winners, and thirteen congratulations
    // under it. The post must not vanish on Friday and neither should they.
    const p = planSweep([
      post('ann', { createdAt: hoursAgo(3600), pinned: true }),   // 150 days old
      ...Array.from({ length: 13 }, (_, i) => reply(`c${i}`, 'ann', { createdAt: hoursAgo(3599) })),
      post('other', { createdAt: hoursAgo(60) }),
    ], NOW);
    assert.equal(p.keep.length, 14, 'the announcement and all thirteen replies stay');
    assert.ok(p.keep.every((r) => r.id === 'ann' || r.id.startsWith('c')));
    assert.deepEqual(ids(p.move), ['other']);
  });

  test('unpinning lets a thread go at the next bell, not immediately', () => {
    const pinned = planSweep([post('a', { createdAt: hoursAgo(3600), pinned: true })], NOW);
    assert.equal(pinned.move.length, 0);
    const unpinned = planSweep([post('a', { createdAt: hoursAgo(3600), pinned: false })], NOW);
    assert.equal(unpinned.move.length, 1);
  });

  test('an already-orphaned reply is adopted and aged on itself, not made immortal', () => {
    // Should not arise once this runs, but historical data is not owed our
    // assumptions — and a record with nothing to be aged against would otherwise
    // sit in the room forever.
    const p = planSweep([reply('lost', 'parent-that-is-gone', { createdAt: hoursAgo(60) })], NOW);
    assert.equal(p.orphans, 1);
    assert.deepEqual(ids(p.move), ['lost']);
  });

  test('the boundary is exact', () => {
    const justInside = planSweep([post('a', { createdAt: NOW - HORIZON_MS + 1000 })], NOW);
    assert.equal(justInside.move.length, 0);
    const justOutside = planSweep([post('a', { createdAt: NOW - HORIZON_MS - 1000 })], NOW);
    assert.equal(justOutside.move.length, 1);
  });

  test('a post with no createdAt is treated as ancient rather than immortal', () => {
    const p = planSweep([post('a', { createdAt: undefined })], NOW);
    assert.equal(p.move.length, 1);
  });
});

describe('the two clocks', () => {
  test('the bell is 20:00 London, and the helper tracks BST and GMT alike', () => {
    assert.equal(BELL_HOUR, 20);
    assert.equal(londonHour(Date.UTC(2026, 8, 2, 19, 0)), 20, 'September is BST (UTC+1)');
    assert.equal(londonHour(Date.UTC(2026, 0, 2, 20, 0)), 20, 'January is GMT (UTC+0)');
    // The reason the workflow runs hourly and the SCRIPT decides: a fixed UTC
    // cron set for one of these is an hour wrong for the other, and would sweep
    // in the middle of a live session for half the year.
    assert.notEqual(londonHour(Date.UTC(2026, 8, 2, 20, 0)), 20);
  });

  test('every post gets three sessions, whether posted at 20:01 or 23:59', () => {
    // The property that makes "evaluate at the bell" the right rule: because the
    // room only runs in the evening, a post from night N is 44-48h old at the
    // bell of night N+2 (so it survives) and 68-72h at N+3 (so it goes) — no
    // matter where in the evening it was written. Nothing ever vanishes
    // mid-session, and two posts four hours apart get the same amount of room.
    const bell = (day) => Date.UTC(2026, 8, day, 19, 0);       // 20:00 London
    for (const minsIn of [1, 60, 180, 239]) {                   // 20:01 … 23:59
      const made = bell(2) + minsIn * 60000;
      const survives = (atBell) => planSweep([post('a', { createdAt: made })], atBell).move.length === 0;
      assert.ok(survives(bell(3)), `posted +${minsIn}m must survive night 2`);
      assert.ok(survives(bell(4)), `posted +${minsIn}m must survive night 3`);
      assert.ok(!survives(bell(5)), `posted +${minsIn}m must be gone by night 4`);
    }
  });
});
