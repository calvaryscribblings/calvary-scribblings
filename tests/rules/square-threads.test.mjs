// W52 — square_posts gains two optional children: replyToId (the reply being answered) and
// removedBy (who withdrew a record). Both are additive: every write the app makes today, which
// carries neither, must still save. Nothing existing is tightened.
//
//   npm run test:rules   (emulator)

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv, seed, assertFails, assertSucceeds, DB_RULES_PATH, OWNER, STRANGER, OTHER, FOUNDER_A } from './helpers.mjs';

let env, owner, stranger, other;
before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  other = env.authenticatedContext(OTHER).database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const now = () => Date.now();
// square/page.js reply() before W52 — the app's (pre-A42) reply, field for field.
const flatReply = (uid, parentId, over = {}) => ({
  text: 'a reply', authorUid: uid, authorName: 'Reader', authorInitials: 'RE', authorAvatarUrl: null,
  authorHandle: '', authorReadCount: 0, isAuthor: false, parentId, likeCount: 0, pinned: false,
  unpinnedAt: null, createdAt: now(), ...over,
});
const root = (uid, over = {}) => ({ text: 'a root', authorUid: uid, createdAt: now(), ...over });

async function seedThreads() {
  await seed(env, {
    'square_posts/rootA': root(STRANGER),
    'square_posts/rA1': flatReply(STRANGER, 'rootA'),
    'square_posts/rootB': root(OTHER),
    'square_posts/rB1': flatReply(OTHER, 'rootB'),
  });
}

describe('W52 · replyToId', () => {
  test('a pre-A42 flat reply, with no replyToId, still saves', async () => {
    await seedThreads();
    await assertSucceeds(owner.ref('square_posts/n1').set(flatReply(OWNER, 'rootA')));
  });

  test('a reply to a reply in the same thread saves', async () => {
    await seedThreads();
    await assertSucceeds(owner.ref('square_posts/n1').set(flatReply(OWNER, 'rootA', { replyToId: 'rA1' })));
  });

  test('a reply to a reply in ANOTHER thread is refused', async () => {
    await seedThreads();
    await assertFails(owner.ref('square_posts/n1').set(flatReply(OWNER, 'rootA', { replyToId: 'rB1' })));
  });

  test('replyToId naming the root itself is refused', async () => {
    await seedThreads();
    await assertFails(owner.ref('square_posts/n1').set(flatReply(OWNER, 'rootA', { replyToId: 'rootA' })));
  });

  test('replyToId on a root post (no parentId) is refused', async () => {
    await seedThreads();
    await assertFails(owner.ref('square_posts/n1').set(root(OWNER, { replyToId: 'rA1' })));
  });

  test('replyToId naming a record that does not exist is refused', async () => {
    await seedThreads();
    await assertFails(owner.ref('square_posts/n1').set(flatReply(OWNER, 'rootA', { replyToId: 'nope' })));
  });

  test('replyToId naming itself is refused', async () => {
    await seedThreads();
    await assertFails(owner.ref('square_posts/n1').set(flatReply(OWNER, 'rootA', { replyToId: 'n1' })));
  });

  test('editing a nested reply keeps its replyToId, even after the reply it answers was removed', async () => {
    await seedThreads();
    await assertSucceeds(owner.ref('square_posts/n1').set(flatReply(OWNER, 'rootA', { replyToId: 'rA1' })));
    await seed(env, { 'square_posts/rA1': null });
    await assertSucceeds(owner.ref('square_posts/n1').update({ text: 'edited', edited: true }));
    const whole = (await owner.ref('square_posts/n1').get()).val();
    await assertSucceeds(owner.ref('square_posts/n1').set({ ...whole, text: 'again' }));
  });
});

