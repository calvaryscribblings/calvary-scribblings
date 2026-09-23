// ACCOUNT DELETION — the emulator half. Both halves run for real against a database seeded with
// the deleted reader's data in EVERY Step 0 location, then the whole database is walked for the
// uid, as a key or a value, anywhere. Only the kept records may still carry it.
//
// The endpoint half runs through realIo — the same REST get/patch the Worker uses — with only
// the four outside services (Stripe, Paystack, Storage, Auth) stood in. The scrub runs through
// the same runScrub the cron runs.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { runDeletion, realIo, StepError } from '../../functions/api/account/_deletion.js';
import { writeMembership, writePass } from '../../functions/api/membership/_membership.js';
import { runScrub, preview } from '../../scripts/account/scrub.mjs';

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9000';
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const NS = 'demo-calvary-account-default-rtdb';
const URL = `http://${HOST}?ns=${NS}`;
assert.match(URL, /^http:\/\/(127\.0\.0\.1|localhost):\d+\?ns=demo-/, 'refusing to run anywhere but the emulator');

const T = 'TTTTdeleted000000000000000001';
const A = 'AAAAother0000000000000000002';
const B = 'BBBBother0000000000000000003';
const EMAIL = 'leaving@example.com';
const conv = [A, T].sort().join('_');

// The Worker's REST calls, pointed at the emulator's namespace and its admin token.
const realFetch = globalThis.fetch;
function emulatorFetch(url, opts) {
  const u = String(url);
  if (u.startsWith(`http://${HOST}/`)) {
    const sep = u.includes('?') ? '&' : '?';
    return realFetch(`${u}${sep}ns=${NS}`, opts);
  }
  return realFetch(url, opts);
}
const ENV = { FIREBASE_DATABASE_URL: `http://${HOST}` };

function ioFor(outside, { failOnce } = {}) {
  const base = realIo(ENV, 'owner');
  let tripped = false;
  const trip = (s) => { if (failOnce === s && !tripped) { tripped = true; throw new Error(`injected ${s}`); } };
  return {
    ...base,
    async patch(u) { if (Object.keys(u).some((k) => k.startsWith('users/'))) trip('owned'); return base.patch(u); },
    async stripeCancel(id) { trip('membership'); outside.push(`stripe ${id}`); },
    async paystackDisable(code) { trip('membership'); outside.push(`paystack ${code}`); },
    async storageList(prefix) { trip('storage'); outside.push(`list ${prefix}`); return prefix.startsWith('avatars/') ? [prefix] : []; },
    async storageDelete(name) { outside.push(`rm ${name}`); },
    async authDelete(uid) { trip('auth'); outside.push(`auth ${uid}`); },
  };
}

