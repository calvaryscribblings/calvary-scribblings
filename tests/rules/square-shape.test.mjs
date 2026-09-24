// W1 / SQ-01 — square_posts/$postId: a closed key set, and an attachment that is a POINTER.
//
//   npm run test:rules   (emulator)
//
// Two rules deployed together:
//   · attachedStory may carry only the seven fields slimAttachedStory() writes, and its url must
//     be the house's own /stories/… — so no post can carry a story body again, and no card can
//     link off the island (the no-links ruling).
//   · "$other": false on the post — the key set is closed. The allowed set is the UNION of every
//     key the web writes (square/page.js post/reply/edit/pin/withdraw/quote, openPagesAnnounce)
//     and every key present in live data on 24 Sep (236 records across square_posts,
//     user_square_posts and square_archive — which is where the app's authorPlatformAvatar
//     shows up; the web never writes it). OBSERVED_KEYS below is that census, by name.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv, seed, assertFails, assertSucceeds, DB_RULES_PATH, OWNER, STRANGER, FOUNDER_A } from './helpers.mjs';
import { ATTACHED_STORY_FIELDS, slimAttachedStory } from '../../app/lib/squarePostBody.js';

let env, owner, stranger;
before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const P = 'w1post';
// square/page.js post() — field for field (nulls are stripped by the SDK before the rules).
const post = (over = {}) => ({
  text: 'a real post', authorUid: OWNER, authorName: 'Reader', authorInitials: 'RE',
  authorAvatarUrl: null, authorHandle: '', authorReadCount: 0, isAuthor: false,
  attachedStory: null, parentId: null, likeCount: 0, pinned: false, unpinnedAt: null,
  quotedPostId: null, createdAt: Date.now(), ...over,
});

// A cms_stories record exactly as the picker is handed it — body and all.
const CMS_RECORD = {
  id: 'alive', title: 'Alive', author: 'A. Writer', cover: 'https://firebasestorage.googleapis.com/v0/b/x/o/c.jpg',
  url: '/stories/alive', categoryName: 'Short Story', subcategory: '', category: 'short',
  content: '<p>The whole story.</p>', extractedText: 'The whole story.', epubUrl: 'https://x/e.epub',
  published: true, readerMode: false, quizMeta: { hasQuiz: true },
};

// Every key present on any record in the three Square nodes on 24 Sep 2026, minus the two the
// horizon adds on the way into the archive (archivedAt, archivedBy — never written to square_posts).
const OBSERVED_KEYS = [
  'attachedOpenPage', 'attachedStory', 'authorAvatarUrl', 'authorHandle', 'authorInitials', 'authorName',
  'authorPlatformAvatar', 'authorReadCount', 'authorUid', 'clapCount', 'createdAt', 'edited', 'fireCount',
  'isAuthor', 'likeCount', 'parentId', 'pinned', 'poll', 'quotedPostId', 'text', 'unpinnedAt', 'withdrawn',
  'withdrawnAt',
];

