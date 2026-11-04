// NOTIF-B2 — the app's two old bells keep everything the web used to write them, now written by the
// server (POST /api/notify → functions/api/_notify.js THE APP'S TWO OLD BELLS), run unmodified
// against the RTDB emulator under Cloudflare's limits (50 subrequests, 6 connections).
//
//   npm run test:notify:emulator
//
//   · each web event writes the old note in the shape the web wrote, with the sender's LIVE fields,
//     to the node the app's bell reads, carrying `nid` (its inbox twin);
//   · blocked and muted readers get neither the inbox record nor the old note;
//   · ruling 320: nobody gets the followers' "posted" note;
//   · a repeat writes nothing twice; a second reaction by the same reader is its own old note;
//   · the worst case still fits the 45.
//
// Invented readers only. Nothing reaches production.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, installLimits, loadRules, wipe, get, set, request, context, tokenFor } from '../proofs/harness.mjs';
import { handleNotify } from '../../functions/api/notify.js';
import { SUBREQUEST_BUDGET } from '../../functions/api/_budget.js';
import { buildList } from '../../app/lib/bell.js';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const SLUG = 'invented-story';
const U = Object.fromEntries(['writer', 'ada', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kit']
  .map((n) => [n, `${n}${'0'.repeat(20 - n.length)}uid`]));
const id = (n) => `-Ninvented${String(n).padStart(10, '0')}`;
let L;

before(async () => { install(); L = installLimits({ limit: 50, connections: 6 }); await loadRules(); });
after(() => { L.uninstall(); uninstall(); });
beforeEach(async () => {
  await wipe();
  for (const [name, uid] of Object.entries(U)) {
    await set(`users/${uid}`, { displayName: `Name-${name}`, username: name, avatarUrl: `https://img.test/${name}.jpg` });
    await set(`usernames/${name}`, uid);
  }
  await set(`cms_stories_index/${SLUG}`, { title: 'An Invented Story', authorUid: U.writer, published: true });
});

async function call(as, event, subjectId) {
  L.begin();
  const stats = {};
  const { ctx } = context(request('/api/notify', { body: { event, subjectId }, token: tokenFor(as) }));
  const res = await handleNotify(ctx, { now: NOW, stats });
  L.end();
  const used = L.calls.at(-1);
  assert.ok(used <= SUBREQUEST_BUDGET, `a call made ${used} subrequests (budget ${SUBREQUEST_BUDGET})`);
  assert.equal(L.refused, 0);
  return { status: res.status, stats: { ...stats, shim: used } };
}
const lib = async (uid) => Object.values((await get(`library_notifications/${uid}`)) || {});
const sq = async (uid) => Object.values((await get(`notifications/${uid}`)) || {});
const inbox = async (uid) => (await get(`inbox/${uid}`)) || {};
const comment = (cid, author, text, parentId = null) => set(`comments/${SLUG}/${cid}`, { text, authorUid: author, authorName: 'stored-name', createdAt: NOW, ...(parentId ? { parentId } : {}) });
const post = (pid, author, extra = {}) => set(`square_posts/${pid}`, { text: 'a post', authorUid: author, createdAt: NOW, ...extra });
const FROM = (n) => ({ fromUid: U[n], fromName: `Name-${n}`, fromHandle: n, fromAvatarUrl: `https://img.test/${n}.jpg` });

describe('the old notes, in the shapes the web wrote', () => {
  test('a reply on a story: the parent author gets `reply` (the parent quoted), the mentioned get `mention`', async () => {
    await comment(id(1), U.ben, 'the first response');
    await comment(id(2), U.ada, 'answering, and @cal should see this', id(1));
    await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    const [b] = await lib(U.ben);
    assert.deepEqual(b, { type: 'reply', ...FROM('ada'), slug: SLUG, commentId: id(1), commentText: 'the first response', storyTitle: 'An Invented Story', read: false, createdAt: NOW, nid: `reply:${SLUG}:${id(2)}` });
    const [c] = await lib(U.cal);
    assert.equal(c.type, 'mention');
    assert.equal(c.commentText, 'answering, and @cal should see this');
    assert.equal(c.nid, `mention:${SLUG}:${id(2)}`);
    assert.deepEqual(await lib(U.writer), [], 'responses on your story never had an old note');
    assert.equal(Object.keys(await inbox(U.writer)).length, 1, '…but the new list has them');
  });

  test('the sender fields are the LIVE profile, never what the comment stored', async () => {
    await set(`users/${U.ada}/displayName`, 'Ada Renamed');
    await comment(id(1), U.ben, 'first');
    await comment(id(2), U.ada, 'hi', id(1));
    await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    assert.equal((await lib(U.ben))[0].fromName, 'Ada Renamed');
  });

  test('a reaction on a response: one old note per reaction, as the web wrote; the group counts the reader once', async () => {
    await comment(id(1), U.ben, 'a response worth a heart');
    for (const t of ['heart', 'fire']) {
      await set(`comment_reactions/${SLUG}/${U.ada}/${id(1)}/${t}`, true);
      await call(U.ada, 'comment_reaction', `${SLUG}/${id(1)}/${t}`);
    }
    const notes = await lib(U.ben);
    assert.deepEqual(notes.map((n) => n.type).sort(), ['fire', 'heart']);
    assert.deepEqual(notes[0].commentText, 'a response worth a heart');
    const group = Object.values(await inbox(U.ben))[0];
    assert.equal(group.actorCount, 1);
    assert.equal(group.count, 1);
  });

  test('a follow: `follow` in the Home bell', async () => {
    await set(`followers/${U.ben}/${U.ada}`, true);
    await call(U.ada, 'follow', U.ben);
    assert.deepEqual(await lib(U.ben), [{ type: 'follow', ...FROM('ada'), read: false, createdAt: NOW, nid: `follow:${U.ada}` }]);
  });

  test('a Square reply: square_reply_to_you, square_reply and mention, with the thread', async () => {
    await post(id(1), U.ben);
    await post(id(2), U.cal, { parentId: id(1) });
    await post(id(3), U.ada, { parentId: id(1), replyToId: id(2), text: 'agreed @dee' });
    await call(U.ada, 'square_post', id(3));
    const sqFrom = { ...FROM('ada'), fromUsername: 'ada' };
    assert.deepEqual(await sq(U.cal), [{ type: 'square_reply_to_you', ...sqFrom, postId: id(3), threadId: id(1), read: false, createdAt: NOW, nid: `reply:sq:${id(3)}` }]);
    assert.equal((await sq(U.ben))[0].type, 'square_reply');
    assert.equal((await sq(U.dee))[0].type, 'mention');
    assert.equal((await sq(U.dee))[0].threadId, id(1));
  });

  test('a Square post: the quoted author and the mentioned; RULING 320 — no follower gets `square_post`', async () => {
    for (const f of ['eve', 'fay', 'gus']) await set(`followers/${U.ada}/${U[f]}`, true);
    await post(id(1), U.ben);
    await post(id(2), U.ada, { quotedPostId: id(1), text: 'look @cal' });
    await call(U.ada, 'square_post', id(2));
    assert.deepEqual((await sq(U.ben)).map((n) => [n.type, n.quotedPostId]), [['square_quote', id(1)]]);
    assert.equal((await sq(U.cal))[0].type, 'mention');
    for (const f of ['eve', 'fay', 'gus']) {
      assert.deepEqual(await sq(U[f]), [], 'no follower fan-out');
      assert.deepEqual(await inbox(U[f]), {});
    }
  });

  test('a Square reaction, in the feed and in a thread', async () => {
    await post(id(1), U.ben);
    await post(id(2), U.ben, { parentId: id(1) });
    await set(`square_reactions/${id(1)}/like/${U.ada}`, true);
    await set(`square_reactions/${id(2)}/fire/${U.ada}`, true);
    await call(U.ada, 'square_reaction', `${id(1)}/like`);
    await call(U.ada, 'square_reaction', `${id(2)}/fire`);
    const notes = (await sq(U.ben)).sort((a, b) => a.type.localeCompare(b.type));
    assert.deepEqual(notes.map((n) => [n.type, n.postId, n.threadId]), [['fire', id(2), id(1)], ['like', id(1), undefined]]);
  });

  test('an Open Pages reply: `open_pages_reply` with the piece', async () => {
    await set(`comments/piece1/${id(1)}`, { text: 'a comment', authorUid: U.ben, createdAt: NOW });
    await set(`comments/piece1/${id(1)}/replies/${id(2)}`, { text: 'a reply', authorUid: U.ada, createdAt: NOW });
    await call(U.ada, 'open_pages_reply', `piece1/${id(1)}/replies/${id(2)}`);
    const [n] = await sq(U.ben);
    assert.equal(n.type, 'open_pages_reply');
    assert.equal(n.postId, 'piece1');
  });

  test('a message: the new list only (there was never an old note for one)', async () => {
    const conv = [U.ada, U.ben].sort().join('_');
    await set(`dm_messages/${conv}/${id(1)}`, { text: 'hi', senderUid: U.ada, createdAt: NOW });
    await call(U.ada, 'message', `${conv}/${id(1)}`);
    assert.deepEqual([...(await lib(U.ben)), ...(await sq(U.ben))], []);
    assert.equal(Object.values(await inbox(U.ben))[0].kind, 'message');
  });
});

describe('silence, repeats and the budget', () => {
  test('blocked either way and muted: neither the inbox record nor the old note', async () => {
    await comment(id(1), U.ben, 'Ben');
    await comment(id(2), U.cal, 'Cal');
    await comment(id(3), U.dee, 'Dee');
    await set(`blocked_users/${U.ben}/${U.ada}`, true);   // Ben blocked Ada
    await set(`blocked_users/${U.ada}/${U.cal}`, true);   // Ada blocked Cal
    await set(`muted_users/${U.dee}/${U.ada}`, true);     // Dee muted Ada
    for (const [n, parent] of [[4, 1], [5, 2], [6, 3]]) {
      await comment(id(n), U.ada, 'a reply', id(parent));
      await call(U.ada, 'comment', `${SLUG}/${id(n)}`);
    }
    for (const u of [U.ben, U.cal, U.dee]) {
      assert.deepEqual(await lib(u), [], 'no old note');
      assert.deepEqual(await inbox(u), {}, 'no inbox record');
    }
  });

  test('the same event twice writes nothing twice, in either list', async () => {
    await comment(id(1), U.ben, 'first');
    await comment(id(2), U.ada, 'a reply', id(1));
    await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    assert.equal((await lib(U.ben)).length, 1);
    assert.equal(Object.keys(await inbox(U.ben)).length, 1);
  });

  test('THE ONE LIST: the web bell shows each event once, though it is in both the inbox and the old node', async () => {
    await comment(id(1), U.ben, 'first');
    await comment(id(2), U.ada, 'a reply', id(1));
    await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    const list = buildList({ inbox: await get(`inbox/${U.ben}`), library: await get(`library_notifications/${U.ben}`), square: {}, announcements: {} });
    assert.deepEqual(list.map((r) => [r.source, r.kind]), [['inbox', 'reply']]);
  });

  test('the worst case, with every old note: a story reply naming 8 readers (6 told), parent and writer', async () => {
    const H = ['cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo'];
    await comment(id(1), U.ben, 'first');
    await comment(id(2), U.ada, H.map((h) => `@${h}`).join(' '), id(1));
    const r = await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    console.log(`  story reply, 6 mentions + parent + writer, with old notes: ${r.stats.shim} subrequests (budget ${SUBREQUEST_BUDGET})`);
    assert.equal(r.stats.mirrored, 7);
    assert.equal((await lib(U.ivy)).length + (await lib(U.jo)).length, 0, 'past the cap of 6');
  });
});
