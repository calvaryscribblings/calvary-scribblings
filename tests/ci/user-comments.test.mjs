// R19.2 — THE PER-AUTHOR COMMENT INDEX.
//
//   node --test tests/ci/user-comments.test.mjs      (npm run test:ci)
//
// app/lib/userComments.js replaced eight whole-node scans of `comments` with reads of an
// index. Two properties carry the whole design, and both are asserted here:
//
//   1. IT FAILS CLOSED DOWNWARD. Every malformed shape counts as LESS, never MORE. A count
//      that is too low costs a reader a milestone they can reach again; a count that is too
//      high mints points nobody earned.
//   2. THE WRITE IS ATOMIC AND IDEMPOTENT. The comment and its index entry are one patch, so
//      they cannot land separately, and re-writing the same comment id changes nothing —
//      which is exactly what a stored integer could not have promised from a browser.
//
// The lister is driven against a stubbed ref/get, so the bounded-read property is asserted
// on the actual requests made rather than assumed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_COMMENTS_PATH,
  commentIndexEntry, indexedCommentWrite, indexedCommentRemoval,
  commentCountOf, commentedSlugCountOf, commentIndexEntries, commentedSlugs,
  commentMilestoneFor, loadCommentsFor,
  COMMENT_MILESTONE_EVERY, COMMENT_MILESTONE_POINTS,
} from '../../app/lib/userComments.js';

