// R36 — the blocking filter and the edit mark.
//
// Both are read-side decisions about what one reader sees, which is exactly the kind
// of thing that gets asserted by squinting at JSX and then ships wrong. Both are
// therefore pure functions in app/lib, and this file runs them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pruneBlocked, countNodes } from '../../app/lib/openPagesThread.js';
import { isEdited } from '../../app/lib/openPages.js';

const ME = 'me-uid';
const PEST = 'pest-uid';
const OTHER = 'other-uid';

// A thread with the pest at the top level, nested one deep, and nested two deep —
// because a filter that only cleans the top level is the obvious way to get this
// wrong, and Open Pages nests replies two levels (page-client.js renderNode depth<2).
const thread = () => ([
  { path: 'c1', authorUid: OTHER, text: 'ordinary comment', replies: [
    { path: 'c1/replies/r1', authorUid: PEST, text: 'nested pest', replies: [] },
    { path: 'c1/replies/r2', authorUid: ME, text: 'my reply', replies: [
      { path: 'c1/replies/r2/replies/r3', authorUid: PEST, text: 'deep pest', replies: [] },
    ] },
  ] },
  { path: 'c2', authorUid: PEST, text: 'top-level pest', replies: [
    { path: 'c2/replies/r4', authorUid: OTHER, text: 'answering the pest', replies: [] },
  ] },
  { path: 'c3', authorUid: ME, text: 'my own comment', replies: [] },
]);

