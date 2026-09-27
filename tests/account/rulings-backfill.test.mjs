// W19 / RULING 48 — rulings 29, 30 and 33 reach accounts deleted before W17 shipped them.
// scripts/account/rulings-backfill.mjs plans each past deletion against today's data and the backup
// from before it. These tests build the three things the old scrub could have left, prove each is
// planned the way a fresh deletion does it today, and that a second pass finds nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planPastDeletion, pastDeletions, removedReplies, detachedVoices, changes, RULINGS_SHIPPED_AT,
} from '../../scripts/account/rulings-backfill.mjs';

const GONE = 'GONEdeleted00000000000000001';
const B = 'BBBBother0000000000000000002';
const NOW = 1790000000000;

// An in-memory database, and the scrub's own write order: nulls, then tombstones, then counters.
const clone = (o) => JSON.parse(JSON.stringify(o));
function apply(db, plan) {
  const at = (path, fn) => {
    const ks = path.split('/');
    let o = db;
    for (const k of ks.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k]; }
    fn(o, ks.at(-1));
  };
  for (const p of plan.nulls) at(p, (o, k) => { delete o[k]; });
  for (const [p, v] of Object.entries(plan.sets)) at(p, (o, k) => { o[k] = clone(v); });
  for (const p of plan.decrements) at(p, (o, k) => { if (typeof o[k] === 'number') o[k] = Math.max(0, o[k] - 1); });
  return db;
}

const world = () => ({
  comments: {
    story1: {
      c1: { authorUid: GONE, text: 'mine, alone', createdAt: 1 },            // 29: still up
      c2: { authorUid: GONE, text: 'mine, answered', createdAt: 2 },         // 30: B replied beneath
      c3: { authorUid: B, text: 'reply to c2', parentId: 'c2', createdAt: 3 },
      c4: { authorUid: B, text: 'not about them', createdAt: 4 },
    },
  },
  square_posts: {
    p1: { authorUid: GONE, text: 'post', createdAt: 5 },                     // 29
    p2: { authorUid: B, text: 'someone else', createdAt: 6 },
  },
  cms_voices: {
    v1: { matchUid: GONE, slug: 'v1-slug', quote: 'quoted' },               // 33: still linked
    v2: { slug: 'v2-slug', quote: 'detached earlier' },                      // 33: linked in the backup only
    v3: { slug: 'v3', quote: 'never theirs' },
  },
});

test('ruling 48 reaches only deletions scrubbed before the rulings shipped', () => {
  const recs = {
    old: { steps: { scrub: RULINGS_SHIPPED_AT - 1 } },
    fresh: { steps: { scrub: RULINGS_SHIPPED_AT + 1 } },
    unfinished: { steps: { auth: 1 } },
  };
  assert.deepEqual(pastDeletions(recs).map(([k]) => k), ['old']);
});

test('ruling 29: their comment and post still up are deleted', () => {
  const r = planPastDeletion(GONE, world(), null, { now: NOW });
  assert.equal(r.counts.ruling29.comments, 1);
  assert.equal(r.counts.ruling29.squarePosts, 1);
  assert.ok(r.plan.nulls.includes('comments/story1/c1'));
  assert.ok(r.plan.nulls.includes('square_posts/p1'));
});

test('ruling 30: their comment with another reader\'s reply becomes the tombstone a fresh deletion writes', () => {
  const r = planPastDeletion(GONE, world(), null, { now: NOW });
  assert.equal(r.counts.ruling30.tombstonesToWrite, 1);
  assert.deepEqual(r.plan.sets['comments/story1/c2'], { deleted: true, deletedAt: NOW, createdAt: 2 });
  assert.ok(!r.plan.nulls.some((p) => p.startsWith('comments/story1/c3')), 'the other reader\'s reply stays');
});

