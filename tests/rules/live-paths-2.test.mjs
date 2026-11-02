// LIVE-PATHS-2 — the holes LIVE-PATHS-1's sweep left open, against the emulator, both ways round.
//
//   npm run test:rules
//
// RED ON MAIN: LP2_RULES=<a rules file> loads that file instead of the repo's, so the same cases
// can be run against origin/main's rules (dc568418). The cases marked [hole] fail there.
//
// Each describe holds what a reader must still be able to do (the web's own writes, field for
// field) next to what must now be refused. The app's writes can't be read from this repo; the
// report lists the ones its session must confirm.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { DB_RULES_PATH, DB_PORT, FOUNDER_A, OWNER, STRANGER, OTHER, seed } from './helpers.mjs';
import { approvePending, rejectPending, ApprovalRefused } from '../../app/lib/openPagesApprove.js';
import { quizApprovalMetaPaths } from '../../app/lib/quizApproval.js';

const RULES = readFileSync(process.env.LP2_RULES || DB_RULES_PATH, 'utf8');

let env, owner, stranger, other, founder;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-calvary-rules',
    database: { rules: RULES, host: '127.0.0.1', port: DB_PORT },
  });
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  other = env.authenticatedContext(OTHER).database();
  founder = env.authenticatedContext(FOUNDER_A).database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const read = async (path) => {
  let v;
  await env.withSecurityRulesDisabled(async (ctx) => { v = (await ctx.database().ref(path).get()).val(); });
  return v;
};

// The compat database rules-unit-testing hands out, behind the modular names the lib takes.
const fbFor = () => ({
  ref: (db, p) => (p === undefined ? db.ref() : db.ref(p)),
  runTransaction: (r, fn, opts = {}) => r.transaction(fn, undefined, opts.applyLocally !== false),
  update: (r, v) => r.update(v),
});

// ── Open Pages ──────────────────────────────────────────────────────────────────────────────────
const VICTIM_KEY = '-Nlp2VictimPiece0001';
const FRESH_KEY = '-Nlp2FreshPending001';
const live = (over = {}) => ({
  authorUid: STRANGER, authorName: 'Victim Writer', title: 'A live piece', body: 'The live body.',
  genre: 'Poetry', status: 'live', createdAt: 1761000000000, readCount: 40,
  moderation: { decision: 'pass', checkedAt: 1761000000000 }, ...over,
});
// The pending record as moderate.js builds it, minus what only the server sets.
const pending = (over = {}) => ({
  authorUid: OWNER, authorName: 'Reader', title: 'Mine', body: 'My body.', genre: 'Poetry',
  status: 'flagged', createdAt: 1762000000000, moderation: { decision: 'flag', checkedAt: 1762000000000 }, ...over,
});

describe('LIVE-PATHS-2 #1 · open_pages_pending: a reader cannot hold a key that is live', () => {
  test('[hole] a reader cannot file a pending record at another author\'s live key', async () => {
    await seed(env, { [`open_pages/${VICTIM_KEY}`]: live() });
    await assertFails(owner.ref(`open_pages_pending/${VICTIM_KEY}`).set(pending()));
  });
  test('[hole] nor at their OWN live key (revisions are filed by the server only)', async () => {
    await seed(env, { [`open_pages/${VICTIM_KEY}`]: live({ authorUid: OWNER }) });
    await assertFails(owner.ref(`open_pages_pending/${VICTIM_KEY}`).set(pending()));
  });
  test('still allowed: a fresh push key, rewriting and deleting their own pending record', async () => {
    const key = owner.ref('open_pages_pending').push().key;
    await assertSucceeds(owner.ref(`open_pages_pending/${key}`).set(pending()));
    await assertSucceeds(owner.ref(`open_pages_pending/${key}/body`).set('Second draft.'));
    await assertFails(stranger.ref(`open_pages_pending/${key}`).remove());
    await assertSucceeds(owner.ref(`open_pages_pending/${key}`).remove());
  });
  test('[hole] the author cannot rewrite a server-filed revision after the screen flagged it; deleting it stays allowed', async () => {
    await seed(env, {
      [`open_pages/${VICTIM_KEY}`]: live({ authorUid: OWNER }),
      [`open_pages_pending/${VICTIM_KEY}`]: pending({ revision: true }),
    });
    await assertFails(owner.ref(`open_pages_pending/${VICTIM_KEY}/body`).set('rewritten after the flag'));
    await assertSucceeds(owner.ref(`open_pages_pending/${VICTIM_KEY}`).remove());
  });
  test('founders keep their grant on the queue', async () => {
    await seed(env, { [`open_pages/${VICTIM_KEY}`]: live(), [`open_pages_pending/${VICTIM_KEY}`]: pending() });
    await assertSucceeds(founder.ref(`open_pages_pending/${VICTIM_KEY}`).remove());
  });
});