// ── THE FIXTURE: the leaving reader in every location, and two readers who stay ────────────
const fixture = () => ({
  users: {
    [T]: { displayName: 'Leaving Reader', username: 'leaving', handle: 'leaving', handleLowercased: 'leaving', membership: 'gold' },
    [A]: { displayName: 'Stays A', username: 'stays' },
    [B]: { displayName: 'Stays B' },
  },
  usernames: { leaving: T, stays: A },
  user_search: { [T]: { displayName: 'Leaving Reader' }, [A]: { displayName: 'Stays A' } },
  push_tokens: { [T]: { k: { token: 'ExpoPushToken[x]', platform: 'ios', appVersion: '1', updatedAt: 1 } } },
  leaderboard: { [T]: { readerScore: 5 }, [A]: { readerScore: 9 } },
  leaderboards: { 'summer-2026': { final: { [T]: { points: 5 }, [A]: { points: 9 } }, snapshot: { [T]: { points: 5 } } } },
  blocked_users: { [T]: { [B]: true }, [B]: { [T]: true } },
  readerBookmarks: { [T]: { s: true } }, bookmarks: { [T]: { s: true } }, userBookmarks: { [T]: { s: true } },
  userBadges: { [T]: { b: true } }, userStreaks: { [T]: { n: 3 } }, userProgress: { [T]: { s: 1 } },
  userStoryTiers: { [T]: { s: 'gold' } }, points: { [T]: { total: 5 } }, wallet: { [T]: { balance: 5 } },
  payout_requests: { [T]: { r: { amount: 1 } } }, quizAttemptCounted: { [T]: { s: true } },
  quiz_submissions: { [T]: { s: { score: 1 } } }, exercise_submissions: { [T]: { e: 1 } },
  series_reading_progress: { [T]: { x: 1 } }, bookstore_reading_progress: { [T]: { x: 1 } },
  square_presence: { [T]: { online: true } }, open_pages_drafts: { [T]: { d: { title: 'draft' } } },
  open_pages_rate: { [T]: { recent: { 0: 1 } } },
  notifications: { [T]: { n: { fromUid: A } }, [A]: { n1: { fromUid: T, fromName: 'Leaving Reader' }, n2: { fromUid: B } } },
  library_notifications: { [T]: { n: { type: 'reward' } }, [A]: { l1: { fromUid: T, fromName: 'Leaving Reader' } } },
  followers: { [T]: { [A]: true }, [A]: { [T]: true, [B]: true } },
  following: { [T]: { [A]: true }, [A]: { [T]: true } },
  dm_conversations: { [T]: { [conv]: { lastAt: 1 } }, [A]: { [conv]: { lastAt: 1 } } },
  dm_messages: { [conv]: { m1: { senderUid: T, text: 'hello' }, m2: { senderUid: A, text: 'hi back' } } },
  comments: {
    story: {
      c1: { authorUid: T, authorName: 'Leaving Reader', text: 'mine', heartCount: 1 },
      c2: { authorUid: A, text: 'a reply to mine', parentId: 'c1' },
      c3: { authorUid: A, text: 'theirs', heartCount: 2, fireCount: 1, replies: { r1: { authorUid: T, text: 'nested mine' }, r2: { authorUid: B, text: 'nested B' } } },
    },
    op1: { oc1: { authorUid: A, text: 'comment on the leaving reader\'s piece' } },
  },
  user_comments: { [T]: { c1: { slug: 'story' } }, [A]: { c2: { slug: 'story' }, c3: { slug: 'story' } } },
  comment_reactions: { story: { [T]: { c3: { heart: true, fire: true } }, [A]: { c1: { heart: true } } } },
  commentReactions: { story: { c3: { [T]: { heart: true } }, c1: { [A]: { heart: true } } } },
  comment_likes: { op2: { oc9: { [T]: true, [A]: true, replies: { rr: { [T]: true } } } } },
  comment_screening: { story: { c1: { uid: T, promotable: true, checkedAt: 1, text: 'mine' }, c3: { uid: A, promotable: false, checkedAt: 1 } } },
  storyReads: { story: { [T]: 1, [A]: 2 } },
  storyReactionUsers: { story: { [T]: { heart: true, quill: true }, [A]: { heart: true } } },
  storyReactions: { story: { heart: 2, quill: 1 } },
  square_posts: {
    p1: { authorUid: A, text: 'A post', likeCount: 2, clapCount: 1 },
    p2: { authorUid: T, authorName: 'Leaving Reader', text: 'my post', likeCount: 1 },
    p3: { authorUid: A, text: 'A replying to T', parentId: 'p2' },
  },
  user_square_posts: { [T]: { p2: { authorUid: T } }, [A]: { p1: { authorUid: A }, p3: { authorUid: A } } },
  square_likes: { p1: { [T]: true, [A]: true }, p2: { [A]: true } },
  square_reactions: { p1: { clap: { [T]: true } }, p2: { like: { [A]: true } } },
  square_archive: {
    a1: { authorUid: T, text: 'archived mine' },
    a2: { authorUid: A, text: 'archived theirs', likeCount: 1, poll: { question: 'q', votes: { [T]: 0, [A]: 1 } } },
  },
  square_archive_reactions: { a1: { like: { [A]: true } }, a2: { like: { [T]: true } } },
  open_pages: {
    op1: { authorUid: T, authorName: 'Leaving Reader', title: 'my piece', status: 'published' },
    op2: { authorUid: A, title: 'their piece', status: 'published' },
  },
  user_open_pages: { [T]: { op1: { authorUid: T } }, [A]: { op2: { authorUid: A } } },
  open_pages_reactions: { op1: { [A]: true }, op2: { [T]: true, [A]: true } },
  cms_voices: { v1: { matchUid: T, displayName: 'Leaving Reader', message: 'a published voice' } },
  subscribers: { s1: { email: 'Leaving@Example.com' }, s2: { email: 'stays@example.com' } },
  bookstore_waitlist: { w1: { email: EMAIL }, w2: { email: 'stays@example.com' } },
  // ── KEPT ─────────────────────────────────────────────────────────────────────────────
  memberships: { [T]: { tier: 'gold', rail: 'stripe', status: 'active', stripeSubscriptionId: 'sub_T', stripeCustomerId: 'cus_T' } },
  bookstore_purchases: { [T]: { title1: { amount: 499, stripePaymentIntent: 'pi_1' } } },
  purchases: { [T]: { story: { amount: 150 } } },
  reports: { rep1: { [A]: { postAuthorUid: T, snapshot: 'reported text' } } },
  rate_limits: { acctdel: { day: { d1: { [T]: 1 } } } },
});

