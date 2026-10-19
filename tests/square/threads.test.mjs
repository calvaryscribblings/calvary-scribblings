// W52 — the shape of a thread (app/lib/squareThreads.js), without a browser or a database.
//
//   npm run test:square
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildThread, foldNested, latestReply, replyNotifications, threadHref, postHref,
  squareNotificationHref, removedNote, topAncestorOf, THREAD_COPY, NESTED_SHOWN,
  rootDeleteConfirm, quoteHref, quotablePost,
} from '../../app/lib/squareThreads.js';
import { planSweep, HORIZON_MS } from '../../scripts/square/horizon.mjs';

const R = 'root';
let t = 1000;
const reply = (id, over = {}) => ({ id, parentId: R, authorUid: `u-${id}`, text: id, createdAt: (t += 10), ...over });

describe('buildThread', () => {
  test('top-level replies oldest first; a reply to a reply sits under its top-level ancestor, whatever its depth', () => {
    t = 1000;
    const a = reply('a'), b = reply('b'), a1 = reply('a1', { replyToId: 'a' }), a1x = reply('a1x', { replyToId: 'a1' }), a1xy = reply('a1xy', { replyToId: 'a1x' }), b1 = reply('b1', { replyToId: 'b' });
    const { groups, count } = buildThread([a1xy, b1, a1x, b, a1, a]);
    assert.deepEqual(groups.map((g) => g.top.id), ['a', 'b']);
    assert.deepEqual(groups[0].nested.map((r) => r.id), ['a1', 'a1x', 'a1xy']);
    assert.deepEqual(groups[1].nested.map((r) => r.id), ['b1']);
    assert.equal(count, 6);
  });

  test('a pre-A42 flat reply (no replyToId) is a top-level reply', () => {
    t = 1000;
    const { groups } = buildThread([reply('old1'), reply('old2')]);
    assert.deepEqual(groups.map((g) => [g.top.id, g.nested.length]), [['old1', 0], ['old2', 0]]);
  });

  test('a replyToId naming a reply that no longer exists, or a cycle, ends the walk without losing the reply', () => {
    t = 1000;
    const orphan = reply('o', { replyToId: 'gone' });
    const x = reply('x', { replyToId: 'y' }), y = reply('y', { replyToId: 'x' });
    const byId = new Map([orphan, x, y].map((r) => [r.id, r]));
    assert.equal(topAncestorOf(orphan, byId).id, 'o');
    assert.ok(['x', 'y'].includes(topAncestorOf(x, byId).id));
    const { groups } = buildThread([orphan]);
    assert.equal(groups[0].top.id, 'o');
  });

  test('a tombstone shows only while replies hang beneath it, and does not count', () => {
    t = 1000;
    const lone = reply('lone', { withdrawn: true, removedBy: 'author', text: undefined });
    const held = reply('held', { withdrawn: true, removedBy: 'moderator', text: undefined });
    const child = reply('child', { replyToId: 'held' });
    const top = reply('top');
    const mid = reply('mid', { replyToId: 'top', withdrawn: true, removedBy: 'author' });
    const deep = reply('deep', { replyToId: 'mid' });
    const deadEnd = reply('deadEnd', { replyToId: 'top', withdrawn: true });
    const { groups, count } = buildThread([lone, held, child, top, mid, deep, deadEnd]);
    assert.deepEqual(groups.map((g) => g.top.id), ['held', 'top']);
    assert.deepEqual(groups[1].nested.map((r) => r.id), ['mid', 'deep'], 'a nested tombstone with a reply beneath stays; one without goes');
    assert.equal(count, 3);
  });

  test('a tombstone with only tombstones beneath it is not drawn', () => {
    t = 1000;
    const a = reply('a', { withdrawn: true }), b = reply('b', { replyToId: 'a', withdrawn: true });
    assert.deepEqual(buildThread([a, b]).groups, []);
  });

  test('ruling 30\'s deleted-account tombstone behaves the same', () => {
    t = 1000;
    const d = reply('d', { deleted: true, text: undefined }), k = reply('k', { replyToId: 'd' });
    const { groups, count } = buildThread([d, k]);
    assert.equal(groups[0].top.id, 'd');
    assert.equal(count, 1);
  });
});