describe('LIVE-PATHS-2 #1 · the admin queue: Approve and Remove on a pending record keyed at a live piece', () => {
  // A pending record keyed at a live piece can exist whatever the rules say now: filed before them,
  // or by the server. So the queue itself must refuse, not only the rules.
  test('Approve refuses another author\'s live key, and nothing changes', async () => {
    await seed(env, { [`open_pages/${VICTIM_KEY}`]: live(), [`open_pages_pending/${VICTIM_KEY}`]: pending() });
    await assert.rejects(
      approvePending({ db: founder, fb: fbFor(), id: VICTIM_KEY, pending: pending(), approverUid: FOUNDER_A }),
      (e) => e instanceof ApprovalRefused && /Another author/.test(e.message));
    assert.deepEqual(await read(`open_pages/${VICTIM_KEY}`), live());
    assert.ok(await read(`open_pages_pending/${VICTIM_KEY}`), 'the pending record is left for a human');
    assert.equal(await read(`user_open_pages/${OWNER}/${VICTIM_KEY}`), null);
  });
  test('Approve refuses a non-revision record over the same author\'s live piece', async () => {
    await seed(env, { [`open_pages/${VICTIM_KEY}`]: live({ authorUid: OWNER }), [`open_pages_pending/${VICTIM_KEY}`]: pending() });
    await assert.rejects(approvePending({ db: founder, fb: fbFor(), id: VICTIM_KEY, pending: pending(), approverUid: FOUNDER_A }), ApprovalRefused);
    assert.deepEqual(await read(`open_pages/${VICTIM_KEY}`), live({ authorUid: OWNER }));
  });
  test('Approve refuses a revision whose live piece is gone (it would bring a removed piece back)', async () => {
    await seed(env, { [`open_pages_pending/${VICTIM_KEY}`]: pending({ revision: true }) });
    await assert.rejects(approvePending({ db: founder, fb: fbFor(), id: VICTIM_KEY, pending: pending({ revision: true }), approverUid: FOUNDER_A }), /no longer live/);
    assert.equal(await read(`open_pages/${VICTIM_KEY}`), null);
  });
  test('Approve publishes a new piece: live, mirrored, out of the queue', async () => {
    await seed(env, { [`open_pages_pending/${FRESH_KEY}`]: pending({ id: 'a-stored-id-never-wins' }) });
    const r = await approvePending({ db: founder, fb: fbFor(), id: FRESH_KEY, pending: pending({ id: 'a-stored-id-never-wins' }), approverUid: FOUNDER_A, now: 1762100000000 });
    assert.equal(r.wasRevision, false);
    const got = await read(`open_pages/${FRESH_KEY}`);
    assert.equal(got.status, 'live');
    assert.equal(got.authorUid, OWNER);
    assert.equal(got.approvedBy, FOUNDER_A);
    assert.equal(got.id, undefined);
    assert.deepEqual(await read(`user_open_pages/${OWNER}/${FRESH_KEY}`), got);
    assert.equal(await read(`open_pages_pending/${FRESH_KEY}`), null);
  });
  test('Approve publishes the same author\'s revision over their piece, keeping the live read count', async () => {
    await seed(env, {
      [`open_pages/${VICTIM_KEY}`]: live({ authorUid: OWNER, readCount: 57 }),
      [`open_pages_pending/${VICTIM_KEY}`]: pending({ revision: true, readCount: 40, body: 'The revised body.' }),
    });
    const p = pending({ revision: true, readCount: 40, body: 'The revised body.' });
    const r = await approvePending({ db: founder, fb: fbFor(), id: VICTIM_KEY, pending: p, approverUid: FOUNDER_A });
    assert.equal(r.wasRevision, true);
    const got = await read(`open_pages/${VICTIM_KEY}`);
    assert.equal(got.body, 'The revised body.');
    assert.equal(got.readCount, 57);
    assert.equal(got.revision, undefined);
  });
  test('[hole] Remove on a flagged item removes the pending record and never the live piece', async () => {
    await seed(env, {
      [`open_pages/${VICTIM_KEY}`]: live(),
      [`open_pages_pending/${VICTIM_KEY}`]: pending(),
      [`open_pages_reports/${VICTIM_KEY}/${OTHER}`]: { reason: 'spam', reporterUid: OTHER, createdAt: 1 },
    });
    await rejectPending({ db: founder, fb: fbFor(), id: VICTIM_KEY });
    assert.deepEqual(await read(`open_pages/${VICTIM_KEY}`), live());
    assert.ok(await read(`open_pages_reports/${VICTIM_KEY}`), 'reports on the live piece stay');
    assert.equal(await read(`open_pages_pending/${VICTIM_KEY}`), null);
  });
  test('control: main\'s Approve over ANOTHER author\'s piece was already refused by open_pages/$postId .validate', async () => {
    await seed(env, { [`open_pages/${VICTIM_KEY}`]: live(), [`open_pages_pending/${VICTIM_KEY}`]: pending() });
    // dc568418 app/admin/forum/page.jsx approve(item), the update it sent.
    const { revision, ...rec } = pending();
    await assertFails(founder.ref().update({
      [`open_pages/${VICTIM_KEY}`]: { ...rec, status: 'live', approvedBy: FOUNDER_A, approvedAt: 1 },
      [`open_pages_pending/${VICTIM_KEY}`]: null, [`open_pages_reports/${VICTIM_KEY}`]: null,
      [`user_open_pages/${OWNER}/${VICTIM_KEY}`]: { ...rec, status: 'live' },
    }));
    assert.deepEqual(await read(`open_pages/${VICTIM_KEY}`), live());
  });
  test('control: main\'s Remove (app/admin/forum removePost on a flagged row) deleted the live piece', async () => {
    await seed(env, { [`open_pages/${VICTIM_KEY}`]: live(), [`open_pages_pending/${VICTIM_KEY}`]: pending() });
    // dc568418 app/admin/forum/page.jsx removePost({ id: p.id, authorUid: p.authorUid }), verbatim.
    await founder.ref().update({
      [`open_pages/${VICTIM_KEY}`]: null, [`open_pages_pending/${VICTIM_KEY}`]: null,
      [`open_pages_reports/${VICTIM_KEY}`]: null, [`user_open_pages/${OWNER}/${VICTIM_KEY}`]: null,
    });
    assert.equal(await read(`open_pages/${VICTIM_KEY}`), null, 'the old Remove takes the victim\'s piece');
  });
});