test('ruling 33: a linked voice and a voice the old scrub detached both come down, images and all', () => {
  const before = { cms_voices: { v2: { matchUid: GONE, slug: 'v2-slug' } } };
  const r = planPastDeletion(GONE, world(), before, { now: NOW });
  assert.deepEqual(r.counts.ruling33, { voicesStillLinked: 1, voicesDetachedEarlier: 1 });
  assert.ok(r.plan.nulls.includes('cms_voices/v1') && r.plan.nulls.includes('cms_voices/v2'));
  assert.ok(!r.plan.nulls.includes('cms_voices/v3'));
  assert.deepEqual(r.plan.voices.map((v) => v.id).sort(), ['v1', 'v2']);
  assert.ok(r.plan.voices.find((v) => v.id === 'v2').storagePrefixes.includes('voices/v2-slug/'));
});

test('ruling 30: a reply the OLD scrub removed is found in the backup — and the run refuses rather than guess', () => {
  const before = {
    comments: { story2: { x1: { authorUid: GONE, text: 'gone' }, x2: { authorUid: B, text: 'lost with it', parentId: 'x1' } } },
    square_posts: { q1: { authorUid: GONE }, q2: { authorUid: B, parentId: 'q1' } },
  };
  assert.deepEqual(removedReplies(GONE, before, {}), ['comments/story2/x2', 'square_posts/q2']);
  const r = planPastDeletion(GONE, {}, before, { now: NOW });
  assert.equal(r.counts.ruling30.repliesRemovedByOldScrub, 2);
  assert.match(r.refuse, /2 reply/);
  // A reply still there today was not removed.
  assert.deepEqual(removedReplies(GONE, before, { comments: { story2: { x2: {} } }, square_posts: { q2: {} } }), []);
});

test('a nested Open Pages reply the old scrub removed is found too', () => {
  const before = { comments: { piece: { n1: { authorUid: GONE, replies: { r1: { authorUid: B, text: 'under them' } } } } } };
  assert.deepEqual(removedReplies(GONE, before, {}), ['comments/piece/n1/replies/r1']);
});

test('anything outside 29/30/33 the old scrub left is reported, never applied', () => {
  const w = { ...world(), storyReads: { story1: { [GONE]: 1 } } };
  const r = planPastDeletion(GONE, w, null, { now: NOW });
  assert.deepEqual(r.outOfScope, { storyReads: 1 });
  assert.match(r.refuse, /outside rulings 29\/30\/33/);
});

test('IDEMPOTENT: after applying, a second run changes nothing', () => {
  const before = { cms_voices: { v2: { matchUid: GONE, slug: 'v2-slug' } } };
  const db = world();
  const first = planPastDeletion(GONE, db, before, { now: NOW });
  assert.equal(first.refuse, null);
  assert.ok(changes(first) > 0);
  apply(db, first.plan);
  const second = planPastDeletion(GONE, db, before, { now: NOW + 1 });
  assert.equal(changes(second), 0, JSON.stringify(second.plan));
  assert.equal(second.refuse, null);
  assert.deepEqual(second.counts, {
    ruling29: { comments: 0, replies: 0, squarePosts: 0, squareArchived: 0 },
    ruling30: { tombstonesToWrite: 0, repliesRemovedByOldScrub: 0 },
    ruling33: { voicesStillLinked: 0, voicesDetachedEarlier: 0 },
  });
  // And what a reader sees is what a fresh deletion leaves: the tombstone, the other reader's reply.
  assert.deepEqual(Object.keys(db.comments.story1).sort(), ['c2', 'c3', 'c4']);
  assert.equal(db.comments.story1.c2.deleted, true);
  assert.equal(db.comments.story1.c2.text, undefined);
});

test('the detached-voice check ignores a voice that is gone today or linked to someone else', () => {
  const before = { cms_voices: { a: { matchUid: GONE }, b: { matchUid: GONE } } };
  const today = { cms_voices: { b: { matchUid: B } } };
  assert.deepEqual(detachedVoices(GONE, before, today).map((v) => v.id), ['b']);
  assert.deepEqual(detachedVoices(GONE, before, {}), []);
});