describe('the fold', () => {
  const nested = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id) => ({ id }));
  test(`shows ${NESTED_SHOWN}, then "View N more replies"`, () => {
    const { shown, hidden } = foldNested(nested);
    assert.deepEqual(shown.map((r) => r.id), ['n1', 'n2']);
    assert.equal(hidden, 3);
    assert.equal(THREAD_COPY.viewMore(3), 'View 3 more replies');
    assert.equal(THREAD_COPY.viewMore(1), 'View 1 more reply');
  });
  test('two or fewer: no fold', () => {
    assert.equal(foldNested(nested.slice(0, 2)).hidden, 0);
  });
  test('your own reply, just sent, stays visible below the fold', () => {
    const { shown, hidden } = foldNested(nested, { keep: new Set(['n5']) });
    assert.deepEqual(shown.map((r) => r.id), ['n1', 'n2', 'n5']);
    assert.equal(hidden, 2);
  });
  test('expanded shows everything', () => {
    assert.deepEqual(foldNested(nested, { expanded: true }), { shown: nested, hidden: 0 });
  });
});

describe('removed words', () => {
  test('moderator and author say different things; a legacy withdrawn record reads as the author\'s', () => {
    assert.equal(removedNote({ withdrawn: true, removedBy: 'moderator' }), 'This reply was removed.');
    assert.equal(removedNote({ withdrawn: true, removedBy: 'author' }), 'The author withdrew this reply.');
    assert.equal(removedNote({ withdrawn: true }), 'The author withdrew this reply.');
  });
});

describe('latestReply', () => {
  test('the newest living reply; tombstones are skipped', () => {
    t = 1000;
    const a = reply('a'), b = reply('b'), c = reply('c', { withdrawn: true });
    assert.equal(latestReply([c, a, b]).id, 'b');
    assert.equal(latestReply([c]), null);
    assert.equal(latestReply([]), null);
  });
});

describe('who a reply notifies', () => {
  test('the root\'s author: "replied to your post"; the answered reply\'s author: "replied to you"', () => {
    assert.deepEqual(replyNotifications({ me: 'me', rootAuthorUid: 'op', replyToAuthorUid: 'r' }), [
      { uid: 'r', type: 'square_reply_to_you' }, { uid: 'op', type: 'square_reply' },
    ]);
  });
  test('never the same person twice', () => {
    assert.deepEqual(replyNotifications({ me: 'me', rootAuthorUid: 'op', replyToAuthorUid: 'op', mentionedUids: ['op', 'x', 'x'] }), [
      { uid: 'op', type: 'square_reply_to_you' }, { uid: 'x', type: 'mention' },
    ]);
  });
  test('never yourself', () => {
    assert.deepEqual(replyNotifications({ me: 'me', rootAuthorUid: 'me', replyToAuthorUid: 'me', mentionedUids: ['me'] }), []);
    assert.deepEqual(replyNotifications({ me: 'me', rootAuthorUid: 'me' }), []);
  });
  test('a top-level reply tells only the root\'s author', () => {
    assert.deepEqual(replyNotifications({ me: 'me', rootAuthorUid: 'op' }), [{ uid: 'op', type: 'square_reply' }]);
  });
});