// ── Comments ────────────────────────────────────────────────────────────────────────────────────
const SLUG = 'a-story';
// app/stories/[slug]/page-client.js submit, field for field (parentId null is stripped).
const comment = (over = {}) => ({ text: 'A comment.', authorName: 'Reader', authorInitials: 'RE', authorUid: OWNER, createdAt: Date.now(), ...over });

describe('LIVE-PATHS-2 #2 · comments: a top-level comment carries its commenter\'s own uid', () => {
  test('[hole] a reader cannot post a comment as somebody else', async () => {
    await assertFails(owner.ref(`comments/${SLUG}/c1`).set(comment({ authorUid: STRANGER })));
  });
  test('[hole] the author cannot hand their comment to somebody else afterwards', async () => {
    await seed(env, { [`comments/${SLUG}/c1`]: comment() });
    await assertFails(owner.ref(`comments/${SLUG}/c1/authorUid`).set(STRANGER));
    await assertFails(owner.ref(`comments/${SLUG}/c1`).set(comment({ authorUid: STRANGER })));
  });
  test('still allowed: post (with its index entry), edit, react, reply, delete', async () => {
    await assertSucceeds(owner.ref().update({
      [`comments/${SLUG}/c1`]: comment(),
      [`user_comments/${OWNER}/c1`]: { slug: SLUG, createdAt: 1 },
    }));
    await assertSucceeds(owner.ref(`comments/${SLUG}/c1`).update({ text: 'Edited.', editedAt: Date.now() }));
    await assertSucceeds(stranger.ref(`comments/${SLUG}/c1/heartCount`).set(1));
    await assertSucceeds(stranger.ref(`comments/${SLUG}/c1/replies/r1`).set({ text: 'A reply.', authorName: 'S', authorUid: STRANGER, createdAt: Date.now() }));
    await assertSucceeds(owner.ref(`comments/${SLUG}/c1`).remove());
  });
  test('still allowed: a legacy comment owned through `uid` can be edited by that reader', async () => {
    await seed(env, { [`comments/${SLUG}/old`]: { text: 'Old.', authorName: 'R', authorUid: OWNER, uid: OWNER, createdAt: 1 } });
    await assertSucceeds(owner.ref(`comments/${SLUG}/old`).update({ text: 'Old, edited.', editedAt: 2 }));
  });
});