const idx = (n, slug = 's', t = 1000) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { slug, createdAt: t + i }]));

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('fails closed downward — every ambiguity counts as less', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  const JUNK = [null, undefined, 0, 42, '', 'nope', true, [], [1, 2, 3], NaN];

  test('a missing or non-object index is zero, never a guess', () => {
    for (const v of JUNK) {
      assert.equal(commentCountOf(v), 0, `${JSON.stringify(v)} must count 0`);
      assert.equal(commentedSlugCountOf(v), 0);
      assert.deepEqual(commentIndexEntries(v), []);
      assert.deepEqual(commentedSlugs(v), []);
    }
  });

  test('an array is rejected outright — RTDB can hand one back for integer-ish keys', () => {
    assert.equal(commentCountOf([{ slug: 'a', createdAt: 1 }, { slug: 'b', createdAt: 2 }]), 0);
  });

  test('entries without a usable slug are dropped, not counted as one', () => {
    const node = {
      good: { slug: 'a', createdAt: 1 },
      noSlug: { createdAt: 2 },
      emptySlug: { slug: '', createdAt: 3 },
      numberSlug: { slug: 7, createdAt: 4 },
      nullEntry: null,
      stringEntry: 'x',
      arrayEntry: ['a'],
    };
    assert.equal(commentCountOf(node), 1);
    assert.deepEqual(commentedSlugs(node), ['a']);
  });

  test('a missing createdAt still counts but sorts last — presence beats ordering', () => {
    const node = { a: { slug: 's' }, b: { slug: 's', createdAt: 99 } };
    assert.equal(commentCountOf(node), 2);
    assert.deepEqual(commentIndexEntries(node).map((e) => e.commentId), ['b', 'a']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('counting', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('the count is the number of keys', () => {
    assert.equal(commentCountOf(idx(0)), 0);
    assert.equal(commentCountOf(idx(1)), 1);
    assert.equal(commentCountOf(idx(182)), 182);
  });

  test('distinct slugs, not comments — the badge engine 1-per-slug cap', () => {
    const node = {
      a: { slug: 'x', createdAt: 1 },
      b: { slug: 'x', createdAt: 2 },
      c: { slug: 'y', createdAt: 3 },
    };
    assert.equal(commentCountOf(node), 3);
    assert.equal(commentedSlugCountOf(node), 2);
  });

  test('entries come back newest first', () => {
    const node = { a: { slug: 's', createdAt: 10 }, b: { slug: 's', createdAt: 30 }, c: { slug: 's', createdAt: 20 } };
    assert.deepEqual(commentIndexEntries(node).map((e) => e.commentId), ['b', 'c', 'a']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('the write is atomic and idempotent', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('one patch carries both the comment and its index entry', () => {
    const patch = indexedCommentWrite({
      uid: 'u1', slug: 'a-story', commentId: 'c1',
      comment: { text: 'hi', authorUid: 'u1', createdAt: 5 },
    });
    assert.deepEqual(Object.keys(patch).sort(), [
      'comments/a-story/c1',
      `${USER_COMMENTS_PATH}/u1/c1`,
    ].sort());
    assert.deepEqual(patch[`${USER_COMMENTS_PATH}/u1/c1`], { slug: 'a-story', createdAt: 5 });
  });

  test('writing the same comment twice is a no-op — a retry cannot inflate the count', () => {
    const args = { uid: 'u1', slug: 's', commentId: 'c1', comment: { text: 'x', createdAt: 5 } };
    const a = indexedCommentWrite(args);
    const b = indexedCommentWrite(args);
    assert.deepEqual(a, b);
    // Applied to a node twice, the key count is unchanged — the property an increment lacks.
    const node = {};
    for (const patch of [a, b]) node[Object.keys(patch)[1].split('/').pop()] = Object.values(patch)[1];
    assert.equal(commentCountOf(node), 1);
  });

  test('the index entry carries no comment text — nothing to keep in sync on an edit', () => {
    const patch = indexedCommentWrite({
      uid: 'u1', slug: 's', commentId: 'c1',
      comment: { text: 'the words', authorName: 'A', authorUid: 'u1', createdAt: 5 },
    });
    assert.deepEqual(Object.keys(patch[`${USER_COMMENTS_PATH}/u1/c1`]).sort(), ['createdAt', 'slug']);
  });

  test('a missing identifier throws rather than writing a half-record', () => {
    for (const bad of [
      { slug: 's', commentId: 'c' },
      { uid: 'u', commentId: 'c' },
      { uid: 'u', slug: 's' },
    ]) {
      assert.throws(() => indexedCommentWrite({ ...bad, comment: {} }));
    }
  });

  test('removal clears both, in one patch', () => {
    const patch = indexedCommentRemoval({ uid: 'u1', slug: 's', commentId: 'c1' });
    assert.equal(patch['comments/s/c1'], null);
    assert.equal(patch[`${USER_COMMENTS_PATH}/u1/c1`], null);
  });

  test('removal without a known author still deletes the comment', () => {
    const patch = indexedCommentRemoval({ uid: null, slug: 's', commentId: 'c1' });
    assert.equal(patch['comments/s/c1'], null);
    assert.equal(Object.keys(patch).length, 1, 'must not write a null under an undefined uid');
  });

  test('commentIndexEntry coerces rather than storing junk', () => {
    const e = commentIndexEntry('a-slug', '123');
    assert.equal(e.slug, 'a-slug');
    assert.equal(e.createdAt, 123);
    assert.equal(typeof commentIndexEntry('s', undefined).createdAt, 'number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('the milestone', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('fires on exact multiples only', () => {
    assert.equal(commentMilestoneFor(50).amount, COMMENT_MILESTONE_POINTS);
    assert.equal(commentMilestoneFor(100).count, 100);
    for (const n of [49, 51, 99, 101, 1]) assert.equal(commentMilestoneFor(n), null);
  });

  test('never fires on zero, negatives or non-integers — no points from a broken count', () => {
    for (const n of [0, -50, -1, 50.5, NaN, Infinity, '50', null, undefined]) {
      assert.equal(commentMilestoneFor(n), null, `${n} must not award points`);
    }
  });

  test('the wording matches what readers have been shown all along', () => {
    assert.equal(commentMilestoneFor(50).description, '50 comments milestone');
    assert.equal(COMMENT_MILESTONE_EVERY, 50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('the lister reads only what the index names', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  /** A stub whose `get` records every path asked for. */
  function harness(tree) {
    const asked = [];
    const ref = (_db, path) => path;
    const get = async (path) => {
      asked.push(path);
      const val = path.split('/').reduce((n, k) => (n == null ? n : n[k]), tree);
      return { exists: () => val != null, val: () => val ?? null };
    };
    return { deps: { db: {}, ref, get }, asked };
  }

  const TREE = {
    [USER_COMMENTS_PATH]: {
      u1: {
        c1: { slug: 'alpha', createdAt: 10 },
        c2: { slug: 'beta', createdAt: 30 },
        c3: { slug: 'alpha', createdAt: 20 },
      },
    },
    comments: {
      alpha: { c1: { text: 'one', authorUid: 'u1', createdAt: 10 }, c3: { text: 'three', authorUid: 'u1', createdAt: 20 }, zz: { text: 'someone else', authorUid: 'u2' } },
      beta: { c2: { text: 'two', authorUid: 'u1', createdAt: 30 } },
      gamma: { q: { text: 'unrelated thread', authorUid: 'u9' } },
    },
  };

  test('never reads the whole comments node', async () => {
    const { deps, asked } = harness(TREE);
    await loadCommentsFor(deps, 'u1');
    assert.ok(!asked.includes('comments'), `read the whole node: ${asked.join(', ')}`);
  });

  test('reads the index once, then only the distinct slugs it names', async () => {
    const { deps, asked } = harness(TREE);
    await loadCommentsFor(deps, 'u1');
    assert.deepEqual(asked.sort(), [
      `${USER_COMMENTS_PATH}/u1`, 'comments/alpha', 'comments/beta',
    ].sort(), 'two comments on `alpha` must cost one read, and `gamma` must never be touched');
  });

  test('returns the reader\'s comments with their text, newest first', async () => {
    const { deps } = harness(TREE);
    const out = await loadCommentsFor(deps, 'u1');
    assert.deepEqual(out.map((c) => c.id), ['c2', 'c3', 'c1']);
    assert.deepEqual(out.map((c) => c.text), ['two', 'three', 'one']);
    assert.equal(out[0].slug, 'beta');
  });

  test('somebody else\'s comment in the same thread is not returned', async () => {
    const { deps } = harness(TREE);
    const out = await loadCommentsFor(deps, 'u1');
    assert.ok(!out.some((c) => c.id === 'zz'));
  });

  test('an orphan index entry is dropped, not rendered blank', async () => {
    const tree = JSON.parse(JSON.stringify(TREE));
    tree[USER_COMMENTS_PATH].u1.ghost = { slug: 'alpha', createdAt: 99 };
    const { deps } = harness(tree);
    const out = await loadCommentsFor(deps, 'u1');
    assert.equal(out.length, 3);
    assert.ok(!out.some((c) => c.id === 'ghost'));
  });

  test('one unreadable thread does not empty the whole list', async () => {
    const { deps, asked } = harness(TREE);
    const inner = deps.get;
    deps.get = async (p) => { if (p === 'comments/alpha') throw new Error('denied'); return inner(p); };
    const out = await loadCommentsFor(deps, 'u1');
    assert.deepEqual(out.map((c) => c.id), ['c2']);
  });

  test('no index → no reads of comments at all', async () => {
    const { deps, asked } = harness(TREE);
    assert.deepEqual(await loadCommentsFor(deps, 'nobody'), []);
    assert.deepEqual(asked, [`${USER_COMMENTS_PATH}/nobody`]);
  });

  test('no uid → no reads at all', async () => {
    const { deps, asked } = harness(TREE);
    assert.deepEqual(await loadCommentsFor(deps, null), []);
    assert.equal(asked.length, 0);
  });

  test('limit bounds the threads fetched, and defaults to unbounded', async () => {
    const { deps, asked } = harness(TREE);
    const out = await loadCommentsFor(deps, 'u1', { limit: 1 });
    assert.deepEqual(out.map((c) => c.id), ['c2']);
    assert.deepEqual(asked.sort(), [`${USER_COMMENTS_PATH}/u1`, 'comments/beta'].sort(),
      'only the newest entry\'s thread should be fetched');

    const b = harness(TREE);
    await loadCommentsFor(b.deps, 'u1');
    assert.equal(b.asked.length, 3, 'default must stay unbounded — truncation is a product decision');
  });
});