describe('links', () => {
  test('the thread, opening at a reply', () => {
    assert.equal(threadHref('-R'), '/square/p?id=-R');
    assert.equal(threadHref('-R', '-x'), '/square/p?id=-R&reply=-x');
    assert.equal(threadHref('-R', '-R'), '/square/p?id=-R');
    assert.equal(postHref({ id: '-R' }), '/square/p?id=-R');
    assert.equal(postHref({ id: '-x', parentId: '-R' }), '/square/p?id=-R&reply=-x');
  });
  test('notifications: Square ones open the thread; story and Open Pages ones are not ours', () => {
    assert.equal(squareNotificationHref({ type: 'square_reply', postId: '-x', threadId: '-R' }), '/square/p?id=-R&reply=-x');
    assert.equal(squareNotificationHref({ type: 'mention', postId: '-x' }), '/square/p?id=-x', 'an older notification: /square/p resolves a reply to its root');
    assert.equal(squareNotificationHref({ type: 'mention', slug: 'a-story', postId: 'c1' }), null);
    assert.equal(squareNotificationHref({ type: 'open_pages_reply', postId: '-P' }), null);
    assert.equal(squareNotificationHref({ type: 'follow' }), null);
  });
  test('no Square link anywhere still points at /square#', () => {
    for (const f of ['app/square/page.js', 'app/profile/page.js', 'app/user/page.js', 'app/square/p/page.js']) {
      assert.doesNotMatch(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'), /\/square#\$\{/, f);
    }
  });
});

describe('the horizon carries replyToId and removedBy untouched', () => {
  test('it moves a thread by its root, nested replies and tombstones with it', () => {
    const now = Date.now();
    const old = now - HORIZON_MS - 3600000;
    const posts = [
      { id: 'R', authorUid: 'a', createdAt: old },
      { id: 'r1', parentId: 'R', authorUid: 'b', createdAt: old + 1 },
      { id: 'r2', parentId: 'R', replyToId: 'r1', authorUid: 'c', createdAt: old + 2 },
      { id: 'r3', parentId: 'R', replyToId: 'r2', withdrawn: true, removedBy: 'moderator', authorUid: 'd', createdAt: old + 3 },
    ];
    const plan = planSweep(posts, now);
    assert.deepEqual(plan.move.map((p) => p.id).sort(), ['R', 'r1', 'r2', 'r3']);
    const r3 = plan.move.find((p) => p.id === 'r3');
    assert.equal(r3.replyToId, 'r2');
    assert.equal(r3.removedBy, 'moderator');
  });
  test('the archive write copies each record whole (no field list to forget a new field)', () => {
    const src = readFileSync(new URL('../../scripts/square/horizon.mjs', import.meta.url), 'utf8');
    assert.match(src, /const \{ id, \.\.\.rec \} = p;\n\s+patch\[`square_archive\/\$\{id\}`\] = \{ \.\.\.rec, archivedAt: now, archivedBy: 'horizon' \};/);
  });
});

describe('W55 · the opening post: removing it, and quoting it from the thread', () => {
  test('ruling 215: a moderator removing someone else\'s post is asked "Remove this post?"', () => {
    assert.equal(rootDeleteConfirm({ mine: false, replies: 0 }), 'Remove this post?');
    assert.equal(rootDeleteConfirm({ mine: false, replies: 3 }), 'Remove this post?\n\nThe 3 replies beneath it will stay.');
    assert.equal(rootDeleteConfirm({ mine: false, replies: 1 }), 'Remove this post?\n\nThe 1 reply beneath it will stay.');
  });
  test('the author\'s wording does not change', () => {
    assert.equal(rootDeleteConfirm({ mine: true, replies: 0 }), "Withdraw this post? It'll be removed from the Square.");
    assert.equal(rootDeleteConfirm({ mine: true, replies: 2 }), "Withdraw this post?\n\nThe 2 replies beneath it will stay — they aren't yours to delete.");
  });
  test('both pages ask through rootDeleteConfirm, and neither keeps its own copy of the words', () => {
    for (const f of ['app/square/page.js', 'app/square/p/page.js']) {
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      assert.match(src, /confirm\(rootDeleteConfirm\(/, f);
      assert.doesNotMatch(src, /Withdraw this post\?/, f);
    }
  });
  test('quoteHref opens the feed with ?quote=; quotablePost takes only an opening post still in the room', () => {
    assert.equal(quoteHref('-Ab c'), '/square?quote=-Ab%20c');
    const posts = [{ id: 'R' }, { id: 'r', parentId: 'R' }, { id: 'W', withdrawn: true }, { id: 'D', deleted: true }];
    assert.equal(quotablePost(posts, 'R')?.id, 'R');
    for (const id of ['r', 'W', 'D', 'gone', null]) assert.equal(quotablePost(posts, id), null, String(id));
  });
});