// ── The Square ──────────────────────────────────────────────────────────────────────────────────
// app/square/page.js post(), field for field (nulls stripped).
const post = (over = {}) => ({
  text: 'a real post', authorUid: OWNER, authorName: 'Reader', authorInitials: 'RE', authorHandle: '',
  authorReadCount: 0, isAuthor: false, likeCount: 0, pinned: false, createdAt: Date.now(), ...over,
});

describe('LIVE-PATHS-2 #3 · square_posts: authorUid never changes after the post is made', () => {
  test('[hole] the owner cannot hand their post to somebody else', async () => {
    await seed(env, { 'square_posts/p1': post() });
    await assertFails(owner.ref('square_posts/p1/authorUid').set(STRANGER));
    await assertFails(owner.ref('square_posts/p1').update({ authorUid: STRANGER, text: 'now theirs' }));
  });
  test('[hole] nor can a moderator (canRemovePosts) reassign one', async () => {
    await seed(env, { 'square_posts/p1': post(), [`users/${OTHER}/canRemovePosts`]: true });
    await assertFails(other.ref('square_posts/p1/authorUid').set(OTHER));
  });
  test('still allowed: post, edit, withdraw, a reaction, a pin, a moderator removal, delete', async () => {
    await seed(env, { [`users/${OTHER}/canPin`]: true, [`users/${OTHER}/canRemovePosts`]: true });
    await assertSucceeds(owner.ref('square_posts/p1').set(post()));
    await assertSucceeds(owner.ref('square_posts/p1').update({ text: 'edited', edited: true }));
    await assertSucceeds(stranger.ref('square_posts/p1/likeCount').set(1));
    await assertSucceeds(other.ref('square_posts/p1/pinned').set(true));
    await assertSucceeds(owner.ref('square_posts/p1').update({ withdrawn: true, withdrawnAt: Date.now(), removedBy: 'author' }));
    await assertSucceeds(owner.ref('square_posts/p2').set(post()));
    await assertSucceeds(other.ref('square_posts/p2').update({ withdrawn: true, withdrawnAt: Date.now(), removedBy: 'moderator' }));
    await assertSucceeds(owner.ref('square_posts/p1').remove());
  });
});

// ── Quiz approval ───────────────────────────────────────────────────────────────────────────────
describe('LIVE-PATHS-2 #4 · approving a quiz writes the three fields it owns and nothing else', () => {
  const META = { hasQuiz: false, scribblesReward: 50, publishedAt: 1, attemptCount: 7 };
  test('a count and a naming claim that land between "read" and "write" survive the approval', async () => {
    await seed(env, { 'cms_stories/a-story': { title: 'A', quizMeta: META } });
    // Another writer lands first (record-attempt's increment, then a naming claim)…
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref().update({
        'cms_stories/a-story/quizMeta/attemptCount': 8,
        'cms_stories/a-story/quizMeta/namingClaimedBy': OTHER,
      });
    });
    // …then the approval, as the quiz admin now sends it.
    await assertSucceeds(founder.ref().update(quizApprovalMetaPaths('a-story', { scribblesReward: 75, approvedAt: 1762000000000 })));
    assert.deepEqual(await read('cms_stories/a-story/quizMeta'), {
      hasQuiz: true, scribblesReward: 75, publishedAt: 1762000000000, attemptCount: 8, namingClaimedBy: OTHER,
    });
  });
  test('control: main\'s whole-block write, built from a read taken before them, reverses both', async () => {
    await seed(env, { 'cms_stories/a-story': { title: 'A', quizMeta: META } });
    const existing = await read('cms_stories/a-story/quizMeta'); // dc568418 handleApprove's read
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref().update({ 'cms_stories/a-story/quizMeta/attemptCount': 8, 'cms_stories/a-story/quizMeta/namingClaimedBy': OTHER });
    });
    await founder.ref().update({ 'cms_stories/a-story/quizMeta': {
      hasQuiz: true, scribblesReward: 75, publishedAt: 1762000000000,
      attemptCount: existing?.attemptCount ?? 0, namingClaimedBy: existing?.namingClaimedBy ?? null, namingClaimedAt: existing?.namingClaimedAt ?? null,
    } });
    const got = await read('cms_stories/a-story/quizMeta');
    assert.equal(got.attemptCount, 7, 'the reader\'s attempt is reversed');
    assert.equal(got.namingClaimedBy, undefined, 'the claim is wiped');
  });
});