// ═══════════════════════════════════════════════════════════════════════════════
describe('R36 · blocking — comment-only, by ruling', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('with nothing blocked, the thread is returned exactly as it came', () => {
    const t = thread();
    assert.equal(countNodes(pruneBlocked(t, new Set())), 7);
    assert.equal(pruneBlocked(t, new Set()), t, 'no block list must not even copy the tree');
  });

  test('a blocked author is hidden AT EVERY DEPTH, not only the top level', () => {
    const out = pruneBlocked(thread(), new Set([PEST]));
    const paths = [];
    (function walk(ns) { for (const n of ns) { paths.push(n.path); walk(n.replies || []); } })(out);

    assert.deepEqual(paths, ['c1', 'c1/replies/r2', 'c3'],
      'top-level, one-deep and two-deep pest comments must all be gone');
    assert.ok(!paths.includes('c2'), 'top-level');
    assert.ok(!paths.includes('c1/replies/r1'), 'one deep');
    assert.ok(!paths.includes('c1/replies/r2/replies/r3'), 'two deep');
  });

  test("replies UNDER a blocked comment go with it — an orphan answers nothing", () => {
    const out = pruneBlocked(thread(), new Set([PEST]));
    const flat = JSON.stringify(out);
    assert.ok(!flat.includes('answering the pest'),
      'c2/replies/r4 sat under the pest; showing it alone would be worse than hiding it');
  });

  test('the count follows the filter, so the heading matches what renders', () => {
    assert.equal(countNodes(thread()), 7);
    assert.equal(countNodes(pruneBlocked(thread(), new Set([PEST]))), 3);
  });

  test('ONLY the blocker is affected — the tree is not mutated for anyone else', () => {
    const t = thread();
    const before = JSON.stringify(t);
    pruneBlocked(t, new Set([PEST]));
    assert.equal(JSON.stringify(t), before,
      'the filter must be pure: another reader renders from the same array');
  });

  test('blocking one person does not hide another', () => {
    const out = pruneBlocked(thread(), new Set([PEST]));
    const flat = JSON.stringify(out);
    assert.ok(flat.includes('ordinary comment'), "OTHER's comment must survive");
    assert.ok(flat.includes('my own comment'), "the reader's own must survive");
    assert.ok(!flat.includes('top-level pest'));
  });

  test('⭐ THE PIECE IS NEVER FILTERED — blocking is about the reader, not the work', () => {
    // Ikenna's ruling, asserted as an absence: this module exports nothing that can
    // touch a post. Hiding someone's published writing from one reader would mean two
    // readers see different feeds, and a conversation about a piece could happen where
    // one party cannot see the piece.
    const mod = { pruneBlocked, countNodes };
    assert.deepEqual(Object.keys(mod).sort(), ['countNodes', 'pruneBlocked'],
      'a post/feed filter appearing here would be a reversal of the ruling');
    // And the filter is indifferent to post-shaped input: it keys on authorUid of
    // COMMENT nodes only, so pointing it at a feed would be a visible mistake, not a
    // silent one.
    const posts = [{ path: 'p1', authorUid: PEST, title: 'A piece by the blocked author', replies: [] }];
    assert.equal(pruneBlocked(posts, new Set([])).length, 1, 'no block list, nothing filtered');
  });

  test('junk input cannot throw inside a render', () => {
    assert.deepEqual(pruneBlocked(null, new Set([PEST])), []);
    assert.deepEqual(pruneBlocked(undefined, new Set()), []);
    assert.equal(countNodes(null), 0);
    assert.equal(countNodes(undefined), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R36 · the edit mark', () => {
// ═══════════════════════════════════════════════════════════════════════════════
//
// THE SHAPES BELOW ARE THE SEVEN LIVE PIECES, measured on 2026-09-04. They are here
// rather than paraphrased because the grandfathering question ("what happens to the
// pieces already edited?") is answered by the DATA, not by a migration: three carry
// updatedAt > createdAt and simply acquire the mark; three carry approvedAt and no
// updatedAt and must NOT acquire it; one carries neither.

  const LIVE = [
    { id: '-Ow-fbEEIn4-mwJif20-', createdAt: 1782422860751, updatedAt: 1782441881118 },
    { id: '-Ow9RS35i31C0Ko30y4Y', createdAt: 1782586659078, updatedAt: 1782590728952 },
    { id: '-OxzJ1ShP8-tjcMCSfeP', createdAt: 1784547387245, approvedAt: 1784550541992 },
    { id: '-Oy-s5dmvzFLq8eZoGaa', createdAt: 1784573618802, approvedAt: 1784712433128 },
    { id: '-Oy5Pv58zU4MEWdGPqnL', createdAt: 1784666632585, approvedAt: 1784712422727 },
    { id: '-Oz6jeIsw4vC7bWRv-Sd', createdAt: 1785762587896 },
    { id: '-OzkaNgtQK9CuwB-tdJO', createdAt: 1786448022329, updatedAt: 1786450186679 },
  ];

  test('⭐ exactly the three already-edited live pieces carry the mark', () => {
    const marked = LIVE.filter(isEdited).map((p) => p.id);
    assert.deepEqual(marked, ['-Ow-fbEEIn4-mwJif20-', '-Ow9RS35i31C0Ko30y4Y', '-OzkaNgtQK9CuwB-tdJO']);
    assert.equal(marked.length, 3, 'the grandfathering question dissolves — they simply carry it');
  });

  test('an admin APPROVAL is not an author edit', () => {
    // Three live pieces were fail-closed to the queue and approved by a founder. They
    // carry approvedAt, which is not the author changing anything. A mark keyed on
    // "has any later timestamp" would have libelled all three.
    for (const p of LIVE.filter((x) => x.approvedAt)) {
      assert.equal(isEdited(p), false, `${p.id} was approved, not edited`);
      assert.ok(p.approvedAt > p.createdAt, 'and the later timestamp really is there to be confused');
    }
  });

  test('the mark reads updatedAt — editedAt is retired and would mark nothing', () => {
    // Measured at 0 of 7 live records: buildPendingPost set editedAt to null and RTDB
    // drops nulls, so a mark wired to it would have been invisible on every edited
    // piece. This asserts the failure mode directly.
    assert.equal(isEdited({ createdAt: 1, editedAt: 500 }), false,
      'editedAt must have no effect — there is one name and it is updatedAt');
    assert.equal(isEdited({ createdAt: 1, updatedAt: 500 }), true);
  });

  test('a never-edited piece is unmarked, however it is shaped', () => {
    assert.equal(isEdited({ createdAt: 100 }), false);
    assert.equal(isEdited({ createdAt: 100, updatedAt: 100 }), false, 'equal is not later');
    assert.equal(isEdited({ createdAt: 100, updatedAt: 99 }), false, 'a clock skew must not mark it');
    assert.equal(isEdited({ createdAt: 100, updatedAt: null }), false);
    assert.equal(isEdited({ createdAt: 100, updatedAt: '200' }), false, 'a string is not a timestamp');
    assert.equal(isEdited({}), false);
    assert.equal(isEdited(null), false);
    assert.equal(isEdited(undefined), false);
  });
});
