// W5 · the report queue's pure half — app/lib/contentReports.js. The rules half is
// tests/rules/content-reports.test.mjs, which builds its records with the same functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport, contentKeyFor, snapshotOf, contextHrefFor, queueRows, SNAPSHOT_MAX,
} from '../../app/lib/contentReports.js';

test('contentKey: the three shapes the app specified', () => {
  assert.equal(contentKeyFor('comment', { storySlug: 'a-daub-of-blue', commentId: '-Oabc' }), 'comment_a-daub-of-blue_-Oabc');
  assert.equal(contentKeyFor('dm', { convId: 'A_B' }), 'dm_A_B');
  assert.equal(contentKeyFor('user', { uid: 'U1' }), 'user_U1');
  assert.throws(() => contentKeyFor('post', {}));
});

test('snapshot: a verbatim prefix of at most 200, never half a surrogate pair', () => {
  assert.equal(snapshotOf('  hello  '), '  hello  ');
  assert.equal(snapshotOf(null), '');
  const long = 'a'.repeat(250);
  assert.equal(snapshotOf(long).length, SNAPSHOT_MAX);
  assert.ok(long.startsWith(snapshotOf(long)));
  const emojiAtCut = 'a'.repeat(199) + '😀' + 'b';
  const s = snapshotOf(emojiAtCut);
  assert.equal(s, 'a'.repeat(199));
  assert.ok(emojiAtCut.startsWith(s));
});

test('buildReport: the rules shape, note only when written', () => {
  const r = buildReport({ kind: 'dm', reason: 'harassment', reporterUid: 'A', offenderUid: 'B', contextPath: 'dm_messages/A_B/m1', text: 'hi', now: 5 });
  assert.deepEqual(r, { kind: 'dm', reason: 'harassment', reporterUid: 'A', offenderUid: 'B', contextPath: 'dm_messages/A_B/m1', snapshot: 'hi', createdAt: 5 });
  const n = buildReport({ kind: 'user', reason: 'x', reporterUid: 'A', offenderUid: 'B', contextPath: 'users/B', text: '', note: '  why  ', now: 1 });
  assert.equal(n.note, 'why');
  assert.equal(buildReport({ kind: 'user', reason: 'r'.repeat(60), reporterUid: 'A', offenderUid: 'B', contextPath: 'users/B', now: 1 }).reason.length, 40);
});

test('RULED: a DM report has no link to its context — the moderator sees one message', () => {
  assert.equal(contextHrefFor({ kind: 'dm', contextPath: 'dm_messages/A_B/m1', offenderUid: 'B' }), null);
  assert.equal(contextHrefFor({ kind: 'comment', contextPath: 'comments/a-daub-of-blue/-Oabc' }), '/stories/a-daub-of-blue');
  assert.equal(contextHrefFor({ kind: 'user', offenderUid: 'B' }), '/user?id=B');
});

test('queueRows: newest first, filter by kind, resolution fields are not reports, unknown fields dropped', () => {
  const tree = {
    comment_s_c1: { R1: { kind: 'comment', reason: 'spam', offenderUid: 'X', snapshot: 's', createdAt: 10 }, resolved: true, resolvedBy: 'M', resolvedAt: 11 },
    dm_A_B: { A: { kind: 'dm', reason: 'abuse', offenderUid: 'B', snapshot: 'one message', createdAt: 30, thread: ['smuggled'] } },
    user_U: { R2: { kind: 'user', reason: 'fake', offenderUid: 'U', createdAt: 20 } },
  };
  const all = queueRows(tree);
  assert.deepEqual(all.map((r) => r.contentKey), ['dm_A_B', 'user_U', 'comment_s_c1']);
  assert.equal(all[2].resolved, true);
  assert.equal(all[2].reports.length, 1);
  assert.equal(all[0].reports[0].thread, undefined);
  assert.deepEqual(queueRows(tree, 'dm').map((r) => r.contentKey), ['dm_A_B']);
  assert.deepEqual(queueRows({}), []);
});