// ── The shipping app's writes (A56, 2 Nov) ──────────────────────────────────────────────────────
// The app's source isn't visible from this repo. A56 read it and named these writes; their field
// shapes follow A56's description and the web's own version of each write (cited). Every one must
// pass under the new rules. If one fails, the rule is wrong, not the test.
describe('LIVE-PATHS-2 · the app\'s comment writes still pass', () => {
  const appComment = () => ({ text: 'From the app.', authorName: 'Reader', authorUid: OWNER, createdAt: 1762000000000 });
  test('post: set() a new comment', async () => {
    await assertSucceeds(owner.ref(`comments/${SLUG}/app1`).set(appComment()));
  });
  test('STORY-02 retry: set() the same key again, same authorUid, over a record that already landed', async () => {
    await assertSucceeds(owner.ref(`comments/${SLUG}/app1`).set(appComment()));
    await assertSucceeds(owner.ref(`comments/${SLUG}/app1`).set(appComment()));
    assert.deepEqual(await read(`comments/${SLUG}/app1`), appComment());
  });
  test('edit: update() of { text, edited }', async () => {
    await seed(env, { [`comments/${SLUG}/app1`]: appComment() });
    await assertSucceeds(owner.ref(`comments/${SLUG}/app1`).update({ text: 'Edited in the app.', edited: true }));
  });
  test('delete: remove() (app/story/[slug].tsx:1099)', async () => {
    await seed(env, { [`comments/${SLUG}/app1`]: appComment() });
    await assertSucceeds(owner.ref(`comments/${SLUG}/app1`).remove());
    assert.equal(await read(`comments/${SLUG}/app1`), null);
  });
});

describe('LIVE-PATHS-2 · the app\'s Square writes still pass, by the author and by a moderator', () => {
  // A "moderator" holds canPin and canRemovePosts, as the app's moderator does. The author is an
  // ordinary reader, except for the pin, which the rules have always reserved to canPin.
  let mod;
  beforeEach(async () => {
    await seed(env, { [`users/${OTHER}/canPin`]: true, [`users/${OTHER}/canRemovePosts`]: true });
    mod = other;
  });
  const who = () => [['author', owner], ['moderator', mod]];
  const root = () => post({ quotedPostId: '-Nquoted00000000001', poll: { options: ['a', 'b'] } });
  const reply = () => post({ parentId: 'p1', text: 'a reply' });

  test('pin and unpin (canPin; an author who holds it may pin their own)', async () => {
    await seed(env, { 'square_posts/p1': root(), [`users/${OWNER}/canPin`]: true });
    for (const [name, db] of who()) {
      await assertSucceeds(db.ref('square_posts/p1').update({ pinned: true }), `${name} pins`);
      await assertSucceeds(db.ref('square_posts/p1').update({ pinned: false, unpinnedAt: Date.now() }), `${name} unpins`);
    }
  });
  test('quote-strip: update({ quotedPostId: null }) (web: app/square/page.js handleStripQuote)', async () => {
    for (const [name, db] of who()) {
      await seed(env, { 'square_posts/p1': root() });
      await assertSucceeds(db.ref('square_posts/p1').update({ quotedPostId: null }), name);
    }
  });
  test('poll vote: poll/votes/<own uid>', async () => {
    await seed(env, { 'square_posts/p1': root() });
    await assertSucceeds(owner.ref('square_posts/p1/poll/votes').update({ [OWNER]: '0' }));
    await assertSucceeds(mod.ref('square_posts/p1/poll/votes').update({ [OTHER]: '1' }));
  });
  test('tombstone a root with replies: { text: \'\', withdrawn, withdrawnAt, removedBy }', async () => {
    for (const [name, db] of who()) {
      await seed(env, { 'square_posts/p1': root(), 'square_posts/r1': reply() });
      await assertSucceeds(db.ref('square_posts/p1').update({ text: '', withdrawn: true, withdrawnAt: Date.now(), removedBy: name }), name);
    }
  });
  test('tombstone a reply: text and attachments nulled, withdrawn, removedBy', async () => {
    for (const [name, db] of who()) {
      await seed(env, { 'square_posts/p1': root(), 'square_posts/r1': reply() });
      await assertSucceeds(db.ref('square_posts/r1').update({
        text: null, attachedStory: null, attachedOpenPage: null, quotedPostId: null,
        withdrawn: true, withdrawnAt: Date.now(), removedBy: name,
      }), name);
    }
  });
  test('null-removal of a post with no replies: set(null) (lib/squareModeration.ts:199 and :237)', async () => {
    for (const [name, db] of who()) {
      await seed(env, { 'square_posts/p1': root() });
      await assertSucceeds(db.ref('square_posts/p1').set(null), name);
      assert.equal(await read('square_posts/p1'), null);
    }
  });
});