// Where the uid may legitimately remain after deletion — and why.
const KEPT = [
  new RegExp(`^memberships/${T}(/|$)`),            // accounting
  new RegExp(`^bookstore_purchases/${T}(/|$)`),    // accounting
  new RegExp(`^purchases/${T}(/|$)`),              // accounting
  new RegExp(`^deletions/${T}(/|$)`),              // the record
  /^reports\//,                                    // safety records
  /^rate_limits\//,                                // self-cleaning windows
  // DRAFT: the other reader keeps their half of a DM. A conversation id IS the sorted pair of
  // uids (square/page.js), so their half is necessarily filed under an id that contains this
  // one. Only the id: the deleted reader's messages, profile and pointer are gone.
  new RegExp(`^dm_messages/${conv}$`),
  new RegExp(`^dm_conversations/${A}/${conv}$`),
];

function walkFor(value, needle, path = [], hits = []) {
  if (value === null || value === undefined) return hits;
  if (typeof value !== 'object') {
    if (String(value).includes(needle)) hits.push(path.join('/'));
    return hits;
  }
  for (const [k, v] of Object.entries(value)) {
    const p = [...path, k];
    if (k.includes(needle)) hits.push(p.join('/'));
    walkFor(v, needle, p, hits);
  }
  return hits;
}

let app, db;
before(() => {
  globalThis.fetch = emulatorFetch;
  app = initializeApp({ projectId: 'demo-calvary-account', databaseURL: URL }, 'account');
  db = getDatabase(app);
});
after(async () => { globalThis.fetch = realFetch; await deleteApp(app); });
beforeEach(async () => { await db.ref().set(fixture()); });

const quiet = { log() {} };
async function deleteFully(outside = [], opts = {}) {
  await runDeletion(T, EMAIL, ioFor(outside, opts), quiet);
  await runScrub(db, { apply: true, log() {} });
  return (await db.ref().get()).val();
}

describe('the whole deletion, endpoint then scrub', () => {
  test('FULL DELETION: nothing carries the uid anywhere but the kept records', async () => {
    const outside = [];
    const after = await deleteFully(outside);
    const leaks = walkFor(after, T).filter((p) => !KEPT.some((re) => re.test(p)));
    assert.deepEqual(leaks, [], `the uid survives at:\n${leaks.join('\n')}`);
    // …and the email is gone from every row keyed by it
    assert.deepEqual(walkFor(after, 'eaving@').concat(walkFor(after, EMAIL)), []);
    assert.deepEqual(outside, [`stripe sub_T`, `list avatars/${T}`, `rm avatars/${T}`, `list headers/${T}`, `list open_pages/${T}/`, `auth ${T}`]);
  });

  test('KEPT records are kept, and nothing that identifies a person points at them', async () => {
    const after = await deleteFully();
    assert.equal(after.memberships[T].stripeCustomerId, 'cus_T');
    assert.equal(after.bookstore_purchases[T].title1.amount, 499);
    assert.equal(after.purchases[T].story.amount, 150);
    assert.equal(after.reports.rep1[A].postAuthorUid, T);
    // detached: no profile, no handle, no search row, no email row resolves to this uid
    assert.equal(after.users?.[T], undefined);
    assert.ok(!Object.values(after.usernames || {}).includes(T));
    assert.equal(after.user_search?.[T], undefined);
    assert.deepEqual(Object.keys(after.deletions[T]).sort(), ['completedAt', 'requestedAt', 'steps', 'uid', 'updatedAt']);
    assert.deepEqual(Object.keys(after.deletions[T].steps).sort(), ['auth', 'membership', 'owned', 'scrub', 'storage']);
  });

  test('what STAYS stays: other readers\' work, and every counter comes down by exactly their share', async () => {
    const after = await deleteFully();
    const c3 = after.comments.story.c3;
    assert.equal(c3.text, 'theirs');
    assert.deepEqual(Object.keys(c3.replies), ['r2']);
    assert.equal(c3.heartCount, 1, 'heart recorded in both shapes → down ONE');
    assert.equal(c3.fireCount, 0);
    assert.equal(after.comments.story.c1, undefined);
    assert.equal(after.comments.story.c2, undefined, 'DRAFT: the thread under their comment goes with it');
    assert.equal(after.comments.op1, undefined, 'comments on their Open Pages piece go with it');
    assert.deepEqual(after.user_comments[A], { c3: { slug: 'story' } });
    assert.equal(after.storyReactions.story.heart, 1);
    assert.equal(after.storyReactions.story.quill, 0);
    assert.equal(after.square_posts.p1.likeCount, 1);
    assert.equal(after.square_posts.p1.clapCount, 0);
    assert.equal(after.square_posts.p3, undefined);
    assert.deepEqual(Object.keys(after.user_square_posts[A]), ['p1']);
    assert.equal(after.square_archive.a2.likeCount, 0);
    assert.deepEqual(after.square_archive.a2.poll.votes, { [A]: 1 });
    assert.deepEqual(after.open_pages_reactions, { op2: { [A]: true } });
    assert.equal(after.dm_messages[conv].m2.text, 'hi back', 'DRAFT: the other reader keeps their half');
    assert.deepEqual(after.dm_conversations[A], { [conv]: { lastAt: 1 } });
    assert.equal(after.cms_voices.v1.message, 'a published voice', 'DRAFT: the voice is detached, not deleted');
    assert.deepEqual(after.followers[A], { [B]: true });
    assert.deepEqual(after.notifications[A], { n2: { fromUid: B } });
    assert.equal(after.users[A].displayName, 'Stays A');
    assert.deepEqual(after.subscribers, { s2: { email: 'stays@example.com' } });
  });

  test('a scrub run twice changes nothing the second time — no counter goes down twice', async () => {
    const once = await deleteFully();
    // Put the record back to "not scrubbed" and run again.
    await db.ref(`deletions/${T}/steps/scrub`).remove();
    await runScrub(db, { apply: true, log() {} });
    const twice = (await db.ref().get()).val();
    delete once.deletions; delete twice.deletions;
    assert.deepEqual(twice, once);
  });

  test('the scrub waits for the endpoint: nothing is scrubbed before the Auth step is recorded', async () => {
    await db.ref(`deletions/${T}`).set({ uid: T, requestedAt: 1, updatedAt: 1, steps: { membership: 1 } });
    await runScrub(db, { apply: true, log() {} });
    assert.equal((await db.ref('comments/story/c1').get()).val().text, 'mine');
  });
});