describe('W52 · removedBy and tombstones', () => {
  test('the author withdraws a reply: text dropped, withdrawn + removedBy author', async () => {
    await seedThreads();
    await seed(env, { 'square_posts/mine': flatReply(OWNER, 'rootA') });
    await assertSucceeds(owner.ref('square_posts/mine').update({ text: null, withdrawn: true, withdrawnAt: now(), removedBy: 'author' }));
    const v = (await owner.ref('square_posts/mine').get()).val();
    assert.equal(v.text, undefined);
    assert.equal(v.parentId, 'rootA');
  });

  test('a withdrawn record may drop its attachments too', async () => {
    await seed(env, { 'square_posts/mine': root(OWNER, { attachedStory: { title: 'A', url: '/stories/a' }, quotedPostId: 'q' }) });
    await assertSucceeds(owner.ref('square_posts/mine').update({
      text: null, attachedStory: null, attachedOpenPage: null, quotedPostId: null, withdrawn: true, withdrawnAt: now(), removedBy: 'author',
    }));
  });

  test('a moderator (canRemovePosts) removes someone else\'s reply: removedBy moderator', async () => {
    await seedThreads();
    await seed(env, { [`users/${OTHER}/canRemovePosts`]: true });
    await assertSucceeds(other.ref('square_posts/rA1').update({ text: null, withdrawn: true, withdrawnAt: now(), removedBy: 'moderator' }));
  });

  test('removedBy moderator without canRemovePosts is refused, even on your own reply', async () => {
    await seed(env, { 'square_posts/mine': flatReply(OWNER, 'rootA') });
    await assertFails(owner.ref('square_posts/mine').update({ text: null, withdrawn: true, withdrawnAt: now(), removedBy: 'moderator' }));
  });

  test('removedBy author written by someone who is not the author is refused (a moderator cannot misattribute)', async () => {
    await seedThreads();
    await seed(env, { [`users/${OTHER}/canRemovePosts`]: true });
    await assertFails(other.ref('square_posts/rA1').update({ withdrawn: true, removedBy: 'author' }));
  });

  test('removedBy only alongside withdrawn', async () => {
    await seed(env, { 'square_posts/mine': flatReply(OWNER, 'rootA') });
    await assertFails(owner.ref('square_posts/mine').update({ removedBy: 'author' }));
    await assertFails(owner.ref('square_posts/mine2').set(flatReply(OWNER, 'rootA', { removedBy: 'author' })));
  });

  test('removedBy takes only "author" or "moderator"', async () => {
    await seed(env, { 'square_posts/mine': flatReply(OWNER, 'rootA'), [`users/${OWNER}/canRemovePosts`]: true });
    for (const v of ['admin', 'Author', '', 'system']) {
      await assertFails(owner.ref('square_posts/mine').update({ withdrawn: true, removedBy: v }));
    }
  });

  test('a stranger still cannot withdraw a reader\'s reply', async () => {
    await seedThreads();
    await assertFails(owner.ref('square_posts/rA1').update({ withdrawn: true, removedBy: 'author' }));
    await assertFails(owner.ref('square_posts/rA1').update({ withdrawn: true }));
  });

  test('a founder pin on a tombstoned root still saves (removedBy is not re-judged when unchanged)', async () => {
    await seed(env, {
      'square_posts/t': root(STRANGER, { text: '', withdrawn: true, withdrawnAt: 1, removedBy: 'author' }),
      [`users/${FOUNDER_A}/canPin`]: true,
    });
    const founder = env.authenticatedContext(FOUNDER_A).database();
    await assertSucceeds(founder.ref('square_posts/t').update({ pinned: true, unpinnedAt: null }));
  });

  test('the legacy withdraw (no removedBy) still saves', async () => {
    await seed(env, { 'square_posts/mine': root(OWNER) });
    await assertSucceeds(owner.ref('square_posts/mine').update({ text: '', withdrawn: true, withdrawnAt: now() }));
  });
});

describe('W52 · the rules file', () => {
  test('both children exist and $other stays closed', () => {
    const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8')).rules.square_posts.$postId;
    assert.ok(rules.replyToId?.['.validate']);
    assert.ok(rules.removedBy?.['.validate']);
    assert.deepEqual(rules.$other, { '.validate': false });
  });
});