describe('W1 · attachedStory is a pointer', () => {
  test('slimAttachedStory produces exactly the seven fields, from the record the picker holds', () => {
    const slim = slimAttachedStory(CMS_RECORD);
    assert.deepEqual(Object.keys(slim).sort(), [...ATTACHED_STORY_FIELDS].sort());
    assert.equal(slim.url, '/stories/alive');
    assert.equal('content' in slim, false);
    // the pre-CMS static shape named its story by slug — it still gets a link
    assert.equal(slimAttachedStory({ slug: 'purple', title: 'Purple' }).url, '/stories/purple');
    assert.equal(slimAttachedStory({ title: 'no id' }), null);
  });

  test('the web post with a slim attachment → allowed', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(post({ attachedStory: slimAttachedStory(CMS_RECORD) })));
  });

  test('the OLD web shape — the whole record, body and all → REFUSED', async () => {
    await assertFails(owner.ref(`square_posts/${P}`).set(post({ attachedStory: CMS_RECORD })));
  });

  for (const leak of ['content', 'extractedText', 'epubUrl', 'quizMeta', 'slug', 'published']) {
    test(`an attachment carrying ${leak} → REFUSED`, async () => {
      const bad = { ...slimAttachedStory(CMS_RECORD), [leak]: CMS_RECORD[leak] ?? 'x' };
      await assertFails(owner.ref(`square_posts/${P}`).set(post({ attachedStory: bad })));
    });
  }

  test('a card that links off the island → REFUSED (the no-links ruling)', async () => {
    for (const url of ['https://evil.example/stories/alive', 'javascript:alert(1)', '//evil.example', '/open-pages/x']) {
      await assertFails(owner.ref(`square_posts/${P}`).set(post({ attachedStory: { ...slimAttachedStory(CMS_RECORD), url } })));
    }
  });

  test('an attachment with no url or no title → REFUSED; a minimal one → allowed', async () => {
    const { url, ...noUrl } = slimAttachedStory(CMS_RECORD);
    const { title, ...noTitle } = slimAttachedStory(CMS_RECORD);
    await assertFails(owner.ref(`square_posts/${P}a`).set(post({ attachedStory: noUrl })));
    await assertFails(owner.ref(`square_posts/${P}b`).set(post({ attachedStory: noTitle })));
    await assertSucceeds(owner.ref(`square_posts/${P}c`).set(post({ attachedStory: { title: 'Alive', url: '/stories/alive' } })));
  });
});

describe('W1 · the post key set is closed', () => {
  test('every observed key and every web-written key has a rule child — nothing live is orphaned', () => {
    const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8')).rules.square_posts.$postId;
    assert.deepEqual(rules.$other, { '.validate': false });
    const missing = OBSERVED_KEYS.filter((k) => !(k in rules));
    assert.deepEqual(missing, [], `observed keys with no rule child would now be refused: ${missing.join(', ')}`);
  });

  test('an unknown key → REFUSED, including the archive\'s own markers', async () => {
    await assertFails(owner.ref(`square_posts/${P}a`).set(post({ foo: 'bar' })));
    await assertFails(owner.ref(`square_posts/${P}b`).set(post({ archivedAt: 1 })));
    await assertFails(owner.ref(`square_posts/${P}c`).set(post({ images: ['https://x/i.png'] })));
  });

  test('the web reply, quote and poll → allowed', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}r`).set(post({ parentId: 'parent1', attachedStory: null, quotedPostId: null })));
    await assertSucceeds(owner.ref(`square_posts/${P}q`).set(post({ quotedPostId: 'other1' })));
    await assertSucceeds(owner.ref(`square_posts/${P}p`).set(post({ poll: { question: 'Q?', options: ['a', 'b'], closesAt: Date.now() + 1e6 } })));
  });

  test('the app\'s authorPlatformAvatar → allowed', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(post({ authorPlatformAvatar: 'https://x/pa.png', fireCount: 0, clapCount: 0 })));
  });

  test('edit, withdraw, un-quote, reactions and a founder pin on an existing post → allowed', async () => {
    await seed(env, { [`square_posts/${P}`]: post({ quotedPostId: 'q1' }), [`users/${FOUNDER_A}/canPin`]: true });
    await assertSucceeds(owner.ref(`square_posts/${P}`).update({ text: 'edited', edited: true }));
    await assertSucceeds(owner.ref(`square_posts/${P}`).update({ quotedPostId: null }));
    await assertSucceeds(stranger.ref(`square_posts/${P}/likeCount`).set(1));
    const founder = env.authenticatedContext(FOUNDER_A).database();
    await assertSucceeds(founder.ref(`square_posts/${P}`).update({ pinned: true, unpinnedAt: null }));
    await assertSucceeds(owner.ref(`square_posts/${P}`).update({ text: '', withdrawn: true, withdrawnAt: Date.now() }));
  });

  test('an Open Pages card with a stray field → REFUSED; the announcer\'s own shape → allowed', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}a`).set(post({ attachedOpenPage: { id: '-Pabc', title: 'A piece', author: 'W' } })));
    await assertFails(owner.ref(`square_posts/${P}b`).set(post({ attachedOpenPage: { id: '-Pabc', title: 'A piece', body: 'the whole piece' } })));
  });
});