describe('resume: a failure at each step, then a retry', () => {
  for (const step of ['membership', 'owned', 'storage', 'auth']) {
    test(`fails at "${step}" → error, and the retry leaves the same clean database`, async () => {
      const outside = [];
      await assert.rejects(runDeletion(T, EMAIL, ioFor(outside, { failOnce: step }), quiet),
        (e) => e instanceof StepError && e.step === step);
      const mid = (await db.ref(`deletions/${T}/steps`).get()).val() || {};
      assert.equal(mid[step], undefined);
      assert.ok(!('auth' in mid), 'never claims the account is gone');
      await runDeletion(T, EMAIL, ioFor(outside), quiet);
      await runScrub(db, { apply: true, log() {} });
      const after = (await db.ref().get()).val();
      assert.deepEqual(walkFor(after, T).filter((p) => !KEPT.some((re) => re.test(p))), []);
      assert.equal(outside.filter((c) => c === 'stripe sub_T').length, 1, 'money moved once');
    });
  }
});

describe('webhooks after a deletion', () => {
  test('a renewal or cancellation event records the payment and writes NOTHING under users/', async () => {
    await deleteFully();
    const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
    try {
      await writeMembership(ENV, 'owner', T, { tier: 'free', status: 'cancelled', lastInvoiceRef: 'in_after', updatedAt: 2 });
      await writePass(ENV, 'owner', T, { kind: 'day', tier: 'gold', expiresAt: 3, ref: 'pay_after' });
    } finally { console.error = orig; }
    assert.equal((await db.ref(`users/${T}`).get()).val(), null, 'no stub profile');
    const m = (await db.ref(`memberships/${T}`).get()).val();
    assert.equal(m.lastInvoiceRef, 'in_after', 'the event is still recorded');
    assert.ok(m.pass?.ref === 'pay_after');
    assert.ok(errs.some((e) => e.includes('DELETED-ACCOUNT')));
  });

  test('the stub backstop: a users node that reappears after a finished deletion is removed next tick', async () => {
    await deleteFully();
    await db.ref(`users/${T}/membership`).set('gold');   // a webhook that failed open
    await runScrub(db, { apply: true, log() {} });
    assert.equal((await db.ref(`users/${T}`).get()).val(), null);
  });

  test('a live member is untouched by the guard', async () => {
    await writeMembership(ENV, 'owner', A, { tier: 'gold', status: 'active', lastInvoiceRef: 'in_A', updatedAt: 2 });
    assert.equal((await db.ref(`users/${A}/membership`).get()).val(), 'gold');
  });
});

test('preview: a live account is reported, and nothing is written', async () => {
  const before = (await db.ref().get()).val();
  const p = await preview(db, T, EMAIL);
  assert.ok(p.owned[`users/{uid}`]);
  assert.equal(p.scrub.comments, 1);
  assert.deepEqual(p.membershipToCancel, { rail: 'stripe', id: 'sub_T' });
  assert.deepEqual((await db.ref().get()).val(), before);
});
