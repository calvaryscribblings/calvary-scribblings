// BEHAVIOURAL RULES ASSERTIONS — database.rules.json, against the emulator.
//
// This is the R9.0 probe harness, ported from live REST calls to the emulator so
// it can run on every push with no secrets and no production data.
//
// FOUR CASES PER NODE, and the fourth is as load-bearing as the first three:
//   1. unauthenticated write   — must fail
//   2. signed-in stranger write — must fail ("stranger" = a second real account;
//                                 sign-up is open, so this is the threat model)
//   3. WIPE                     — must fail. .validate NEVER runs on a null write,
//                                 so a grant at a node root deletes the subtree.
//   4. the legitimate write     — MUST SUCCEED
//
// Case 4 is not decoration. Two rules in R9.0 would have shipped broken without
// it: requiring `imageUrl` on a DM would have rejected every send (Firebase
// strips the client's `imageUrl: null`, so zero live messages carry the key), and
// owner-scoping square_posts would have broken every like (toggleReaction runs a
// transaction on ANOTHER user's post). Denial-only suites pass happily while the
// product is on fire.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  makeEnv, seed, assertFails, assertSucceeds,
  DB_RULES_PATH,
  OWNER, STRANGER, OTHER, FOUNDER_A, convIdFor,
} from './helpers.mjs';
// R9.1 LB-9: the client half of the waitlist email check, asserted against the rule half in
// the same test so the two cannot drift. See the note above the ACCEPTED/REJECTED tables.
import { isEmailShaped } from '../../app/lib/bookstore/gate.js';
// R18 — same discipline, one round later: the author block's caps and its path shape are read
// out of the module the CMS validates with, so the rule half and the writer half are asserted
// against each other rather than against two copies of the same numbers.
import {
  AUTHOR_CAPS, isAuthorPhotoPath, normaliseAuthorFields, validateAuthorFields,
} from '../../app/lib/bookstore/author.js';
// R35 — same discipline for Open Pages: the pending record's field list is IMPORTED from the
// module that builds it, so a key added to the writer and not to the rules fails in this
// suite rather than on the first submission after the deploy.
import { buildPendingPost } from '../../app/lib/openPages.js';
// R21 — the tombstone. Same discipline again: what the writer PRODUCES is asserted against
// what the rule ACCEPTS, in one test, so a field added to one and not the other is caught here
// rather than by a founder watching a delete fail halfway through.
import { tombstoneOf } from '../../app/lib/bookstore/withdrawal.js';

let env, owner, stranger, anon, founder;

before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  founder = env.authenticatedContext(FOUNDER_A).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const now = () => Date.now();

// ═══════════════════════════════════════════════════════════════════════════
describe('LB-2 · dm_messages — private mail', () => {
  const CONV = convIdFor(OWNER, STRANGER);
  const msg = (uid) => ({ text: 'hello', senderUid: uid, createdAt: now() });

  test('unauthenticated cannot read or write', async () => {
    await assertFails(anon.ref('dm_messages').get());
    await assertFails(anon.ref(`dm_messages/${CONV}/m1`).set(msg(OWNER)));
  });

  test('a non-participant cannot read the conversation', async () => {
    await seed(env, { [`dm_messages/${CONV}/m1`]: msg(OWNER) });
    const outsider = env.authenticatedContext(OTHER).database();
    await assertFails(outsider.ref(`dm_messages/${CONV}`).get());
    await assertFails(outsider.ref('dm_messages').get());
  });

  test('a non-participant cannot write into the conversation', async () => {
    const outsider = env.authenticatedContext(OTHER).database();
    await assertFails(outsider.ref(`dm_messages/${CONV}/m1`).set(msg(OTHER)));
  });

  test('WIPE: nobody can delete a conversation or the node', async () => {
    await seed(env, { [`dm_messages/${CONV}/m1`]: msg(OWNER) });
    await assertFails(anon.ref('dm_messages').remove());
    await assertFails(stranger.ref('dm_messages').remove());
    await assertFails(owner.ref(`dm_messages/${CONV}`).remove());          // even a member
    await assertFails(owner.ref(`dm_messages/${CONV}`).set({ x: msg(OWNER) })); // wholesale overwrite
  });

  test('LEGITIMATE: a participant sends and reads (square/page.js:540)', async () => {
    await assertSucceeds(owner.ref(`dm_messages/${CONV}/m1`).set(msg(OWNER)));
    await assertSucceeds(owner.ref(`dm_messages/${CONV}`).get());
    await assertSucceeds(stranger.ref(`dm_messages/${CONV}`).get());
  });

  test('LEGITIMATE: imageUrl is OPTIONAL — the trap that would have broken every send', async () => {
    // The client writes `imageUrl: null` for a text-only message and Firebase
    // strips nulls, so NO stored message carries the key. Requiring it in
    // hasChildren() would reject 100% of real sends.
    await assertSucceeds(owner.ref(`dm_messages/${CONV}/m1`).set(msg(OWNER)));
    // ...and an image message, where text is legitimately the empty string.
    await assertSucceeds(owner.ref(`dm_messages/${CONV}/m2`).set({
      text: '', imageUrl: 'https://example.com/i.png', senderUid: OWNER, createdAt: now(),
    }));
  });

  test('append-only: no edits, no single-message deletes', async () => {
    await assertSucceeds(owner.ref(`dm_messages/${CONV}/m1`).set(msg(OWNER)));
    await assertFails(owner.ref(`dm_messages/${CONV}/m1`).set(msg(OWNER)));
    await assertFails(owner.ref(`dm_messages/${CONV}/m1`).remove());
  });

  test('senderUid cannot be forged, shape is closed, text is bounded', async () => {
    await assertFails(owner.ref(`dm_messages/${CONV}/f1`).set(msg(STRANGER)));
    await assertFails(owner.ref(`dm_messages/${CONV}/f2`).set({ ...msg(OWNER), evil: 'x' }));
    await assertFails(owner.ref(`dm_messages/${CONV}/f3`).set({
      text: 'x'.repeat(6000), senderUid: OWNER, createdAt: now(),
    }));
    await assertFails(owner.ref(`dm_messages/${CONV}/f4`).set({ text: 'x', senderUid: OWNER }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LB-1 · stories — the hit counter', () => {
  test('unauthenticated and stranger writes fail; wipe fails', async () => {
    await assertFails(anon.ref('stories/a-slug/hits').set(999));
    await assertFails(stranger.ref('stories/a-slug/hits').set(999));
    await assertFails(anon.ref('stories').remove());
    await assertFails(stranger.ref('stories').remove());
  });

  test('LEGITIMATE: the world can still READ (app/inspiring/page.js:73)', async () => {
    await seed(env, { 'stories/a-slug': { hits: 5 } });
    await assertSucceeds(anon.ref('stories').get());
  });

  test('LEGITIMATE: the real writer is functions/api/hit.js on a service-account token', async () => {
    // Service accounts bypass rules entirely, which is exactly what hit.js:20
    // means by "write the rules-locked stories node". Modelled here by the
    // rules-disabled context — the emulator's stand-in for admin privilege.
    await seed(env, { 'stories/a-slug/hits': 1 });
    await assertSucceeds(anon.ref('stories/a-slug/hits').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R9.8 · top_stories — the last open write grant, now closed.
//
// This node was world-writable until R9.8 and carried the ONLY exception in the
// structure ratchet that was not an open finding: it was blessed because the
// writer was unidentified, and locking it blind risked killing a live job.
//
// The writer is the calvary-hit-counter Cloudflare Worker, mirrored at
// workers-external/calvary-hit-counter.worker.js. It rebuilds top_stories/weekly
// hourly at ~:00:41 UTC. Until R9.6 it authenticated with the Firebase WEB API
// KEY as ?auth=, which RTDB ignores — so it was writing UNAUTHENTICATED, and only
// the open grant kept it alive. R9.6 gave it env.FIREBASE_SECRET, a legacy
// database secret, which BYPASSES rules entirely. That is why closing .write does
// not stop it, and it is the same reason the stories node above can stay locked
// while functions/api/hit.js keeps writing to it.
//
// The credential was proven by OBSERVATION, not by inspection: the Worker's prune
// PATCH passes through the already-closed `stories` node, and day buckets
// 2026-07-25/26 disappearing at the 21:00:41 UTC run on 5 Aug is what showed the
// secret was live in this exact code path.
describe('R9.8 · top_stories — the public top-10', () => {
  const weekly = () => ({
    items: [{ slug: 'a-slug', count: 12 }, { slug: 'b-slug', count: 7 }],
    generatedAt: now(),
  });

  test('unauthenticated cannot write', async () => {
    await assertFails(anon.ref('top_stories/weekly').set(weekly()));
    await assertFails(anon.ref('top_stories/weekly/items/0/count').set(99999));
  });

  test('a signed-in stranger cannot write either', async () => {
    // Sign-up is open, so this is the threat model — not an exotic attacker.
    await assertFails(stranger.ref('top_stories/weekly').set(weekly()));
    await assertFails(stranger.ref('top_stories/weekly/items/0/slug').set('their-own-story'));
  });

  test('WIPE: nobody can delete the node or the weekly payload', async () => {
    // The case that mattered most here. .validate NEVER runs on a null write, so
    // while the grant sat at the node root a single anonymous request emptied the
    // public top-10 — no auth, no trace.
    await seed(env, { 'top_stories/weekly': weekly() });
    await assertFails(anon.ref('top_stories').remove());
    await assertFails(stranger.ref('top_stories').remove());
    await assertFails(anon.ref('top_stories/weekly').remove());
    await assertFails(stranger.ref('top_stories/weekly').remove());
    await assertFails(anon.ref('top_stories/weekly').set(null));
    await assertFails(anon.ref('top_stories/weekly/items').remove());
  });

  test('LEGITIMATE: the world can still READ (app/public-library/page.js:1093)', async () => {
    // .read stays true and this is why. fetchTop10() reads top_stories/weekly
    // with no signed-in user — every anonymous visitor to /public-library hits
    // this path, so a read regression here empties the top-10 for everyone.
    await seed(env, { 'top_stories/weekly': weekly() });
    await assertSucceeds(anon.ref('top_stories/weekly').get());
    await assertSucceeds(anon.ref('top_stories').get());
  });

  test('LEGITIMATE: the Worker writes on a secret that bypasses rules', async () => {
    // env.FIREBASE_SECRET is a legacy database secret — rules do not apply to it.
    // Modelled by the rules-disabled context, the emulator's stand-in for admin
    // privilege, exactly as the stories block above models hit.js.
    await seed(env, { 'top_stories/weekly': weekly() });
    await assertSucceeds(anon.ref('top_stories/weekly/generatedAt').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LB-3/LB-4 · wallet and payout_requests — money-adjacent', () => {
  for (const node of ['wallet', 'payout_requests']) {
    test(`${node}: nobody may write, not even the owner`, async () => {
      await assertFails(anon.ref(`${node}/${OWNER}/balance`).set(1e9));
      await assertFails(stranger.ref(`${node}/${OWNER}/balance`).set(1e9));
      await assertFails(owner.ref(`${node}/${OWNER}/balance`).set(1e9));
      await assertFails(stranger.ref(node).remove());
    });
  }

  test('LEGITIMATE: the owner can still read their own balance (profile/page.js:578)', async () => {
    await seed(env, { [`wallet/${OWNER}`]: { balance: 42 } });
    await assertSucceeds(owner.ref(`wallet/${OWNER}`).get());
    await assertFails(stranger.ref(`wallet/${OWNER}`).get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LB-12 · usernames — handle hijack', () => {
  test('unauthenticated cannot claim', async () => {
    await assertFails(anon.ref('usernames/freehandle').set(STRANGER));
  });

  test('LEGITIMATE: claim a free handle (profile/page.js:626)', async () => {
    await assertSucceeds(owner.ref('usernames/myhandle').set(OWNER));
  });

  test('LEGITIMATE: release your OWN handle (profile/page.js:628)', async () => {
    await seed(env, { 'usernames/myhandle': OWNER });
    await assertSucceeds(owner.ref('usernames/myhandle').remove());
  });

  test("the hijack: a stranger cannot delete or overwrite someone else's handle", async () => {
    await seed(env, { 'usernames/myhandle': OWNER });
    await assertFails(stranger.ref('usernames/myhandle').remove());   // step 1 of the hijack
    await assertFails(stranger.ref('usernames/myhandle').set(STRANGER));
  });

  test('a handle cannot be pointed at somebody else', async () => {
    await assertFails(owner.ref('usernames/other').set(STRANGER));
  });

  test('WIPE: the whole index cannot be deleted', async () => {
    await seed(env, { 'usernames/a': OWNER, 'usernames/b': STRANGER });
    await assertFails(stranger.ref('usernames').remove());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LB-11 · notifications and library_notifications — the injection surface', () => {
  for (const node of ['notifications', 'library_notifications']) {
    const base = () => ({ type: 'follow', createdAt: now(), read: false, fromName: 'S' });

    test(`${node}: unauthenticated injection fails`, async () => {
      await assertFails(anon.ref(`${node}/${OWNER}/n1`).set({ ...base(), fromUid: STRANGER }));
    });

    test(`${node}: LEGITIMATE — a stranger notifies you under their OWN fromUid`, async () => {
      // self=0, other=434/1789 in the live census: these nodes are third-party by
      // nature. An owner-only rule would break every notification in the product.
      await assertSucceeds(stranger.ref(`${node}/${OWNER}/n1`).set({ ...base(), fromUid: STRANGER }));
    });

    test(`${node}: fromUid cannot be forged`, async () => {
      await assertFails(stranger.ref(`${node}/${OWNER}/n2`).set({ ...base(), fromUid: OTHER }));
    });

    test(`${node}: LEGITIMATE — your own reward note, which carries NO fromUid`, async () => {
      // 116 live library_notifications are type:'reward' pushed by the user to
      // themselves with no fromUid (page-client.js:707, :1164). A fromUid-only
      // rule would have rejected every one.
      await assertSucceeds(owner.ref(`${node}/${OWNER}/r1`).set({
        type: 'reward', createdAt: now(), read: false,
        fromName: 'Calvary Scribblings', message: 'You earned 10 Scribbles',
      }));
    });

    test(`${node}: LEGITIMATE — founder fan-out stamps the AUTHOR's uid, not their own`, async () => {
      // admin/page.js:742 sets fromUid to the story author. fromUid === auth.uid
      // does not hold for the publisher, so the founder branch is load-bearing.
      await assertSucceeds(founder.ref(`${node}/${OWNER}/s1`).set({
        type: 'new_story', fromUid: OTHER, fromName: 'An Author',
        createdAt: now(), read: false,
      }));
    });

    test(`${node}: LEGITIMATE — the owner marks it read (square/page.js:689)`, async () => {
      await seed(env, { [`${node}/${OWNER}/n1`]: { ...base(), fromUid: STRANGER } });
      await assertSucceeds(owner.ref(`${node}/${OWNER}/n1/read`).set(true));
      await assertFails(stranger.ref(`${node}/${OWNER}/n1/read`).set(true));
    });

    test(`${node}: delivered notifications cannot be edited`, async () => {
      await seed(env, { [`${node}/${OWNER}/n1`]: { ...base(), fromUid: STRANGER } });
      await assertFails(stranger.ref(`${node}/${OWNER}/n1`).set({ ...base(), fromUid: STRANGER, type: 'x' }));
    });

    test(`${node}: WIPE — no inbox and no node can be deleted, by anyone`, async () => {
      await seed(env, { [`${node}/${OWNER}/n1`]: { ...base(), fromUid: STRANGER } });
      await assertFails(stranger.ref(`${node}/${OWNER}`).remove());
      await assertFails(stranger.ref(node).remove());
      await assertFails(owner.ref(`${node}/${OWNER}`).remove());
    });

    test(`${node}: only the owner may read their inbox`, async () => {
      await seed(env, { [`${node}/${OWNER}/n1`]: { ...base(), fromUid: STRANGER } });
      await assertSucceeds(owner.ref(`${node}/${OWNER}`).get());
      await assertFails(stranger.ref(`${node}/${OWNER}`).get());
      await assertFails(anon.ref(`${node}/${OWNER}`).get());
    });
  }
});

describe('LB-11 · dm_conversations', () => {
  const CONV = convIdFor(OWNER, STRANGER);

  test("LEGITIMATE: a member writes BOTH pointers (square/page.js:541-542)", async () => {
    await assertSucceeds(owner.ref(`dm_conversations/${OWNER}/${CONV}`).set({ unread: 0, lastAt: now() }));
    await assertSucceeds(owner.ref(`dm_conversations/${STRANGER}/${CONV}`).set({ unread: 1, lastAt: now() }));
  });

  test('a non-member cannot write a pointer', async () => {
    const outsider = env.authenticatedContext(OTHER).database();
    await assertFails(outsider.ref(`dm_conversations/${OWNER}/${CONV}`).set({ unread: 9, lastAt: now() }));
  });

  test('shape is closed and the node cannot be wiped', async () => {
    await assertFails(owner.ref(`dm_conversations/${OWNER}/${CONV}`).set({ unread: 0, lastAt: now(), evil: 1 }));
    await assertFails(stranger.ref('dm_conversations').remove());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LB-5 · followers / following', () => {
  test('LEGITIMATE: follow and unfollow (user/page.js:409,412)', async () => {
    await assertSucceeds(stranger.ref(`followers/${OWNER}/${STRANGER}`).set(true));
    await assertSucceeds(stranger.ref(`following/${STRANGER}/${OWNER}`).set(true));
    await assertSucceeds(stranger.ref(`followers/${OWNER}/${STRANGER}`).remove());
    await assertSucceeds(stranger.ref(`following/${STRANGER}/${OWNER}`).remove());
  });

  test('a follow cannot be forged from somebody else', async () => {
    await assertFails(stranger.ref(`followers/${OWNER}/${OTHER}`).set(true));
    await assertFails(stranger.ref(`following/${OWNER}/${OTHER}`).set(true));
  });

  test('unauthenticated cannot follow', async () => {
    await assertFails(anon.ref(`followers/${OWNER}/${STRANGER}`).set(true));
  });

  test('WIPE: the social graph survives', async () => {
    await seed(env, { [`followers/${OWNER}/${STRANGER}`]: true, [`following/${STRANGER}/${OWNER}`]: true });
    await assertFails(stranger.ref('followers').remove());
    await assertFails(stranger.ref('following').remove());
    await assertFails(stranger.ref(`followers/${OWNER}`).remove());
  });

  test('only booleans', async () => {
    await assertFails(stranger.ref(`followers/${OWNER}/${STRANGER}`).set({ a: 'b' }));
  });
});

describe('LB-5 · square_presence', () => {
  test('LEGITIMATE: a reader sets their own presence (square/page.js:830)', async () => {
    await assertSucceeds(owner.ref(`square_presence/${OWNER}`).set(true));
  });
  test("cannot set another reader's presence, cannot wipe the node", async () => {
    await assertFails(stranger.ref(`square_presence/${OWNER}`).set(true));
    await seed(env, { [`square_presence/${OWNER}`]: true });
    await assertFails(stranger.ref('square_presence').remove());
  });
});

describe('LB-5 · square_posts', () => {
  const POST = 'post1';
  // R33.1: authorName was 'R', which the new impersonation validate correctly rejects —
  // it is not a name this reader holds anywhere. 'Reader' is what the client actually
  // writes when a reader has no displayName (square/page.js:955), so the fixture is now
  // both valid and more faithful than it was.
  const post = (uid) => ({
    authorUid: uid, authorName: 'Reader', authorInitials: 'R', createdAt: now(),
    text: 'hello', likeCount: 0, isAuthor: false, authorReadCount: 0,
  });

  test('unauthenticated cannot post; authorUid cannot be forged', async () => {
    await assertFails(anon.ref(`square_posts/${POST}`).set(post(OWNER)));
    await assertFails(stranger.ref(`square_posts/${POST}`).set(post(OWNER)));
  });

  test('LEGITIMATE: create, then edit your own (square/page.js:966,1049)', async () => {
    await assertSucceeds(owner.ref(`square_posts/${POST}`).set(post(OWNER)));
    await assertSucceeds(owner.ref(`square_posts/${POST}/text`).set('edited'));
  });

  test("a stranger cannot edit or delete another author's post", async () => {
    await seed(env, { [`square_posts/${POST}`]: post(OWNER) });
    await assertFails(stranger.ref(`square_posts/${POST}/text`).set('defaced'));
    await assertFails(stranger.ref(`square_posts/${POST}`).remove());
  });

  test('LEGITIMATE: a moderator with the SWITCHES can pin and remove (R33.2)', async () => {
    // R33.2 — this used to pass on founder identity alone. Pinning and removal now flow
    // through canPin / canRemovePosts on the reader record, so the founder needs the
    // switches like anyone else. That is the point: the grant is not the identity.
    await seed(env, {
      [`square_posts/${POST}`]: post(OWNER),
      [`users/${FOUNDER_A}/canPin`]: true,
      [`users/${FOUNDER_A}/canRemovePosts`]: true,
    });
    await assertSucceeds(founder.ref(`square_posts/${POST}`).update({ pinned: true }));
    await assertSucceeds(founder.ref(`square_posts/${POST}`).remove());
  });

  test('REFUSED: a founder WITHOUT the switches can no longer pin or remove', async () => {
    await seed(env, { [`square_posts/${POST}`]: post(OWNER) });
    await assertFails(founder.ref(`square_posts/${POST}`).update({ pinned: true }));
    await assertFails(founder.ref(`square_posts/${POST}`).remove());
  });

  test('LEGITIMATE: a STRANGER bumps likeCount — the trap that would have broken every like', async () => {
    // toggleReaction runs a transaction on ANOTHER user's post (square:1015).
    // An author-only rule passes a denial-only suite and breaks the product.
    await seed(env, { [`square_posts/${POST}`]: post(OWNER) });
    await assertSucceeds(stranger.ref(`square_posts/${POST}/likeCount`).set(1));
    await assertSucceeds(stranger.ref(`square_posts/${POST}/fireCount`).set(1));
  });

  test('counters are bounded to non-negative numbers', async () => {
    await seed(env, { [`square_posts/${POST}`]: post(OWNER) });
    await assertFails(stranger.ref(`square_posts/${POST}/likeCount`).set('lots'));
    await assertFails(stranger.ref(`square_posts/${POST}/likeCount`).set(-5));
  });

  test('LEGITIMATE: poll voting under your own uid only (square/page.js:197)', async () => {
    await seed(env, { [`square_posts/${POST}`]: post(OWNER) });
    await assertSucceeds(stranger.ref(`square_posts/${POST}/poll/votes/${STRANGER}`).set('1'));
    await assertFails(stranger.ref(`square_posts/${POST}/poll/votes/${OWNER}`).set('1'));
  });

  test('WIPE: the feed survives', async () => {
    await seed(env, { [`square_posts/${POST}`]: post(OWNER) });
    await assertFails(stranger.ref('square_posts').remove());
    await assertFails(anon.ref('square_posts').remove());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R33.1 · THE IMPERSONATION FIELDS
//
// A reader could publish a post rendering ANOTHER reader's name, picture and the
// verified-writer tick: authorUid is enforced by .write, but authorName,
// authorAvatarUrl and isAuthor were unvalidated and the Square renders exactly
// what the post carries. Closed the night of the Summer Reading Program
// announcement, deliberately narrowly — these three children only.
//
// THE POSITIVE CASES ARE THE POINT. A rule that only proves the refusal is half
// tested, and the untested half is the one that empties the room at 20:05. Every
// shape the client can actually produce is asserted to still write: the full
// payload field for field, a reply, a reaction, a pin, a delete, and each of the
// four sources a legitimate authorName can come from.
describe('R33.1 · square_posts impersonation fields', () => {
  const P = 'r331post';

  // Exactly what square/page.js:953-966 sends, field for field. Firebase strips
  // nulls on write, so the null-valued keys below are the client's own literals
  // and simply do not reach the rules — which is itself part of what is asserted.
  const fullPost = (uid, over = {}) => ({
    text: 'a real post',
    authorUid: uid,
    authorName: 'Reader',
    authorInitials: 'RE',
    authorAvatarUrl: null,
    authorHandle: '',
    authorReadCount: 0,
    isAuthor: false,
    attachedStory: null,
    parentId: null,
    likeCount: 0,
    pinned: false,
    unpinnedAt: null,
    quotedPostId: null,
    createdAt: now(),
    ...over,
  });

  // square/page.js:988-996 — thirteen keys, no attachedStory, no quotedPostId.
  const fullReply = (uid, over = {}) => ({
    text: 'a real reply',
    authorUid: uid,
    authorName: 'Reader',
    authorInitials: 'RE',
    authorAvatarUrl: null,
    authorHandle: '',
    authorReadCount: 0,
    isAuthor: false,
    parentId: P,
    likeCount: 0,
    pinned: false,
    unpinnedAt: null,
    createdAt: now(),
    ...over,
  });

  const avatarOf = (uid, token = 'tok1') =>
    `https://firebasestorage.googleapis.com/v0/b/calvary.appspot.com/o/avatars%2F${uid}?alt=media&token=${token}`;

  // ── the four legitimate sources of a name ────────────────────────────────
  test('LEGITIMATE: name from the AUTH TOKEN, with no users record at all', async () => {
    // 138 live accounts are exactly this shape: an auth displayName and no
    // users/{uid}/displayName. Pinning the rule to the record would reject them.
    const ctx = env.authenticatedContext(OWNER, { name: 'Emily Parker' }).database();
    await assertSucceeds(ctx.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorName: 'Emily Parker' })));
  });

  test('LEGITIMATE: name from the users RECORD when the token is stale', async () => {
    // Both rename paths write auth AND users/{uid}/displayName together
    // (profile/page.js:619-620), but the ID token keeps the old name for up to an
    // hour. The record fallback is what stops that window rejecting the post.
    await seed(env, { [`users/${OWNER}/displayName`]: 'Renamed Reader' });
    const ctx = env.authenticatedContext(OWNER, { name: 'Old Name' }).database();
    await assertSucceeds(ctx.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorName: 'Renamed Reader' })));
  });

  test('LEGITIMATE: name from handle, from username, and the Reader fallback', async () => {
    await seed(env, { [`users/${OWNER}/handle`]: 'quietreader', [`users/${OWNER}/username`]: 'quiet_r' });
    await assertSucceeds(owner.ref(`square_posts/${P}a`).set(fullPost(OWNER, { authorName: 'quietreader' })));
    await assertSucceeds(owner.ref(`square_posts/${P}b`).set(fullPost(OWNER, { authorName: 'quiet_r' })));
    await assertSucceeds(owner.ref(`square_posts/${P}c`).set(fullPost(OWNER, { authorName: 'Reader' })));
  });

  // ── avatar ───────────────────────────────────────────────────────────────
  test('LEGITIMATE: own avatar, and a re-uploaded one with a fresh token', async () => {
    await seed(env, { [`users/${OWNER}/avatarUrl`]: avatarOf(OWNER, 'tok1') });
    await assertSucceeds(owner.ref(`square_posts/${P}a`).set(fullPost(OWNER, { authorAvatarUrl: avatarOf(OWNER, 'tok1') })));
    // Re-uploading to avatars/{uid} mints a new token; the record the Square holds
    // in memory is then stale. Path-scoping is what keeps that write alive.
    await assertSucceeds(owner.ref(`square_posts/${P}b`).set(fullPost(OWNER, { authorAvatarUrl: avatarOf(OWNER, 'tok2') })));
  });

  test('LEGITIMATE: no avatar at all — the null is stripped and never validated', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(fullPost(OWNER)));
  });

  // ── the tick ─────────────────────────────────────────────────────────────
  test('LEGITIMATE: isAuthor false always passes, including for a founder', async () => {
    // users/{uid}/isAuthor is UNSET on almost every account, both founders
    // included, and the client writes `userData?.isAuthor || false`.
    await assertSucceeds(owner.ref(`square_posts/${P}a`).set(fullPost(OWNER)));
    await assertSucceeds(founder.ref(`square_posts/${P}b`).set(fullPost(FOUNDER_A)));
  });

  test('LEGITIMATE: isAuthor true when the record actually says so', async () => {
    await seed(env, { [`users/${OWNER}/isAuthor`]: true });
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { isAuthor: true })));
  });

  // ── the whole room still works ───────────────────────────────────────────
  test('LEGITIMATE: reply, react, pin, edit and delete all survive the change', async () => {
    await seed(env, { [`users/${FOUNDER_A}/canPin`]: true });
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(fullPost(OWNER)));
    await assertSucceeds(stranger.ref(`square_posts/${P}r`).set(fullReply(STRANGER)));
    await assertSucceeds(stranger.ref(`square_posts/${P}/likeCount`).set(1));
    await assertSucceeds(founder.ref(`square_posts/${P}`).update({ pinned: true }));
    await assertSucceeds(owner.ref(`square_posts/${P}/text`).set('edited'));
    await assertSucceeds(owner.ref(`square_posts/${P}`).remove());
  });

  test('LEGITIMATE: a post carrying a poll still writes', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(
      fullPost(OWNER, { poll: { question: 'which?', options: ['a', 'b'], votes: {} } })
    ));
  });

  // ── THE HOLE ─────────────────────────────────────────────────────────────
  test('REFUSED: posting under another reader\'s name', async () => {
    await seed(env, { [`users/${STRANGER}/displayName`]: 'Ikenna Okpara' });
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorName: 'Ikenna Okpara' })));
  });

  test('REFUSED: posting with another reader\'s picture', async () => {
    await seed(env, { [`users/${STRANGER}/avatarUrl`]: avatarOf(STRANGER) });
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorAvatarUrl: avatarOf(STRANGER) })));
  });

  test('REFUSED: claiming the verified-writer tick', async () => {
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { isAuthor: true })));
  });

  test('REFUSED: claiming the tick when the record says false', async () => {
    await seed(env, { [`users/${OWNER}/isAuthor`]: false });
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { isAuthor: true })));
  });

  test('REFUSED: the same three forgeries on a REPLY, not just a post', async () => {
    await seed(env, { [`users/${STRANGER}/displayName`]: 'Ikenna Okpara' });
    await assertFails(owner.ref(`square_posts/${P}x`).set(fullReply(OWNER, { authorName: 'Ikenna Okpara' })));
    await assertFails(owner.ref(`square_posts/${P}y`).set(fullReply(OWNER, { isAuthor: true })));
    await assertFails(owner.ref(`square_posts/${P}z`).set(fullReply(OWNER, { authorAvatarUrl: avatarOf(STRANGER) })));
  });

  test('REFUSED: patching a forged identity onto a post after the fact', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(fullPost(OWNER)));
    await assertFails(owner.ref(`square_posts/${P}/isAuthor`).set(true));
    await assertFails(owner.ref(`square_posts/${P}/authorAvatarUrl`).set(avatarOf(STRANGER)));
  });

  // ── R33.1a · authorHandle ────────────────────────────────────────────────
  //
  // The fourth field, and the strongest signal on the surface: a reader could
  // still post showing @byokpara.
  //
  // PINNED TO THE INDEX, NOT THE RECORD, and that is the whole finding. The
  // obvious rule — match users/{uid}/username, which is what the client writes
  // verbatim — is worthless: that field is owner-writable (users/$uid/username
  // .write is `auth.uid == $uid`) with no uniqueness check anywhere, so a reader
  // sets their own username to 'byokpara' and posts as him. usernames/{handle}
  // IS uniqueness-enforced (it refuses a write when the key already belongs to
  // someone else), so it is the only real authority on who owns a handle.
  test('LEGITIMATE: the handle the usernames index says you own', async () => {
    await seed(env, { 'usernames/quietreader': OWNER, [`users/${OWNER}/username`]: 'quietreader' });
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorHandle: 'quietreader' })));
    await assertSucceeds(owner.ref(`square_posts/${P}r`).set(fullReply(OWNER, { authorHandle: 'quietreader' })));
  });

  test('LEGITIMATE: the empty string — 72% of accounts have no username at all', async () => {
    // The client writes `userData?.username || ''` (square/page.js:957). 246 of
    // 343 live accounts hold no username, and 16 live posts carry ''.
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorHandle: '' })));
    await assertSucceeds(owner.ref(`square_posts/${P}r`).set(fullReply(OWNER, { authorHandle: '' })));
  });

  test('LEGITIMATE: the key absent entirely — 11 live posts pre-date the field', async () => {
    const { authorHandle, ...noHandle } = fullPost(OWNER);
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(noHandle));
  });

  test('REFUSED: posting under another reader\'s handle', async () => {
    await seed(env, { 'usernames/byokpara': STRANGER });
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorHandle: 'byokpara' })));
  });

  test('REFUSED: THE ESCALATION — claiming a handle on your OWN record only', async () => {
    // users/$uid/username is owner-writable and not unique, so this is the route
    // a record-pinned rule would have left wide open. The index is what refuses.
    await seed(env, {
      'usernames/byokpara': STRANGER,
      [`users/${OWNER}/username`]: 'byokpara',
      [`users/${OWNER}/handle`]: 'byokpara',
    });
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorHandle: 'byokpara' })));
  });

  test('REFUSED: a handle nobody has claimed', async () => {
    await seed(env, { [`users/${OWNER}/username`]: 'ghosthandle' });
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorHandle: 'ghosthandle' })));
  });

  test('REFUSED: forged handle on a reply, and patched on after the fact', async () => {
    await seed(env, { 'usernames/byokpara': STRANGER });
    await assertFails(owner.ref(`square_posts/${P}x`).set(fullReply(OWNER, { authorHandle: 'byokpara' })));
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(fullPost(OWNER)));
    await assertFails(owner.ref(`square_posts/${P}/authorHandle`).set('byokpara'));
  });

  test('REFUSED: a path-shaped handle cannot traverse the index', async () => {
    await seed(env, { 'usernames/byokpara': OWNER });
    await assertFails(owner.ref(`square_posts/${P}`).set(fullPost(OWNER, { authorHandle: 'usernames/byokpara' })));
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// R33.2 · THE REMAINING HOLES, AND THE THREE SWITCHES
//
// Positives first, as ever. Two of these were caught BY the positives and would
// have shipped broken from a denial-only suite:
//   · the first fire/clap reaction on a post writes 1 where NO counter exists —
//     an "on create it must be 0" rule breaks every first reaction.
//   · 2 of 28 live replies already exceed the new 300 cap, so a flat cap would
//     make them permanently uneditable.
describe('R33.2 · caps, counters, clock, and the switches', () => {
  const P = 'r332post';
  const mk = (uid, over = {}) => ({
    authorUid: uid, authorName: 'Reader', authorInitials: 'RE', createdAt: now(),
    text: 'hello', likeCount: 0, isAuthor: false, authorReadCount: 0, authorHandle: '', ...over,
  });

  // ── character caps ───────────────────────────────────────────────────────
  test('LEGITIMATE: a 500-char post and a 300-char reply both write', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}a`).set(mk(OWNER, { text: 'x'.repeat(500) })));
    await assertSucceeds(owner.ref(`square_posts/${P}b`).set(mk(OWNER, { text: 'y'.repeat(300), parentId: P })));
  });

  test('LEGITIMATE: an over-cap reply that ALREADY EXISTS can still be shortened', async () => {
    // 2 live replies are 349 and 353 chars, both by the house account. A flat cap
    // would freeze them forever; the grandfather clause lets an edit through so
    // long as it does not grow.
    await seed(env, { [`square_posts/${P}`]: mk(OWNER, { text: 'z'.repeat(353), parentId: 'parent1' }) });
    await assertSucceeds(owner.ref(`square_posts/${P}/text`).set('z'.repeat(340)));
    await assertSucceeds(owner.ref(`square_posts/${P}/text`).set('short again'));
  });

  test('REFUSED: 501 on a post, 301 on a reply, and growing an over-cap reply', async () => {
    await assertFails(owner.ref(`square_posts/${P}a`).set(mk(OWNER, { text: 'x'.repeat(501) })));
    await assertFails(owner.ref(`square_posts/${P}b`).set(mk(OWNER, { text: 'y'.repeat(301), parentId: P })));
    await seed(env, { [`square_posts/${P}c`]: mk(OWNER, { text: 'z'.repeat(353), parentId: 'p1' }) });
    await assertFails(owner.ref(`square_posts/${P}c/text`).set('z'.repeat(354)));
  });

  // ── the counters ─────────────────────────────────────────────────────────
  test('LEGITIMATE: a stranger reacts — the trap, in all three shapes', async () => {
    await seed(env, { [`square_posts/${P}`]: mk(OWNER) });
    await assertSucceeds(stranger.ref(`square_posts/${P}/likeCount`).set(1));   // 0 -> 1
    await assertSucceeds(stranger.ref(`square_posts/${P}/fireCount`).set(1));   // absent -> 1, FIRST ever
    await assertSucceeds(stranger.ref(`square_posts/${P}/clapCount`).set(0));   // absent -> 0
    await assertSucceeds(stranger.ref(`square_posts/${P}/likeCount`).set(0));   // un-react
  });

  test('REFUSED: an arbitrary count, a jump, and a negative', async () => {
    await seed(env, { [`square_posts/${P}`]: mk(OWNER, { likeCount: 5 }) });
    await assertFails(stranger.ref(`square_posts/${P}/likeCount`).set(9999));
    await assertFails(stranger.ref(`square_posts/${P}/likeCount`).set(7));
    await assertFails(stranger.ref(`square_posts/${P}/likeCount`).set(-1));
    await assertFails(stranger.ref(`square_posts/${P}/fireCount`).set(50));
  });

  // ── the clock: the horizon's attack surface ──────────────────────────────
  test('LEGITIMATE: a post dated now, and one a few minutes off a skewed clock', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}a`).set(mk(OWNER, { createdAt: Date.now() })));
    await assertSucceeds(owner.ref(`square_posts/${P}b`).set(mk(OWNER, { createdAt: Date.now() + 120000 })));
    await assertSucceeds(owner.ref(`square_posts/${P}c`).set(mk(OWNER, { createdAt: Date.now() - 86400000 })));
  });

  test('REFUSED: a post dated into the future never ages out', async () => {
    await assertFails(owner.ref(`square_posts/${P}`).set(mk(OWNER, { createdAt: Date.now() + 400000 })));
    await assertFails(owner.ref(`square_posts/${P}`).set(mk(OWNER, { createdAt: Date.now() + 31536000000 })));
  });

  // ── the last two identity fields ─────────────────────────────────────────
  test('LEGITIMATE: initials, and a read count at or below the record', async () => {
    await seed(env, { [`users/${OWNER}/readCount`]: 124 });
    await assertSucceeds(owner.ref(`square_posts/${P}a`).set(mk(OWNER, { authorReadCount: 124 })));
    // A stale lower value is harmless — the badge under-reports. This is why the
    // rule is <= and not ===: the Square reads users/{uid} once at page load, and
    // a reader who finishes a story in another tab would otherwise be refused.
    await assertSucceeds(owner.ref(`square_posts/${P}b`).set(mk(OWNER, { authorReadCount: 90 })));
    // 72 accounts hold no readCount at all and the client writes 0.
    await assertSucceeds(stranger.ref(`square_posts/${P}c`).set(mk(STRANGER, { authorReadCount: 0 })));
  });

  test('REFUSED: claiming a standing you have not earned, or arbitrary initials', async () => {
    await seed(env, { [`users/${OWNER}/readCount`]: 12 });
    await assertFails(owner.ref(`square_posts/${P}a`).set(mk(OWNER, { authorReadCount: 9999 })));
    await assertFails(stranger.ref(`square_posts/${P}b`).set(mk(STRANGER, { authorReadCount: 500 })));
    await assertFails(owner.ref(`square_posts/${P}c`).set(mk(OWNER, { authorInitials: 'IKENNA OKPARA' })));
  });

  // ── pinning: permanence, and the reason it had to close first ────────────
  test('LEGITIMATE: pinned:false from anyone; pinned:true with canPin', async () => {
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(mk(OWNER, { pinned: false })));
    await seed(env, { [`users/${STRANGER}/canPin`]: true });
    await assertSucceeds(stranger.ref(`square_posts/${P}/pinned`).set(true));
  });

  test('REFUSED: pinning your own post without the switch', async () => {
    // Under the horizon a pin confers permanence, so this had to close first.
    await assertFails(owner.ref(`square_posts/${P}`).set(mk(OWNER, { pinned: true })));
    await assertSucceeds(owner.ref(`square_posts/${P}`).set(mk(OWNER)));
    await assertFails(owner.ref(`square_posts/${P}/pinned`).set(true));
  });

  // ── removal by switch, not identity ──────────────────────────────────────
  test('LEGITIMATE: canRemovePosts removes another reader\'s post; the author always can', async () => {
    await seed(env, { [`square_posts/${P}a`]: mk(OWNER), [`square_posts/${P}b`]: mk(OWNER),
                      [`users/${STRANGER}/canRemovePosts`]: true });
    await assertSucceeds(stranger.ref(`square_posts/${P}a`).remove());
    await assertSucceeds(owner.ref(`square_posts/${P}b`).remove());
  });

  test('REFUSED: removing someone else\'s post without the switch', async () => {
    await seed(env, { [`square_posts/${P}`]: mk(OWNER) });
    await assertFails(stranger.ref(`square_posts/${P}`).remove());
  });

  // ── the switches themselves ──────────────────────────────────────────────
  test('LEGITIMATE: a founder grants each switch independently', async () => {
    for (const f of ['canPostImages', 'canPin', 'canRemovePosts']) {
      await assertSucceeds(founder.ref(`users/${OWNER}/${f}`).set(true));
      await assertSucceeds(founder.ref(`users/${OWNER}/${f}`).set(false));
    }
  });

  test('REFUSED: nobody grants themselves a switch', async () => {
    for (const f of ['canPostImages', 'canPin', 'canRemovePosts']) {
      await assertFails(owner.ref(`users/${OWNER}/${f}`).set(true));
      await assertFails(stranger.ref(`users/${OWNER}/${f}`).set(true));
      await assertFails(anon.ref(`users/${OWNER}/${f}`).set(true));
      await assertFails(owner.ref(`users/${OWNER}`).update({ bio: 'ok', [f]: true }));
    }
  });

  test('THE SWITCHES ARE INDEPENDENT — the whole reason there are three', async () => {
    // The failure this shape exists to prevent: granting someone images and
    // thereby handing them deletion.
    await seed(env, { [`square_posts/${P}`]: mk(OWNER), [`users/${STRANGER}/canPostImages`]: true });
    await assertFails(stranger.ref(`square_posts/${P}`).remove());
    await assertFails(stranger.ref(`square_posts/${P}/pinned`).set(true));
  });

  test('canPin may pin — but NOT delete, and NOT rewrite the words', async () => {
    // Pinning someone else's post needs write access to it. Granting that naively
    // would have handed a pinner deletion and content edits, which is exactly the
    // conflation the three switches exist to prevent.
    await seed(env, { [`square_posts/${P}`]: mk(OWNER), [`users/${STRANGER}/canPin`]: true });
    await assertSucceeds(stranger.ref(`square_posts/${P}/pinned`).set(true));
    await assertFails(stranger.ref(`square_posts/${P}`).remove());
    await assertFails(stranger.ref(`square_posts/${P}/text`).set('defaced'));
    await assertFails(stranger.ref(`square_posts/${P}/authorUid`).set(STRANGER));
  });
});

describe('LB-5 · square_reactions / square_likes', () => {
  test('LEGITIMATE: react under your own uid (square/page.js:1009)', async () => {
    await assertSucceeds(owner.ref(`square_reactions/p1/like/${OWNER}`).set(true));
    await assertSucceeds(owner.ref(`square_likes/p1/${OWNER}`).set(true));
  });
  test("cannot react as another reader", async () => {
    await assertFails(stranger.ref(`square_reactions/p1/like/${OWNER}`).set(true));
    await assertFails(stranger.ref(`square_likes/p1/${OWNER}`).set(true));
  });
  test('WIPE: every reaction in the product survives', async () => {
    await seed(env, { [`square_reactions/p1/like/${OWNER}`]: true, [`square_likes/p1/${OWNER}`]: true });
    await assertFails(stranger.ref('square_reactions').remove());
    await assertFails(stranger.ref('square_likes').remove());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LB-13 · comments', () => {
  const SLUG = 'a-story';
  const C = 'c1';
  const comment = (uid) => ({ text: 'nice', authorName: 'R', authorUid: uid, createdAt: now() });

  test('LEGITIMATE: post a comment (page-client.js:650)', async () => {
    await assertSucceeds(owner.ref(`comments/${SLUG}/${C}`).set(comment(OWNER)));
  });

  test('LEGITIMATE: any reader hearts it — deliberately open, but bounded', async () => {
    await seed(env, { [`comments/${SLUG}/${C}`]: comment(OWNER) });
    await assertSucceeds(stranger.ref(`comments/${SLUG}/${C}/heartCount`).set(1));
    await assertFails(stranger.ref(`comments/${SLUG}/${C}/heartCount`).set('many'));
    await assertFails(stranger.ref(`comments/${SLUG}/${C}/heartCount`).set(-5));
  });

  test('LEGITIMATE: reply under your own authorUid; forging it fails', async () => {
    await seed(env, { [`comments/${SLUG}/${C}`]: comment(OWNER) });
    await assertSucceeds(stranger.ref(`comments/${SLUG}/${C}/replies/r1`).set({
      text: 'agreed', authorName: 'S', authorUid: STRANGER, createdAt: now(),
    }));
    await assertFails(stranger.ref(`comments/${SLUG}/${C}/replies/r2`).set({
      text: 'forged', authorName: 'O', authorUid: OWNER, createdAt: now(),
    }));
  });

  test("a stranger cannot edit another reader's comment", async () => {
    await seed(env, { [`comments/${SLUG}/${C}`]: comment(OWNER) });
    await assertFails(stranger.ref(`comments/${SLUG}/${C}/text`).set('defaced'));
  });

  test('WIPE: a slug\'s comments survive', async () => {
    await seed(env, { [`comments/${SLUG}/${C}`]: comment(OWNER) });
    await assertFails(stranger.ref(`comments/${SLUG}`).remove());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('bookstore_purchases — money (owned by the bookstore session; asserted, not changed)', () => {
  test('a reader may read only their own purchases, and NOBODY may write', async () => {
    await seed(env, { [`bookstore_purchases/${OWNER}/a-title`]: { status: 'active', purchasedAt: now() } });
    await assertSucceeds(owner.ref(`bookstore_purchases/${OWNER}`).get());
    await assertFails(stranger.ref(`bookstore_purchases/${OWNER}`).get());
    await assertFails(anon.ref(`bookstore_purchases/${OWNER}`).get());
    // Only the webhooks write, on a service-account token that bypasses rules.
    await assertFails(owner.ref(`bookstore_purchases/${OWNER}/a-title/status`).set('active'));
    await assertFails(stranger.ref(`bookstore_purchases/${OWNER}/b-title`).set({ status: 'active' }));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R11.23 — THE WIPE, which is case 3 of the four-case template and was the one missing.
  //
  // The test above writes to CHILDREN. The Story Island app's account-deletion path does not:
  // it attempts `bookstore_purchases/{uid} = null` on the NODE, deliberately outside its main
  // atomic update and in its own try/catch, because nobody had ever confirmed which way the
  // rules answer it. That gap matters more here than the shape of it suggests — `.validate`
  // never runs on a null write, so a node-level grant deletes a subtree without a single
  // validator firing, and a child-write test cannot see it. A rule of the form
  // `auth.uid == $uid && !newData.exists()` passes every assertion above and hands a client
  // the power to erase its own purchase history.
  //
  // THE ANSWER IS DENIED, in all three shapes the client can spell it. That is the intended
  // ruling and these tests are what keep it: the node is written only by the webhooks, on a
  // service-account token that bypasses rules entirely.
  //
  // The consequence is recorded here because it is the reason anyone will read this block:
  // nothing deletes these records. Not the app (denied), not the web (its deletion flow only
  // writes users/{uid}/pendingDeletion, which nothing in this repo consumes), not a sweep
  // (there isn't one). Purchase records outlive the accounts that made them TODAY, and if that
  // is ever changed it must be changed server-side — see the last two cases, which pin both
  // halves of that: a client can enumerate but not erase, and an admin token can erase.
  //
  // Whether erasure is even the right outcome is an open question and not one this file
  // answers: these are financial records, a late refund needs something to mark 'revoked'
  // against, and retention obligations cut against deletion. Severing the identity while
  // keeping the transaction is the likelier shape. Nothing here presumes either way.
  // ─────────────────────────────────────────────────────────────────────────
  describe('the WIPE — the account-deletion write, in every shape a client can spell it', () => {
    const purchase = { status: 'active', purchasedAt: 1786000000000 };

    test('the owner cannot set(null) their OWN purchases node', async () => {
      await seed(env, { [`bookstore_purchases/${OWNER}/a-title`]: purchase });
      await assertFails(owner.ref(`bookstore_purchases/${OWNER}`).set(null));
    });

    test('nor remove() it — the same denial, reached by the other method name', async () => {
      await seed(env, { [`bookstore_purchases/${OWNER}/a-title`]: purchase });
      await assertFails(owner.ref(`bookstore_purchases/${OWNER}`).remove());
    });

    test('nor smuggle it through a multi-path update at the root', async () => {
      // The shape that would ride along inside an atomic account-deletion update. It is kept
      // separate in the app precisely because it would fail the whole update — this asserts
      // that reading of it, so the app is never tempted to fold it back in.
      await seed(env, { [`bookstore_purchases/${OWNER}/a-title`]: purchase });
      await assertFails(owner.ref().update({ [`bookstore_purchases/${OWNER}`]: null }));
    });

    test('but the owner CAN still read it — a client may enumerate what it cannot erase', async () => {
      // Not a consolation prize: /my-library reads this node, so a denial here would be an
      // outage. It is also what makes a client-side "what would be deleted" list possible.
      await seed(env, { [`bookstore_purchases/${OWNER}/a-title`]: purchase });
      await assertSucceeds(owner.ref(`bookstore_purchases/${OWNER}`).get());
    });

    test('an admin uid CAN wipe the node — a server-side sweep has a path when one is built', async () => {
      await seed(env, { [`bookstore_purchases/${OWNER}/a-title`]: purchase });
      await assertSucceeds(founder.ref(`bookstore_purchases/${OWNER}`).set(null));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R11.22 · bookstore_reading_progress — the position, and the pin that qualifies it.
//
// The node had NO coverage here before this round, which is why the block is the full
// four-case template rather than only the new field: a rules change to an untested node is
// two changes, and the second one is silent.
//
// WHAT THE PIN IS. `epubVersion` is the Cloud Storage generation of that title's master.epub
// — the same string functions/api/bookstore/stream.js already returns as `version` and the
// native app already keys its download cache by. It changes when and only when the object is
// replaced. A CFI without it is coordinates with no statement of which document they index.
//
// WHY THE VALIDATOR IS SHAPE-ONLY, and this is the deliberate part: it is a string with a
// length bound, NOT a digits-only match on a generation. Both surfaces write this record. A
// tight validator would turn a foreign or future pin format into a REJECTED WRITE, which
// fails the whole `set` and loses the reader's position outright. A permissive one turns the
// same case into a pin that simply does not match, which every reader already handles by
// falling back to fraction. Degrade, don't refuse — the loose rule is the safer rule here,
// and the value's provenance is a contract (docs/reading-position-pin.md), not a regex.
describe('R11.22 · bookstore_reading_progress — the reading position and its pin', () => {
  const pos = (extra = {}) => ({ fraction: 0.42, updatedAt: now(), ...extra });
  const VERSION = '1723459000123456';   // a GCS generation: decimal, and far past 2^53
  const path = `bookstore_reading_progress/${OWNER}/a-title`;

  test('unauthenticated can neither read nor write', async () => {
    await seed(env, { [path]: pos({ cfi: 'epubcfi(/6/4!/4/2/2,/1:0,/1:12)' }) });
    await assertFails(anon.ref(path).get());
    await assertFails(anon.ref(path).set(pos()));
  });

  test('a stranger cannot read or write another reader\'s position', async () => {
    await seed(env, { [path]: pos() });
    await assertFails(stranger.ref(path).get());
    await assertFails(stranger.ref(`bookstore_reading_progress/${OWNER}`).get());
    await assertFails(stranger.ref(path).set(pos()));
  });

  test('WIPE: nobody but the owner may empty the node', async () => {
    await seed(env, { [path]: pos() });
    await assertFails(anon.ref('bookstore_reading_progress').remove());
    await assertFails(stranger.ref(`bookstore_reading_progress/${OWNER}`).remove());
  });

  test('LEGITIMATE: the owner writes position + cfi + pin, and reads it back', async () => {
    // Case 4 — exactly what the auto-save in app/reader/[slug]/ReadingRoom.js issues once
    // book-reader.js has a version from the stream endpoint.
    await assertSucceeds(owner.ref(path).set(pos({
      cfi: 'epubcfi(/6/4!/4/2/2,/1:0,/1:12)',
      epubVersion: VERSION,
    })));
    await assertSucceeds(owner.ref(path).get());
  });

  test('LEGITIMATE: the unpinned record still writes — the pin is optional, not required', async () => {
    // The version lookup can fail (the endpoint states `version: null` rather than guessing),
    // and every position stored before R11.22 is unpinned. Requiring the field would have
    // rejected both, which is how a safety feature becomes an outage.
    await assertSucceeds(owner.ref(path).set(pos({ cfi: 'epubcfi(/6/4!/4/2/2)' })));
    await assertSucceeds(owner.ref(path).set(pos()));
  });

  test('the pin must be a non-empty string, and the record stays closed to strays', async () => {
    await assertFails(owner.ref(path).set(pos({ cfi: 'epubcfi(/6/4)', epubVersion: 1723459000123456 })));
    await assertFails(owner.ref(path).set(pos({ cfi: 'epubcfi(/6/4)', epubVersion: '' })));
    await assertFails(owner.ref(path).set(pos({ cfi: 'epubcfi(/6/4)', epubVersion: 'x'.repeat(129) })));
    // $other is still closed — the new field is an addition to the shape, not an opening of it.
    await assertFails(owner.ref(path).set(pos({ epubGeneration: VERSION })));
    await assertFails(owner.ref(path).set({ cfi: 'epubcfi(/6/4)', epubVersion: VERSION }));  // no fraction
  });

  test('a foreign pin format is ACCEPTED by the rules — it is the reader that must not trust it', async () => {
    // The degrade-don't-refuse call, asserted so it cannot be "tightened" back into an
    // outage by someone reading the validator without the reason. A pin this surface cannot
    // match costs a fraction fallback; a rejected write costs the position itself.
    await assertSucceeds(owner.ref(path).set(pos({
      cfi: 'epubcfi(/6/4!/4/2/2)',
      epubVersion: 'sha256:9f2c4ab1-not-a-generation',
    })));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R9.1 LB-9 · bookstore_waitlist — the pre-launch mailing list.
//
// WHAT WAS WRONG: `.write: true` sat at the NODE ROOT. A root write grant is not merely
// "loose validation" — it is a wipe hole that no .validate can close, because .validate never
// runs on a null write. Anyone on the internet, signed in or not, could have emptied the
// launch mailing list with a single unauthenticated DELETE, and the .validate block sitting
// underneath it would not have been consulted. The fix moves .write DOWN to $entry and makes
// it CREATE-ONLY.
//
// THIS NODE IS DELIBERATELY WRITABLE BY ANONYMOUS VISITORS, which is why the standard
// four-case template is applied with its first case inverted. The gate is shown BEFORE
// sign-in — asking someone to create an account in order to join a mailing list about a shop
// that has not opened is not a product. So an unauthenticated CREATE is the legitimate write
// (case 4), and it is overwrite, delete and root-write that must fail.
//
// The shape asserted here was MEASURED against the live node before it was written, not
// assumed: 10 rows, of which the single push-id row {email, addedAt} is the only one any code
// in this repo produces (app/bookstore/components/LaunchGate.js). Neither field is ever sent
// as null by that writer, so hasChildren(['email','addedAt']) is safe — the null-stripping
// trap that broke imageUrl in R9.0 does not apply here, and it was checked rather than
// assumed. The other 9 rows are uid-keyed {joinedAt} written by something outside this repo;
// create-only leaves every one of them intact and immutable to clients.
describe('LB-9 · bookstore_waitlist — the launch mailing list', () => {
  const entry = () => ({ email: 'reader@example.com', addedAt: now() });

  test('the legitimate gate write is ACCEPTED — anonymous, create, push-id key', async () => {
    // Case 4, and the one that matters most: a denial-only suite passes happily while the
    // product is on fire. This is exactly what LaunchGate.js does.
    await assertSucceeds(anon.ref('bookstore_waitlist').push(entry()));
    await assertSucceeds(anon.ref('bookstore_waitlist/-NewPushIdAAAAAAAAAA').set(entry()));
    // And a signed-in reader can join too.
    await assertSucceeds(owner.ref('bookstore_waitlist/-NewPushIdBBBBBBBBBB').set(entry()));
  });

  test('ROOT-LEVEL WRITE is rejected — the hole this finding was about', async () => {
    await seed(env, { 'bookstore_waitlist/-Existing0000000000A': entry() });
    // A wholesale set() AT the node root. This is the shape that used to be allowed, and the
    // one that could replace the entire mailing list in a single request.
    await assertFails(anon.ref('bookstore_waitlist').set({ '-x': entry() }));
    await assertFails(owner.ref('bookstore_waitlist').set({ '-x': entry() }));
    await assertFails(founder.ref('bookstore_waitlist').set({ '-x': entry() }));
  });

  test('update() at the root fans out per child — it can create, never overwrite or delete', async () => {
    // NOT A HOLE, and worth stating because it looks like one. RTDB evaluates a multi-path
    // update() against each CHILD path independently, not against the node it was called on.
    // So update({'-new': …}) is precisely the legitimate create above and is allowed, while
    // the two dangerous shapes — overwriting an existing key, or nulling one — are each
    // evaluated at that key and refused by the same create-only rule.
    await seed(env, { 'bookstore_waitlist/-Existing0000000000A': entry() });

    await assertSucceeds(anon.ref('bookstore_waitlist').update({ '-BrandNewKey00000001': entry() }));
    await assertFails(anon.ref('bookstore_waitlist').update({ '-Existing0000000000A': entry() }));
    await assertFails(anon.ref('bookstore_waitlist').update({ '-Existing0000000000A': null }));
    // And a batch is atomic: one refused child refuses the whole update, so a create cannot
    // be used as cover for a delete.
    await assertFails(anon.ref('bookstore_waitlist').update({
      '-BrandNewKey00000002': entry(),
      '-Existing0000000000A': null,
    }));
  });

  test('WIPE is rejected — .validate never runs on a null write', async () => {
    await seed(env, { 'bookstore_waitlist/-Existing0000000000A': entry() });
    await assertFails(anon.ref('bookstore_waitlist').remove());
    await assertFails(owner.ref('bookstore_waitlist').remove());
    await assertFails(stranger.ref('bookstore_waitlist').remove());
    await assertFails(founder.ref('bookstore_waitlist').remove());
  });

  test('DELETE of a single entry is rejected', async () => {
    await seed(env, { 'bookstore_waitlist/-Existing0000000000A': entry() });
    await assertFails(anon.ref('bookstore_waitlist/-Existing0000000000A').remove());
    await assertFails(owner.ref('bookstore_waitlist/-Existing0000000000A').remove());
    await assertFails(anon.ref('bookstore_waitlist/-Existing0000000000A/email').remove());
  });

  test('OVERWRITE of an existing entry is rejected — create-only', async () => {
    await seed(env, { 'bookstore_waitlist/-Existing0000000000A': entry() });
    await assertFails(anon.ref('bookstore_waitlist/-Existing0000000000A').set(entry()));
    await assertFails(anon.ref('bookstore_waitlist/-Existing0000000000A/email').set('hijack@example.com'));
    await assertFails(owner.ref('bookstore_waitlist/-Existing0000000000A').update({ email: 'x@example.com' }));
  });

  test('the 9 legacy uid-keyed {joinedAt} rows survive and cannot be touched', async () => {
    // Measured on the live node: uid-shaped keys carrying only joinedAt, written by something
    // outside this repo. Create-only means they are frozen to clients rather than deleted.
    await seed(env, { [`bookstore_waitlist/${STRANGER}`]: { joinedAt: now() } });
    await assertFails(anon.ref(`bookstore_waitlist/${STRANGER}`).remove());
    await assertFails(stranger.ref(`bookstore_waitlist/${STRANGER}`).set({ joinedAt: now() }));
    // A NEW row of that shape is refused — nothing in the repo writes it, and the rule
    // describes what the product produces rather than what history left behind.
    await assertFails(anon.ref('bookstore_waitlist/-NewJoinedAtRow00000').set({ joinedAt: now() }));
  });

  test('READ stays founder-only — a mailing list is not public', async () => {
    await seed(env, { 'bookstore_waitlist/-Existing0000000000A': entry() });
    await assertFails(anon.ref('bookstore_waitlist').get());
    await assertFails(owner.ref('bookstore_waitlist').get());
    await assertFails(stranger.ref('bookstore_waitlist/-Existing0000000000A').get());
    await assertSucceeds(founder.ref('bookstore_waitlist').get());
  });

  test('the shape is bounded — junk fields, wrong types and bad addresses are refused', async () => {
    await assertFails(anon.ref('bookstore_waitlist/-r1').set({ email: 'reader@example.com' }));   // no addedAt
    await assertFails(anon.ref('bookstore_waitlist/-r2').set({ addedAt: now() }));                // no email
    await assertFails(anon.ref('bookstore_waitlist/-r3').set({ ...entry(), evil: 'payload' }));   // $other
    await assertFails(anon.ref('bookstore_waitlist/-r4').set({ email: 'reader@example.com', addedAt: 'now' }));
    await assertFails(anon.ref('bookstore_waitlist/-r5').set({ email: 42, addedAt: now() }));
    await assertFails(anon.ref('bookstore_waitlist/-r6').set({ email: 'reader@example.com', addedAt: -1 }));
    await assertFails(anon.ref('bookstore_waitlist/-r7').set('just-a-string'));
  });

  // ── THE TWO HALVES OF THE EMAIL CHECK MOVE TOGETHER ───────────────────────
  // isEmailShaped() in app/lib/bookstore/gate.js is the client half; the .validate on
  // bookstore_waitlist/$entry/email is the half a console cannot skip. Before R9.1 they were
  // NOT equivalent — the rule asked only contains('@'), so `a@b`, ` x@y.z` and `a@@b.c` were
  // all rule-legal while the gate rejected them. Anything the gate accepts the rule MUST
  // accept (or a reader hits a permission-denied they can do nothing about), and anything the
  // gate rejects the rule SHOULD reject (or the rule is not the backstop it claims to be).
  const ACCEPTED = [
    'reader@example.com',
    'a.b+tag@sub.example.co.uk',
    'x@y.zz',
  ];
  const REJECTED = [
    'a@b',                 // no dot in the domain — rule-legal before R9.1
    'no-at-sign.com',
    'two@@example.com',
    'trailing@example.',
    '@example.com',
    'spaced out@example.com',   // inner whitespace survives trim()
    'a@.com',
    'reader@exam ple.com',
  ];

  test('a padded address is accepted by the gate and stored trimmed', async () => {
    // The one asymmetry, and it is deliberate rather than a drift: isEmailShaped() trims
    // before testing and LaunchGate writes email.trim(), so the rule only ever sees the
    // trimmed form. The rule rejecting the padded form is therefore correct AND unreachable
    // from the product — asserted here so nobody "fixes" the rule to allow padding.
    assert.equal(isEmailShaped('  reader@example.com  '), true);
    await assertFails(anon.ref('bookstore_waitlist/-pad').set({ email: '  reader@example.com  ', addedAt: now() }));
    await assertSucceeds(anon.ref('bookstore_waitlist/-pad2').set({ email: '  reader@example.com  '.trim(), addedAt: now() }));
  });

  test('every address the gate accepts, the rule accepts', async () => {
    for (const [i, email] of ACCEPTED.entries()) {
      assert.equal(isEmailShaped(email), true, `gate must accept ${JSON.stringify(email)}`);
      await assertSucceeds(anon.ref(`bookstore_waitlist/-ok${i}`).set({ email, addedAt: now() }));
    }
  });

  test('every address the gate rejects, the rule rejects', async () => {
    for (const [i, email] of REJECTED.entries()) {
      assert.equal(isEmailShaped(email), false, `gate must reject ${JSON.stringify(email)}`);
      await assertFails(anon.ref(`bookstore_waitlist/-bad${i}`).set({ email, addedAt: now() }));
    }
  });

  test('length bounds match the gate exactly', async () => {
    const long = `${'a'.repeat(310)}@example.com`; // > 320
    assert.equal(isEmailShaped(long), false);
    await assertFails(anon.ref('bookstore_waitlist/-long').set({ email: long, addedAt: now() }));

    const short = 'a@b.c'; // exactly 5, the lower bound, and dotted
    assert.equal(isEmailShaped(short), true);
    await assertSucceeds(anon.ref('bookstore_waitlist/-short').set({ email: short, addedAt: now() }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R9.2 (a) · bookstore_titles/$titleId/territoriesAllowed — the licence the till keeps.
//
// WHAT WAS WRONG. The field was validated as `isString() || hasChildren()`, which is barely a
// validation at all: '' passed, 'worldwide' passed, 'no' passed, an object of arbitrary junk
// passed. And every one of those then read as WORLDWIDE downstream, because
// normaliseTerritories in app/lib/bookstore/territory.js resolves anything it does not
// recognise to worldwide — deliberately, and correctly, since a title whose rights field a bad
// migration flattened must not silently become unsellable everywhere.
//
// So the two halves compounded: the rule accepted a meaningless value and the matcher read a
// meaningless value as "sell it anywhere". A hand-edit in the Firebase console typing
// `worldwide` into the box, meaning worldwide, would have got worldwide — and a hand-edit
// typing `EU`, meaning the EU, would ALSO have got worldwide. That second case is a book sold
// into a territory its publisher did not license.
//
// THE FIX IS ON THE RULE, NOT THE MATCHER. R8.4 spent its length arguing why the matcher must
// resolve garbage permissively, and that argument still holds: the matcher's input is
// whatever is already in the database, and refusing to sell is not a safe default. The way to
// stop garbage being read is to stop it being STORED. So: a string must be exactly '*', a list
// must be a list of ISO 3166-1 alpha-2 codes, and there is no third shape.
//
// territoriesExcluded gets the same treatment in the same edit. The rules did not know it
// existed at all, and it is the field that decides where a worldwide licence does NOT reach.
//
// PARITY WITH schema.js. app/lib/bookstore/schema.js:164-173 has always enforced exactly this,
// and app/lib/bookstore/admin-writes.js runs it on every curator save. The rule was the loose
// half of a matched pair — the same shape of gap R9.1 LB-9 closed on the waitlist email. The
// rule is the half a console edit cannot skip, which is why it is the half that matters.
//
// SAFE ON THE LIVE CATALOGUE: all four titles carry territoriesAllowed '*' and no
// territoriesExcluded (read from the public node before the edit), so nothing already stored
// becomes unwritable.
// ═══════════════════════════════════════════════════════════════════════════

const TITLE_BASE = {
  schemaVersion: 3,
  slug: 'a-title',
  title: 'A Title',
  author: 'An Author',
  publisherId: 'calvary',
  synopsis: 'A synopsis.',
  prices: { gbp: 199 },
  genre: 'fiction',
  publishedDate: '2026-09-30',
  addedAt: 1,
  updatedAt: 1,
  status: 'published',
};
const titleWith = (extra) => ({ ...TITLE_BASE, ...extra });

describe('R9.2 · bookstore_titles territories', () => {
  test('the legitimate shapes still save — worldwide, and an allow-list', async () => {
    // CASE 4 FIRST. A tightening that breaks the curator is worse than the hole it closed,
    // and both live shapes are here.
    await assertSucceeds(founder.ref('bookstore_titles/t1').set(titleWith({ territoriesAllowed: '*' })));
    await assertSucceeds(founder.ref('bookstore_titles/t2').set(titleWith({ territoriesAllowed: ['GB', 'NG'] })));
    await assertSucceeds(founder.ref('bookstore_titles/t3').set(titleWith({
      territoriesAllowed: '*', territoriesExcluded: ['CA', 'US'],
    })));
  });

  test('THE FINDING: the strings that used to pass and mean worldwide', async () => {
    for (const value of ['', 'worldwide', 'WORLDWIDE', 'all', 'GB', 'no', '*worldwide', ' *']) {
      await assertFails(
        founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: value })),
        `territoriesAllowed ${JSON.stringify(value)} must not be storable`,
      );
    }
  });

  test("'*' is the only string, and it is exact", async () => {
    await assertSucceeds(founder.ref('bookstore_titles/ok').set(titleWith({ territoriesAllowed: '*' })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: '**' })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: '*,GB' })));
  });

  test('a list must be ISO 3166-1 alpha-2, upper case', async () => {
    await assertSucceeds(founder.ref('bookstore_titles/ok').set(titleWith({ territoriesAllowed: ['GB'] })));
    // Lower case is REJECTED rather than folded: admin-writes.js:112 uppercases before it
    // validates, so a curator's 'gb' is stored as 'GB' and never reaches the rule as 'gb'.
    // Anything that does reach it in lower case came from a console edit, which is exactly
    // what this rule exists to catch.
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: ['gb'] })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: ['GBR'] })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: ['G'] })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: ['GB', 'nope'] })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: [1, 2] })));
  });

  test('a non-string, non-list value cannot be stored', async () => {
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: 5 })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: true })));
  });

  test('the field cannot simply be omitted', async () => {
    // The parent hasChildren list already required it; asserted here so splitting the
    // validator out of that expression cannot have dropped the requirement.
    const { ...noTerritories } = TITLE_BASE;
    await assertFails(founder.ref('bookstore_titles/bad').set(noTerritories));
    // An empty list is the same thing: RTDB stores no empty containers, so the key vanishes.
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: [] })));
  });

  test('territoriesExcluded is validated too, or absent', async () => {
    await assertSucceeds(founder.ref('bookstore_titles/ok').set(titleWith({ territoriesAllowed: '*' })));
    await assertSucceeds(founder.ref('bookstore_titles/ok2').set(titleWith({
      territoriesAllowed: '*', territoriesExcluded: ['US'],
    })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', territoriesExcluded: ['us'],
    })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', territoriesExcluded: 'US',
    })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', territoriesExcluded: '*',
    })));
  });

  test('a single field cannot be edited around the validator', async () => {
    // The route a console edit actually takes: reach past the record and set the leaf.
    await seed(env, { 'bookstore_titles/t1': titleWith({ territoriesAllowed: ['GB'] }) });
    await assertFails(founder.ref('bookstore_titles/t1/territoriesAllowed').set('worldwide'));
    await assertFails(founder.ref('bookstore_titles/t1/territoriesAllowed/0').set('gb'));
    await assertSucceeds(founder.ref('bookstore_titles/t1/territoriesAllowed/0').set('NG'));
  });

  test('and none of this lets a non-founder near the catalogue', async () => {
    // The tightening must not have moved the permission boundary. It did not.
    await assertFails(owner.ref('bookstore_titles/t9').set(titleWith({ territoriesAllowed: '*' })));
    await assertFails(anon.ref('bookstore_titles/t9').set(titleWith({ territoriesAllowed: '*' })));
    await assertFails(stranger.ref('bookstore_titles').remove());
    // Read stays public — the storefront is anonymous.
    await seed(env, { 'bookstore_titles/t1': titleWith({ territoriesAllowed: '*' }) });
    await assertSucceeds(anon.ref('bookstore_titles').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R9.9 · the last three PL-1 open grants.
//
// All three were filed under one heading — "a grant above the $uid/$type children,
// so one request wipes the subtree" — and MEASURING THE LIVE DATA FIRST said that
// was true of exactly one of them. Two are flat numeric counters with no children
// at all, so there was no subtree to wipe and nowhere to push the grant down TO.
// The shape each block asserts below is the shape the live node actually had on
// 2026-08-06, not the shape the finding predicted. That is the whole house rule.
// ═══════════════════════════════════════════════════════════════════════════

describe('R9.9 PL-1 · cms_stories/$slug/reads — the vestigial counter', () => {
  // LIVE SHAPE: a number. 3 of 173 slugs carry it (1, 2, 2). Superseded by
  // storyReads/$slug/$uid and users/$uid/readCount; no writer exists in the client
  // bundle, the Pages Functions, either mirrored Worker, or scripts/.
  //
  // This is the ONLY grant that let a non-founder write anywhere under cms_stories —
  // the node root is founder-only. Left open, it was also an unbounded write into
  // billed storage: `auth != null` with no type term accepts an object of any size.

  test('unauthenticated cannot write', async () => {
    await assertFails(anon.ref('cms_stories/a-slug/reads').set(5));
    await assertFails(anon.ref('cms_stories/a-slug/reads').set(null));
  });

  test('WIPE: the counter cannot be deleted, by anyone who is not a founder', async () => {
    // The point of the round. `.validate` is powerless here — it never runs on a
    // null write — so the numeric term has to live in the .write GRANT, and does.
    await seed(env, { 'cms_stories/a-slug': { title: 'A', reads: 7 } });
    await assertFails(stranger.ref('cms_stories/a-slug/reads').remove());
    await assertFails(stranger.ref('cms_stories/a-slug/reads').set(null));
    await assertFails(anon.ref('cms_stories/a-slug/reads').remove());
    // And the story it hangs off is still untouchable, as it always was.
    await assertFails(stranger.ref('cms_stories/a-slug').remove());
    await assertFails(stranger.ref('cms_stories').remove());
  });

  test('PAYLOAD: no longer a free unbounded write into billed storage', async () => {
    await assertFails(stranger.ref('cms_stories/a-slug/reads').set({ junk: 'x'.repeat(500) }));
    await assertFails(stranger.ref('cms_stories/a-slug/reads').set('99'));
    await assertFails(stranger.ref('cms_stories/a-slug/reads').set(true));
    await assertFails(stranger.ref('cms_stories/a-slug/reads').set(-1));
  });

  test('SUBTREE: the grant cannot be climbed to reach story content', async () => {
    await seed(env, { 'cms_stories/a-slug': { title: 'A', content: 'body', reads: 7 } });
    await assertFails(stranger.ref('cms_stories/a-slug/title').set('defaced'));
    await assertFails(stranger.ref('cms_stories/a-slug/content').remove());
    await assertFails(stranger.ref('cms_stories/a-slug').set({ reads: 1 }));
  });

  test('LEGITIMATE: a signed-in reader may still bump it, and founders keep full control', async () => {
    // The counter is not owned by anyone, so this stays open by type rather than by
    // owner — the same posture as open_pages/$postId/readCount. Forgeable, not wipeable.
    await assertSucceeds(stranger.ref('cms_stories/a-slug/reads').set(1));
    await assertSucceeds(stranger.ref('cms_stories/a-slug/reads').set(0));
    // Founders write through the node-root grant, which still cascades down —
    // including deleting reads, which is how a story edit that drops the field works.
    await seed(env, { 'cms_stories/a-slug': { title: 'A', reads: 7 } });
    await assertSucceeds(founder.ref('cms_stories/a-slug/reads').remove());
    await assertSucceeds(founder.ref('cms_stories/a-slug').set({ title: 'A2' }));
    // And the world can still read it — cms_stories is `.read: true` and 173 slugs
    // are served to anonymous visitors from it.
    await assertSucceeds(anon.ref('cms_stories/a-slug').get());
  });
});

describe('R9.9 PL-1 · storyReactions/$slug/$type — the aggregate counters', () => {
  // LIVE SHAPE: a number, NOT a per-uid subtree. 141 slugs, 407 counters,
  // $type ∈ {fire, heart, quill} exactly. The per-uid half is the sibling node
  // storyReactionUsers/$slug/$uid, which was already correctly scoped — the
  // finding's "mirror storyReactionUsers" prescription described a node that
  // already existed rather than a change to make here.

  test('unauthenticated cannot write', async () => {
    await assertFails(anon.ref('storyReactions/a-slug/heart').set(5));
    await assertFails(anon.ref('storyReactions/a-slug/heart').remove());
  });

  test('WIPE: counters cannot be nulled, and the slug cannot be emptied', async () => {
    await seed(env, { 'storyReactions/a-slug': { fire: 3, heart: 9, quill: 2 } });
    await assertFails(stranger.ref('storyReactions/a-slug/heart').remove());
    await assertFails(stranger.ref('storyReactions/a-slug/heart').set(null));
    await assertFails(anon.ref('storyReactions/a-slug/fire').set(null));
    // There is no grant at $slug or at the node root, so these were never writable
    // and still are not — asserted so a future edit cannot quietly add one.
    await assertFails(stranger.ref('storyReactions/a-slug').remove());
    await assertFails(stranger.ref('storyReactions').remove());
    await assertFails(stranger.ref('storyReactions/a-slug').set({ heart: 1 }));
  });

  test('PAYLOAD: type and key are both constrained at the leaf', async () => {
    await assertFails(stranger.ref('storyReactions/a-slug/heart').set('9'));
    await assertFails(stranger.ref('storyReactions/a-slug/heart').set({ uid: true }));
    await assertFails(stranger.ref('storyReactions/a-slug/heart').set(-4));
    // $type is a wildcard: without the whitelist, anyone could invent reaction
    // keys on any of the 141 slugs and grow the node without bound.
    await assertFails(stranger.ref('storyReactions/a-slug/spam').set(1));
    await assertFails(stranger.ref('storyReactions/a-slug/Heart').set(1));
  });

  test('LEGITIMATE: a reader may still react, and storyReactionUsers stays owner-scoped', async () => {
    await assertSucceeds(stranger.ref('storyReactions/a-slug/heart').set(1));
    await assertSucceeds(stranger.ref('storyReactions/a-slug/fire').set(4));
    await assertSucceeds(stranger.ref('storyReactions/a-slug/quill').set(0));
    await assertSucceeds(anon.ref('storyReactions/a-slug').get());
    // The membership half is untouched by this round. Re-asserted because the two
    // nodes are a pair, and a counter rule is only as honest as the flag beside it.
    await assertSucceeds(owner.ref(`storyReactionUsers/a-slug/${OWNER}`).set({ heart: true }));
    await assertFails(stranger.ref(`storyReactionUsers/a-slug/${OWNER}`).set({ heart: true }));
    await assertFails(stranger.ref(`storyReactionUsers/a-slug/${OWNER}`).remove());
  });
});

describe('R9.9 PL-1 · user_square_posts/$uid — the one that was the shape it claimed', () => {
  // LIVE SHAPE: 21 uids, 103 post rows, every row an object with a numeric createdAt.
  // 78 carry authorUid and it matches $uid in ALL 78 — the index has never been
  // mis-filed, which is what makes an authorUid === $uid validator safe to add.
  // (The 25 without it are legacy rows; .validate only runs on writes, so they are
  // not disturbed by this.) Written by app/square/page.js:940 mirrorToUserPosts,
  // deleted by :1053 handleDelete. app/api/square-cleanup/route.js also names the
  // path, but `output: 'export'` means it is never built — absent from out/ — and it
  // sends no ?auth=, so it would have been denied by `auth != null` regardless.

  const row = (uid) => ({
    text: 'a post', authorUid: uid, authorName: 'Reader', authorInitials: 'R',
    authorHandle: '', authorReadCount: 0, isAuthor: false,
    likeCount: 0, pinned: false, createdAt: now(),
  });

  test('unauthenticated cannot write', async () => {
    await assertFails(anon.ref(`user_square_posts/${OWNER}/p1`).set(row(OWNER)));
    await assertFails(anon.ref(`user_square_posts/${OWNER}/p1`).remove());
  });

  test('a stranger cannot write into another reader\'s index', async () => {
    // This is the node that WAS the finding's shape. Sign-up is open, so "stranger"
    // is a second real account, not an exotic attacker.
    await assertFails(stranger.ref(`user_square_posts/${OWNER}/p1`).set(row(OWNER)));
    await assertFails(stranger.ref(`user_square_posts/${OWNER}/p1`).set(row(STRANGER)));
  });

  test('WIPE: another reader\'s index cannot be emptied — node, payload, null, subtree', async () => {
    await seed(env, {
      [`user_square_posts/${OWNER}`]: { p1: row(OWNER), p2: row(OWNER) },
    });
    await assertFails(stranger.ref(`user_square_posts/${OWNER}`).remove());
    await assertFails(stranger.ref(`user_square_posts/${OWNER}`).set(null));
    await assertFails(stranger.ref(`user_square_posts/${OWNER}/p1`).remove());
    await assertFails(stranger.ref(`user_square_posts/${OWNER}/p1`).set(null));
    await assertFails(stranger.ref(`user_square_posts/${OWNER}/p1/text`).set('defaced'));
    await assertFails(stranger.ref('user_square_posts').remove());
    await assertFails(anon.ref('user_square_posts').remove());
    // The $uid level itself carries no grant now, so even the OWNER cannot wipe their
    // whole index in one request — deletes go row by row, as handleDelete does them.
    await assertFails(owner.ref(`user_square_posts/${OWNER}`).remove());
  });

  test('PAYLOAD: a row must be filed under its own authorUid, with a createdAt', async () => {
    // An index whose key and whose authorUid disagree is not an index. This is the
    // term that stops a row being planted under someone else's uid on create.
    await assertFails(owner.ref(`user_square_posts/${OWNER}/p1`).set(row(STRANGER)));
    await assertFails(owner.ref(`user_square_posts/${OWNER}/p1`).set({ text: 'no uid', createdAt: now() }));
    await assertFails(owner.ref(`user_square_posts/${OWNER}/p1`).set({ authorUid: OWNER }));
    await assertFails(owner.ref(`user_square_posts/${OWNER}/p1`).set({ authorUid: OWNER, createdAt: '2026-08-06' }));
    await assertFails(owner.ref(`user_square_posts/${OWNER}/p1`).set({
      ...row(OWNER), text: 'x'.repeat(10001),
    }));
  });

  test('LEGITIMATE: mirrorToUserPosts, the author\'s own delete, and founder moderation', async () => {
    // app/square/page.js:940 — set(user_square_posts/<own uid>/<pushKey>, postData).
    await assertSucceeds(owner.ref(`user_square_posts/${OWNER}/p1`).set(row(OWNER)));
    // A reply carries parentId and is mirrored the same way (:998). Optional fields
    // that the client sends as `null` — authorAvatarUrl, attachedStory, unpinnedAt,
    // quotedPostId — arrive as ABSENT children, so the validator must not require them.
    // That is the imageUrl:null trap; this asserts we did not walk into it.
    await assertSucceeds(owner.ref(`user_square_posts/${OWNER}/p2`).set({
      ...row(OWNER), parentId: 'p1', quotedPostId: null, attachedStory: null,
      authorAvatarUrl: null, unpinnedAt: null,
    }));
    // :1053 handleDelete — the author removing their own post's index row.
    await assertSucceeds(owner.ref(`user_square_posts/${OWNER}/p1`).remove());
    // Founder moderation deletes another reader's row, exactly as square_posts allows.
    await seed(env, { [`user_square_posts/${OWNER}/p3`]: row(OWNER) });
    await assertSucceeds(founder.ref(`user_square_posts/${OWNER}/p3`).remove());
    // The index stays world-readable — app/user/page.js:106 and app/profile/page.js:265
    // both read another reader's index to render their profile.
    await seed(env, { [`user_square_posts/${OWNER}/p4`]: row(OWNER) });
    await assertSucceeds(anon.ref(`user_square_posts/${OWNER}`).get());
    await assertSucceeds(stranger.ref(`user_square_posts/${OWNER}`).get());
  });

  test('the reply cascade a non-founder cannot complete — and could not before either', async () => {
    // app/square/page.js:1056 deletes replies to a deleted post, including replies
    // BY OTHER READERS, from their indexes. That is now denied for a non-founder.
    // It was ALREADY denied on the paired square_posts/<replyId> removal in the very
    // same Promise.all, so the cascade already threw; the open grant only meant the
    // index row vanished while the reply itself survived. Closing it makes the two
    // consistent. Asserted so the behaviour is recorded rather than rediscovered.
    await seed(env, {
      [`user_square_posts/${STRANGER}/reply1`]: { ...row(STRANGER), parentId: 'p1' },
      'square_posts/reply1': { ...row(STRANGER), parentId: 'p1' },
    });
    await assertFails(owner.ref('square_posts/reply1').remove());          // already true before R9.9
    await assertFails(owner.ref(`user_square_posts/${STRANGER}/reply1`).remove()); // now true too
    // The founder, who is the only MOD_UID, can complete it.
    await assertSucceeds(founder.ref(`user_square_posts/${STRANGER}/reply1`).remove());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R10.1 · users/$uid — the membership prerequisite.
//
// WHY THIS ROUND EXISTS. `users/$uid` carried ONE `.write` at its root, owner-or-founder,
// with no `.validate` beneath it. Membership tiers live at users/{uid}/membership, so that
// grant meant ANY signed-in reader could write their own tier and hand themselves platinum.
//
// AND THE OBVIOUS FIX DOES NOT WORK. `membership: { ".write": false }` under an owner-granted
// $uid changes NOTHING: RTDB write grants cascade DOWN and a descendant cannot revoke an
// ancestor's. Measured on the emulator before this round was designed, not inferred from the
// docs. The same is true of `.read` — which is why the rich billing record lives at top-level
// `memberships/{uid}` and NOT under users/{uid}, where `.read: true` would publish
// stripeCustomerId to the world with no way to close it.
//
// So the grant had to move to the leaves, and that is the whole blast radius of this round:
// a field with no leaf grant is now UNWRITABLE. The enumeration below is therefore the
// contract, and it was built from the UNION of two sweeps — every users/{uid} write site in
// the repo (plus both mirrored Workers, which touch none) and every key present in live data
// (285 users, 33 keys). Neither list alone was sufficient: `readStories`, `readCount` and
// `readerScore` are the three most common fields in the node and appear in code, while
// `ageConfirmed`, `headerOffsetY`, `platforms` and nine others appear ONLY in live data with
// no writer left in the tree.
//
// EVERY GRANTED FIELD HAS AN assertSucceeds BELOW. The denials are the point of the round,
// but the permissions are what a reader notices: a missing grant here is a reader who cannot
// save their profile, and that failure would reach them before it reached us.
// ═══════════════════════════════════════════════════════════════════════════

describe('R10.1 · users/$uid — every enumerated field stays writable by its owner', () => {
  // The 32 granted fields, with a value of the shape live data actually holds. Table-driven so
  // adding a field to the rules without adding it here is a visible omission rather than a
  // silent one.
  const FIELDS = [
    ['ageConfirmed', true], ['avatarUrl', 'https://x/a.png'], ['bio', 'a bio'],
    ['createdAt', 1786000000000], ['displayName', 'A Reader'], ['dob', '1990-01-01'],
    ['email', 'r@example.com'], ['handle', 'areader'], ['handleLowercased', 'areader'],
    ['headerOffsetY', 12], ['headerScale', 1], ['headerUrl', 'https://x/h.png'],
    ['isDeleted', true], ['joinDate', 1786000000000],
    ['leaderboardVisible', false], ['pendingDeletion', { requestedAt: 1786000000000 }],
    ['photoURL', 'https://x/p.png'], ['platformAvatar', 'https://x/pa.png'],
    ['platforms', { web: true }], ['profile', { a: 1 }], ['readCount', 7],
    ['readStories', { 'a-slug': true }], ['readerProgress', { 'a-slug': { cfi: 'epubcfi(/6/2)' } }],
    ['readerScore', 42], ['scoreUpdatedAt', 1786000000000], ['uid', OWNER],
    ['username', 'areader'],
    // The four the admin UI writes on ANOTHER reader's node — app/admin/authors/page.js:238.
    ['authorBio', 'an author bio'], ['authorPhotoUrl', 'https://x/ap.png'],
    ['authorRole', 'Contributor'], ['authorSocials', { x: 'https://x.com/a' }],
  ];

  // R10.2 — isAuthor is the ONE field a reader may not set on themselves. It has no writer
  // anywhere in the tree, and app/lib/readerCollection.js:12 treats it as author membership,
  // so an owner grant let any reader promote themselves into the author collection.
  // R33.2 — the three Square permission switches. Same shape as isAuthor and for the same
  // reason: a reader must not be able to grant themselves moderation or the image gate.
  const FOUNDER_ONLY_FIELDS = [
    ['isAuthor', true],
    ['canPostImages', true], ['canPin', true], ['canRemovePosts', true],
  ];

  test('all 31 owner fields are writable by the owner', async () => {
    for (const [field, value] of FIELDS) {
      await assertSucceeds(owner.ref(`users/${OWNER}/${field}`).set(value));
    }
  });

  test('and none of them is writable by a stranger', async () => {
    for (const [field, value] of FIELDS) {
      await assertFails(stranger.ref(`users/${OWNER}/${field}`).set(value));
    }
  });

  test('the enumeration matches the rules file exactly — no drift either way', async () => {
    // The table above and the rules are two hand-maintained lists of the same thing. If they
    // disagree, one of them is wrong and this says which.
    const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8')).rules;
    const granted = Object.entries(rules.users.$uid)
      .filter(([k, v]) => !k.startsWith('.') && v && typeof v === 'object' && '.write' in v)
      .map(([k]) => k).sort();
    const expected = [...FIELDS, ...FOUNDER_ONLY_FIELDS].map(([f]) => f).sort();
    assert.deepEqual(granted, expected);
    assert.equal(granted.length, 35);
  });

  test('R10.2 · isAuthor — a reader cannot promote themselves into the author collection', async () => {
    // The escalation: readerCollection.js:12 reads this flag as author membership, and it is
    // written by NOTHING in the repo — so an owner grant was pure downside.
    await assertFails(owner.ref(`users/${OWNER}/isAuthor`).set(true));
    await assertFails(stranger.ref(`users/${OWNER}/isAuthor`).set(true));
    await assertFails(anon.ref(`users/${OWNER}/isAuthor`).set(true));
    // Nor by the routes that reach it sideways.
    await assertFails(owner.ref(`users/${OWNER}`).update({ isAuthor: true }));
    await assertFails(owner.ref('/').update({ [`users/${OWNER}/isAuthor`]: true }));
    // Smuggled into a legitimate save, the whole update must fail.
    await seed(env, { [`users/${OWNER}`]: { bio: 'original' } });
    await assertFails(owner.ref(`users/${OWNER}`).update({ bio: 'changed', isAuthor: true }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await ctx.database().ref(`users/${OWNER}/bio`).get();
      assert.equal(snap.val(), 'original', 'the granted half must NOT have landed');
    });
    // A founder still confers it — that is how someone becomes an author.
    await assertSucceeds(founder.ref(`users/${OWNER}/isAuthor`).set(true));
    await assertSucceeds(founder.ref(`users/${OWNER}/isAuthor`).set(false));
    // …and an existing author cannot revoke their own flag either way round.
    await seed(env, { [`users/${OWNER}`]: { isAuthor: true } });
    await assertFails(owner.ref(`users/${OWNER}/isAuthor`).remove());
    await assertFails(stranger.ref(`users/${OWNER}/isAuthor`).set(false));
  });

  test('the founder can write the author fields on ANOTHER reader — the admin page', async () => {
    // app/admin/authors/page.js:238 does update(users/{editingUid}, {authorBio, authorRole,
    // authorSocials, authorPhotoUrl}) with a founder session. It is the ONLY admin surface
    // that writes another reader's node; the rest only read.
    await assertSucceeds(founder.ref(`users/${OWNER}`).update({
      authorBio: 'set by admin', authorRole: 'Contributor',
      authorSocials: { x: 'https://x.com/a' }, authorPhotoUrl: 'https://x/ap.png',
    }));
  });

  test('but the founder no longer has a blanket write over a reader\'s profile', async () => {
    // A NARROWING, recorded deliberately. Founders keep total control through the console and
    // the service account, both of which bypass rules entirely — this only removes the
    // browser-session blanket grant, which nothing in the repo used.
    await assertFails(founder.ref(`users/${OWNER}/displayName`).set('renamed by admin'));
    await assertFails(founder.ref(`users/${OWNER}/bio`).set('rewritten'));
  });
});

describe('R10.1 · users/$uid — the real journeys, as the app actually issues them', () => {
  // update() is evaluated PER CHILD PATH, not as a write to the node — verified on the
  // emulator, and the reason multi-field profile saves survive leaf grants at all.

  test('JOURNEY profile edit — app/profile/page.js:625', async () => {
    await assertSucceeds(owner.ref(`users/${OWNER}`).update({
      displayName: 'New Name', bio: 'new bio', username: 'newhandle',
      avatarUrl: 'https://x/new.png', headerUrl: 'https://x/newh.png',
    }));
  });

  test('JOURNEY avatar change alone, and a handle claim with its usernames/ index', async () => {
    await assertSucceeds(owner.ref(`users/${OWNER}/avatarUrl`).set('https://x/avatar2.png'));
    // app/profile/page.js:626 — the claim is two writes and both must pass, or a reader ends
    // up with a handle on their profile that the index does not know about.
    await assertSucceeds(owner.ref(`users/${OWNER}/username`).set('claimed'));
    await assertSucceeds(owner.ref('usernames/claimed').set(OWNER));
    // and the mirror at user_search — app/profile/page.js:630
    await assertSucceeds(owner.ref(`user_search/${OWNER}`).update({
      displayName: 'New Name', username: 'claimed', avatarUrl: 'https://x/new.png',
    }));
  });

  test('JOURNEY leaderboard opt-out — a ROOT multi-path update, app/profile/page.js:1013', async () => {
    await assertSucceeds(owner.ref('/').update({
      [`users/${OWNER}/leaderboardVisible`]: false,
      [`leaderboard/${OWNER}/leaderboardVisible`]: false,
    }));
    // and opting back in, which writes null to both
    await assertSucceeds(owner.ref('/').update({
      [`users/${OWNER}/leaderboardVisible`]: null,
      [`leaderboard/${OWNER}/leaderboardVisible`]: null,
    }));
  });

  test('JOURNEY register — three child sets, app/components/AuthModal.js:108-110', async () => {
    await assertSucceeds(owner.ref(`users/${OWNER}/dob`).set('1990-01-01'));
    await assertSucceeds(owner.ref(`users/${OWNER}/displayName`).set('A Reader'));
    await assertSucceeds(owner.ref(`users/${OWNER}/joinDate`).set(1786000000000));
  });

  test('JOURNEY reading a story — readStories + a readCount transaction', async () => {
    // app/stories/[slug]/page-client.js:1146-1150 and page-reader.js:511-515.
    await assertSucceeds(owner.ref(`users/${OWNER}/readStories/a-slug`).set(true));
    await assertSucceeds(owner.ref(`users/${OWNER}/readCount`).transaction((c) => (c || 0) + 1));
    // and the reader's place in the book — ReadingRoom.js:885 via progress.path(uid)
    await assertSucceeds(owner.ref(`users/${OWNER}/readerProgress/a-slug`).set({
      cfi: 'epubcfi(/6/2)', fraction: 0.4, updatedAt: 1786000000000,
    }));
  });

  test('JOURNEY badge engine — a ROOT multi-path across users and leaderboard', async () => {
    // app/lib/badgeEngine.js:33-36. Runs on the reader's own session, not a server.
    await assertSucceeds(owner.ref('/').update({
      [`users/${OWNER}/readerScore`]: 42,
      [`users/${OWNER}/scoreUpdatedAt`]: 1786000000000,
      [`leaderboard/${OWNER}/readerScore`]: 42,
    }));
  });

  test('JOURNEY account deletion — app/components/DeleteAccountModal.js:51-53', async () => {
    await assertSucceeds(owner.ref('/').update({
      [`users/${OWNER}/isDeleted`]: true,
      [`users/${OWNER}/pendingDeletion/requestedAt`]: 1786000000000,
      [`users/${OWNER}/pendingDeletion/scheduledFor`]: 1788000000000,
    }));
  });

  test('the profile stays world-readable — every conversation surface depends on it', async () => {
    await seed(env, { [`users/${OWNER}`]: { displayName: 'A Reader', avatarUrl: 'https://x/a.png' } });
    await assertSucceeds(anon.ref(`users/${OWNER}`).get());
    await assertSucceeds(stranger.ref(`users/${OWNER}/displayName`).get());
  });
});

describe('R10.1 · users/$uid/membership — the scalar nobody may write', () => {
  // THE APP'S DEPLOYED CONTRACT, on both fleets: membership is a STRING compared with strict
  // equality (=== 'gold' || === 'platinum', else free). NOT an object, and there is no `.tier`
  // anywhere in the app. An object here silently downgrades every paying member to free.
  // The rich billing record is a SIBLING at top-level memberships/{uid}.

  test('the owner cannot grant themselves a tier — the hole this round exists to close', async () => {
    await assertFails(owner.ref(`users/${OWNER}/membership`).set('platinum'));
    await assertFails(owner.ref(`users/${OWNER}/membership`).set('gold'));
    await assertFails(owner.ref(`users/${OWNER}/membership`).set('free'));
  });

  test('nor can a stranger, an anonymous caller, or a founder', async () => {
    await assertFails(stranger.ref(`users/${OWNER}/membership`).set('platinum'));
    await assertFails(anon.ref(`users/${OWNER}/membership`).set('platinum'));
    // Founders too: the webhook's service account bypasses rules, so nothing needs a
    // rules-level grant here, and a founder session in a browser is not the writer.
    await assertFails(founder.ref(`users/${OWNER}/membership`).set('platinum'));
  });

  test('it cannot be reached by climbing to the parent, either', async () => {
    // The route the old shape allowed: write the node wholesale and carry membership in.
    await assertFails(owner.ref(`users/${OWNER}`).set({ displayName: 'A', membership: 'platinum' }));
    await assertFails(owner.ref(`users/${OWNER}`).update({ membership: 'platinum' }));
    await assertFails(owner.ref('/').update({ [`users/${OWNER}/membership`]: 'platinum' }));
  });

  test('ATOMICITY: smuggling membership into a legitimate profile save fails the WHOLE update', async () => {
    // The subtle one. update() is per-child, so a caller could hope the granted fields land
    // and only the ungranted one is dropped. RTDB rejects the entire update instead — asserted
    // because "partially applied" would be the worst possible outcome here.
    await seed(env, { [`users/${OWNER}`]: { displayName: 'Original' } });
    await assertFails(owner.ref(`users/${OWNER}`).update({
      displayName: 'Changed', bio: 'changed', membership: 'platinum',
    }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await ctx.database().ref(`users/${OWNER}/displayName`).get();
      assert.equal(snap.val(), 'Original', 'the granted half must NOT have landed');
    });
  });

  test('an existing tier cannot be wiped or downgraded by the reader', async () => {
    await seed(env, { [`users/${OWNER}`]: { displayName: 'A', membership: 'platinum' } });
    await assertFails(owner.ref(`users/${OWNER}/membership`).remove());
    await assertFails(owner.ref(`users/${OWNER}/membership`).set(null));
    await assertFails(stranger.ref(`users/${OWNER}/membership`).remove());
    // …and a reader cannot take someone else's away by wiping the whole profile
    await assertFails(stranger.ref(`users/${OWNER}`).remove());
    await assertFails(owner.ref(`users/${OWNER}`).remove());
  });

  test('the scalar stays readable — the app live-subscribes to it', async () => {
    await seed(env, { [`users/${OWNER}`]: { membership: 'gold' } });
    await assertSucceeds(owner.ref(`users/${OWNER}/membership`).get());
    // World-readable, inherited from users/$uid. A tier name is not a secret; the billing
    // record that IS one lives at memberships/{uid} below, precisely because a child cannot
    // close an ancestor's read grant.
    await assertSucceeds(anon.ref(`users/${OWNER}/membership`).get());
  });

  test('the .validate on membership is a TRIPWIRE, not the boundary — and is inert today', async () => {
    // Stated plainly so nobody mistakes it for protection. There is no `.write` at or above
    // membership, so no client write ever reaches validation; and the service account bypasses
    // .validate as it bypasses everything. Its whole job is to fail loudly if a future round
    // ever adds a grant above it — and to pin the SHAPE, which is a string and not an object.
    await assertFails(owner.ref(`users/${OWNER}/membership`).set({ tier: 'platinum' }));
    await assertFails(owner.ref(`users/${OWNER}/membership`).set('PLATINUM'));
    await assertFails(owner.ref(`users/${OWNER}/membership`).set(3));
  });

  test('an UNLISTED field is now refused — the cost of the enumeration, asserted', async () => {
    // The behaviour change a future round must know about: adding a profile field now needs a
    // rules edit. That is the trade for membership being unreachable.
    await assertFails(owner.ref(`users/${OWNER}/somethingNew`).set(1));
    await assertFails(owner.ref(`users/${OWNER}/pass`).set({ kind: 'day' }));
    await assertFails(owner.ref(`users/${OWNER}/membershipDetail`).set({ tier: 'gold' }));
    // and the wholesale set, which no code path in the repo does
    await assertFails(owner.ref(`users/${OWNER}`).set({ displayName: 'A' }));
  });
});

describe('R10.1 · memberships/$uid — the billing record, off the world-readable node', () => {
  const detail = () => ({
    interval: 'monthly', currency: 'gbp', rail: 'stripe', status: 'active',
    currentPeriodEnd: 1790000000000, founding: true,
    stripeCustomerId: 'cus_SECRET', stripeSubscriptionId: 'sub_SECRET',
  });

  test('nobody may write it — not the owner, not a stranger, not a founder', async () => {
    await assertFails(owner.ref(`memberships/${OWNER}`).set(detail()));
    await assertFails(stranger.ref(`memberships/${OWNER}`).set(detail()));
    await assertFails(founder.ref(`memberships/${OWNER}`).set(detail()));
    await assertFails(anon.ref(`memberships/${OWNER}`).set(detail()));
    await assertFails(owner.ref(`memberships/${OWNER}/status`).set('active'));
    await assertFails(owner.ref('memberships').set({ [OWNER]: detail() }));
  });

  test('WIPE: it cannot be emptied either', async () => {
    await seed(env, { [`memberships/${OWNER}`]: detail() });
    await assertFails(owner.ref(`memberships/${OWNER}`).remove());
    await assertFails(stranger.ref('memberships').remove());
    await assertFails(anon.ref(`memberships/${OWNER}`).set(null));
  });

  test('the owner and the founder may READ it; nobody else can', async () => {
    await seed(env, { [`memberships/${OWNER}`]: detail() });
    await assertSucceeds(owner.ref(`memberships/${OWNER}`).get());
    await assertSucceeds(founder.ref(`memberships/${OWNER}`).get());
    // THE REASON THIS NODE EXISTS. Under users/{uid} — which is .read: true — these
    // identifiers would be world-readable, and a child ".read": false cannot close an
    // ancestor's grant. Measured, not assumed.
    await assertFails(stranger.ref(`memberships/${OWNER}`).get());
    await assertFails(anon.ref(`memberships/${OWNER}`).get());
    await assertFails(stranger.ref(`memberships/${OWNER}/stripeCustomerId`).get());
    await assertFails(anon.ref('memberships').get());
  });
});

describe('R10.5 · paystack_membership_index — the renewal identity map', () => {
  // WHY IT EXISTS. The bookstore's Paystack reference is self-describing (cs.<uid>.<titleId>
  // .<nonce>), so a book event carries its own identity. A membership RENEWAL does not: only
  // the FIRST charge uses a reference we minted, and every recurring charge after it carries
  // one Paystack generated, which parses as neither rail's format. So the first charge seeds
  // this map — CUS_… and SUB_… codes → uid — and later events resolve through it.
  //
  // It is written and read ONLY by the service account, which bypasses rules. No client has
  // any business reading a map from opaque payment identifiers to reader uids, so unlike
  // memberships/{uid} it is not even owner-readable — an owner has no code to look up.

  test('closed to everyone: no read, no write, no exceptions', async () => {
    await seed(env, { 'paystack_membership_index/SUB_abc': OWNER });
    for (const [who, ctx] of [['owner', owner], ['stranger', stranger], ['founder', founder], ['anon', anon]]) {
      await assertFails(ctx.ref('paystack_membership_index/SUB_abc').get(), `${who} must not read`);
      await assertFails(ctx.ref('paystack_membership_index/SUB_new').set(OWNER), `${who} must not write`);
      await assertFails(ctx.ref('paystack_membership_index').get(), `${who} must not enumerate`);
    }
  });

  test('WIPE: it cannot be emptied, and an entry cannot be repointed', async () => {
    // Repointing SUB_abc at another uid would send a member's renewals — and their tier — to
    // somebody else's account. That is the sharpest failure this node has.
    await seed(env, { 'paystack_membership_index/SUB_abc': OWNER });
    await assertFails(stranger.ref('paystack_membership_index/SUB_abc').set(STRANGER));
    await assertFails(owner.ref('paystack_membership_index/SUB_abc').remove());
    await assertFails(anon.ref('paystack_membership_index').remove());
    await assertFails(founder.ref('paystack_membership_index/SUB_abc').set(FOUNDER_A));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('R12.4 · series_instalments_detail — the release gate, against the real rule', () => {
  // THE GATE HAD NO EMULATOR TEST UNTIL NOW. R12.0 asserted the POLICY thoroughly in
  // tests/ci/series-access.test.mjs — release before tier, passes excluded, the flag that
  // does not move the release check — and it asserted the SHAPE of the rule by reading
  // database.rules.json and grepping it for `releaseAtMs` and `<= now`. Neither of those
  // runs the rule. This block does, which matters because the rule is the only thing
  // standing between an unreleased instalment and `curl`: the pages are a static export
  // and every read a reader makes is a direct client read of RTDB.
  //
  // R12.4 added logline, sponsorName and sponsorLogoUrl to this node. The claim being
  // tested is that they are as invisible before release as `title` already was — and the
  // reason they are is placement, not rendering, so it is provable here and nowhere else.

  const FAR_FUTURE = 4102444800000; // 1 Jan 2100
  const FAR_PAST = 1000000000000;   // 9 Sep 2001

  const row = (over = {}) => ({
    schemaVersion: 1,
    seriesId: 'beta-princess',
    ordinal: 4,
    releaseAtMs: FAR_FUTURE,
    freeForGold: false,
    status: 'published',
    addedAt: 1,
    updatedAt: 1,
    ...over,
  });

  // Everything a reveal could hide in. Deliberately populated — a denial test against a
  // record whose sensitive fields are all null proves nothing.
  const detail = (over = {}) => ({
    schemaVersion: 1,
    title: 'The Protocol',
    synopsis: 'She has a week.',
    logline: 'A princess, a protocol, and a week to decide.',
    author: 'Monica Garcia',
    authorUid: 'AAAAowner0000000000000000001',
    authorHandle: 'monica',
    coverUrl: 'https://example.test/cover.png',
    epubPath: 'series_epubs/beta-princess-i4/master.epub',
    sponsorName: 'Ada Type Foundry',
    sponsorLogoUrl: 'https://example.test/sponsor.png',
    wordCount: 12000,
    updatedAt: 1,
    ...over,
  });

  const ID = 'beta-princess-i4';
  const seedPair = (rowOver = {}) => seed(env, {
    [`series_instalments/${ID}`]: row(rowOver),
    [`series_instalments_detail/${ID}`]: detail(),
  });

  // THE GATED FIELDS, named one by one. A per-field loop rather than one read of the
  // record, because a future rule that opened a single child — "the logline is only
  // marketing, surely that one can be public" — would pass a whole-record assertion.
  const GATED = ['title', 'logline', 'sponsorName', 'sponsorLogoUrl', 'coverUrl', 'author', 'wordCount', 'epubPath'];

  test('UNRELEASED: nobody outside the two admin UIDs can read the record', async () => {
    await seedPair();
    for (const [who, ctx] of [['anon', anon], ['stranger', stranger], ['owner', owner]]) {
      await assertFails(ctx.ref(`series_instalments_detail/${ID}`).get(), `${who} read the whole record`);
    }
  });

  test('UNRELEASED: nor any single field of it — logline and sponsor included', async () => {
    await seedPair();
    for (const field of GATED) {
      await assertFails(anon.ref(`series_instalments_detail/${ID}/${field}`).get(),
        `anon read ${field} of an unreleased instalment`);
      await assertFails(stranger.ref(`series_instalments_detail/${ID}/${field}`).get(),
        `a signed-in stranger read ${field} of an unreleased instalment`);
    }
  });

  test('UNRELEASED: the node is not listable, so the ids cannot be swept either', async () => {
    await seedPair();
    await assertFails(anon.ref('series_instalments_detail').get());
    await assertFails(stranger.ref('series_instalments_detail').get());
    await assertFails(owner.ref('series_instalments_detail').get());
  });

  test('RELEASED: the same record opens to everyone, signed out included', async () => {
    // Case 4, and it is as load-bearing as the three denials above it. A rule that denied
    // everything would pass every test before this one while the Series showed nothing.
    await seedPair({ releaseAtMs: FAR_PAST });
    await assertSucceeds(anon.ref(`series_instalments_detail/${ID}`).get());
    const snap = await anon.ref(`series_instalments_detail/${ID}`).get();
    assert.equal(snap.val().logline, 'A princess, a protocol, and a week to decide.');
    assert.equal(snap.val().sponsorName, 'Ada Type Foundry');
    assert.equal(snap.val().sponsorLogoUrl, 'https://example.test/sponsor.png');
    assert.equal(snap.val().wordCount, 12000);
  });

  test('the date is compared as a NUMBER — a past date as a string never releases', async () => {
    // The whole gate rests on releaseAtMs being numeric: the rule requires isNumber() before
    // it compares, so a record whose date arrived as a string is denied forever rather than
    // sorting lexicographically against `now` and opening at random. See the schema header.
    await seed(env, {
      [`series_instalments/${ID}`]: { ...row(), releaseAtMs: FAR_PAST },
      [`series_instalments_detail/${ID}`]: detail(),
    });
    await assertSucceeds(anon.ref(`series_instalments_detail/${ID}`).get());
    await seed(env, { [`series_instalments/${ID}/releaseAtMs`]: String(FAR_PAST) });
    await assertFails(anon.ref(`series_instalments_detail/${ID}`).get());
  });

  test('a PULLED instalment closes again, past date and all', async () => {
    // status is checked alongside the date because they answer different questions. An
    // instalment withdrawn after release must stop being readable, and must not announce
    // that it once existed.
    for (const status of ['draft', 'unpublished']) {
      await seedPair({ releaseAtMs: FAR_PAST, status });
      await assertFails(anon.ref(`series_instalments_detail/${ID}`).get(), status);
      await assertFails(anon.ref(`series_instalments_detail/${ID}/logline`).get(), status);
    }
  });

  test('a missing row denies the detail — no row, no release', async () => {
    await seed(env, { [`series_instalments_detail/${ID}`]: detail() });
    await assertFails(anon.ref(`series_instalments_detail/${ID}`).get());
  });

  test('THE ROW STAYS PUBLIC IN BOTH STATES — it is what a locked card prints', async () => {
    await seedPair();
    const snap = await anon.ref(`series_instalments/${ID}`).get();
    assert.equal(snap.val().ordinal, 4);
    assert.equal(snap.val().releaseAtMs, FAR_FUTURE);
    // And it carries none of the reveals. If one ever migrated here it would be world-
    // readable the moment it landed, with no rule change to notice in review.
    for (const field of ['title', 'logline', 'sponsorName', 'sponsorLogoUrl', 'author']) {
      assert.equal(snap.val()[field], undefined, `${field} is on the PUBLIC row`);
    }
  });

  test('nobody but an admin writes either node, released or not', async () => {
    await seedPair({ releaseAtMs: FAR_PAST });
    for (const [who, ctx] of [['anon', anon], ['stranger', stranger], ['owner', owner]]) {
      await assertFails(ctx.ref(`series_instalments_detail/${ID}/logline`).set('mine now'), `${who} wrote a logline`);
      await assertFails(ctx.ref(`series_instalments_detail/${ID}/sponsorName`).set('Their Brand'), `${who} wrote a sponsor`);
      // The sharpest one: bringing a release forward would open every gated field at once.
      await assertFails(ctx.ref(`series_instalments/${ID}/releaseAtMs`).set(FAR_PAST), `${who} moved the release date`);
    }
  });

  test('WIPE: neither node can be emptied, and a record cannot be deleted', async () => {
    // .validate NEVER runs on a null write, so a write grant at a node root deletes the
    // subtree. The two admin UIDs hold that grant on both nodes by design; nobody else does.
    await seedPair();
    for (const [who, ctx] of [['anon', anon], ['stranger', stranger], ['owner', owner]]) {
      await assertFails(ctx.ref('series_instalments_detail').remove(), `${who} wiped the detail node`);
      await assertFails(ctx.ref('series_instalments').remove(), `${who} wiped the row node`);
      await assertFails(ctx.ref(`series_instalments_detail/${ID}`).remove(), `${who} deleted a record`);
    }
  });

  test('the admin reads an unreleased record — the Series admin screen depends on it', async () => {
    await seedPair();
    const snap = await founder.ref(`series_instalments_detail/${ID}`).get();
    assert.equal(snap.val().logline, 'A princess, a protocol, and a week to decide.');
  });

  test('and the admin can WRITE the R12.4 fields — the validator does not refuse them', async () => {
    // The `.validate` on $instalmentId is a hasChildren([...]) of the required set, so new
    // optional fields need no rules change. Asserted rather than assumed, because a record
    // the admin cannot save is a feature that does not exist.
    await seed(env, { [`series_instalments/${ID}`]: row() });
    await assertSucceeds(founder.ref(`series_instalments_detail/${ID}`).set(detail()));
    await assertSucceeds(founder.ref(`series_instalments_detail/${ID}`).set(
      detail({ logline: null, sponsorName: null, sponsorLogoUrl: null, wordCount: null }),
    ));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R18 · bookstore_titles — THE AUTHOR BLOCK.
//
// Four schema-external fields on a title: authorName, authorBio, authorPhotoPath,
// authorPhotoAlt. TITLE_SCHEMA stays locked at v2, so validateTitle never sees them; the
// writer's half is validateAuthorFields in app/lib/bookstore/author.js and the rules' half is
// four `.validate` lines under $titleId.
//
// ── TIGHTENED TO THE EXACT SHAPE, NOT `isString() || hasChildren()` ──────────────────────
// R9.2 (a) above is the standing lesson: territoriesAllowed was validated loosely, so '' and
// 'worldwide' and 'no' were all storable, and every one of them read as WORLDWIDE downstream.
// A bio has less at stake than a licence, but the same failure is available — an 800-character
// cap that exists only in the CMS is not a cap, because a console edit skips the CMS. So each
// field here is a STRING WITH A LENGTH BOUND, and authorPhotoPath is a string matching one
// flat key under the public-read cover prefix.
//
// ── ABSENCE MUST STAY EXPRESSIBLE, AND THAT IS WHY THE RULES CAN BE STRICT ───────────────
// All four fields are optional, and a title with no author block is a NORMAL title — an
// anthology has no single author. `.validate` NEVER runs on a null write, so `length > 0` in
// every rule does not make the fields mandatory: it makes an EMPTY STRING unstorable while
// leaving the field's removal untouched. The writer relies on exactly that — normaliseAuthorFields
// turns '' into null, RTDB drops a null key, and the field leaves the record. Both halves of
// that are asserted below.
//
// ── PARITY, PROVEN BOTH DIRECTIONS ──────────────────────────────────────────────────────
// The last block in this section walks one table twice: everything validateAuthorFields
// ACCEPTS must be storable, and everything it REJECTS must be refused. A table checked in one
// direction only is how a rule ends up stricter than the CMS and silently breaks a curator.
// ═══════════════════════════════════════════════════════════════════════════

describe('R18 · bookstore_titles author block', () => {
  const chars = (n) => 'a'.repeat(n);
  const PHOTO = 'bookstore_covers/the-quiet-house_author.jpg';

  test('CASE 4 FIRST — the shapes a curator actually saves', async () => {
    // A full block.
    await assertSucceeds(founder.ref('bookstore_titles/t1').set(titleWith({
      territoriesAllowed: '*',
      authorName: 'Ada Nwachukwu',
      authorBio: 'Ada writes from Enugu. The Quiet House is her second novel.',
      authorPhotoPath: PHOTO,
      authorPhotoAlt: 'Ada Nwachukwu at her desk',
    })));
    // Bio only.
    await assertSucceeds(founder.ref('bookstore_titles/t2').set(titleWith({
      territoriesAllowed: '*', authorName: 'Ada Nwachukwu', authorBio: 'Ada writes from Enugu.',
    })));
    // Photograph only.
    await assertSucceeds(founder.ref('bookstore_titles/t3').set(titleWith({
      territoriesAllowed: '*', authorPhotoPath: PHOTO, authorPhotoAlt: 'The author',
    })));
    // NONE OF THEM — the anthology, and the shape every one of the live titles is in today.
    await assertSucceeds(founder.ref('bookstore_titles/t4').set(titleWith({ territoriesAllowed: '*' })));
  });

  test('ABSENCE stays expressible — a null removes the field and is never validated', async () => {
    await seed(env, {
      'bookstore_titles/t1': titleWith({
        territoriesAllowed: '*', authorName: 'Ada', authorBio: 'A life.', authorPhotoPath: PHOTO, authorPhotoAlt: 'Ada',
      }),
    });
    // Clearing the block is what an editor emptying the textareas must be able to do.
    await assertSucceeds(founder.ref('bookstore_titles/t1').update({
      authorName: null, authorBio: null, authorPhotoPath: null, authorPhotoAlt: null,
    }));
    const after = (await founder.ref('bookstore_titles/t1').get()).val();
    for (const k of ['authorName', 'authorBio', 'authorPhotoPath', 'authorPhotoAlt']) {
      assert.equal(after[k], undefined, `${k} must be gone from the record, not stored empty`);
    }
    // And the writer's own way of saying it: a full set() with nulls, which is what
    // updateTitle does. RTDB drops the keys on the way in.
    await assertSucceeds(founder.ref('bookstore_titles/t1').set(titleWith({
      territoriesAllowed: '*', authorName: null, authorBio: null, authorPhotoPath: null, authorPhotoAlt: null,
    })));
  });

  test('authorBio — 800 saves, 801 does not, and the empty string is unstorable', async () => {
    await assertSucceeds(founder.ref('bookstore_titles/ok').set(titleWith({
      territoriesAllowed: '*', authorBio: chars(AUTHOR_CAPS.authorBio),
    })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', authorBio: chars(AUTHOR_CAPS.authorBio + 1),
    })), 'an 801-character bio must not be storable');
    // The empty string is the shape the CMS turns into null. Reaching the rule at all means a
    // console edit, and an empty husk is exactly what the writer refuses to create.
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', authorBio: '',
    })), 'an empty bio must not be storable — absence is said with null');
  });

  test('authorName — 120 saves, 121 does not, and the empty string is unstorable', async () => {
    await assertSucceeds(founder.ref('bookstore_titles/ok').set(titleWith({
      territoriesAllowed: '*', authorName: chars(AUTHOR_CAPS.authorName), authorBio: 'A life.',
    })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', authorName: chars(AUTHOR_CAPS.authorName + 1),
    })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', authorName: '',
    })));
  });

  test('authorPhotoAlt — 160 saves, 161 does not', async () => {
    await assertSucceeds(founder.ref('bookstore_titles/ok').set(titleWith({
      territoriesAllowed: '*', authorPhotoPath: PHOTO, authorPhotoAlt: chars(AUTHOR_CAPS.authorPhotoAlt),
    })));
    await assertFails(founder.ref('bookstore_titles/bad').set(titleWith({
      territoriesAllowed: '*', authorPhotoPath: PHOTO, authorPhotoAlt: chars(AUTHOR_CAPS.authorPhotoAlt + 1),
    })));
  });

  test('every field is a STRING — a number or an object is not one', async () => {
    // The R9.2 failure mode in miniature: `isString() || hasChildren()` would have let all of
    // these through, and a bio that is an object renders as nothing while looking present.
    for (const [field, value] of [
      ['authorName', 42], ['authorBio', 42], ['authorPhotoAlt', 42],
      ['authorName', { first: 'Ada' }], ['authorBio', { text: 'A life.' }],
      ['authorBio', true], ['authorPhotoPath', 7],
    ]) {
      await assertFails(
        founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: '*', [field]: value })),
        `${field} = ${JSON.stringify(value)} must not be storable`,
      );
    }
  });

  test('authorPhotoPath is ONE FLAT KEY under the public-read cover prefix', async () => {
    await assertSucceeds(founder.ref('bookstore_titles/ok').set(titleWith({
      territoriesAllowed: '*', authorPhotoPath: PHOTO,
    })));
    for (const value of [
      'bookstore_covers/the-quiet-house/author.jpg',  // NESTED — matches no storage rule at all
      'bookstore_epubs/t_author.jpg',                 // the PRIVATE prefix; read: if false
      'covers/t_author.jpg',                          // the platform's story covers, not the shop's
      '/bookstore_covers/t_author.jpg',
      'bookstore_covers/',
      'https://firebasestorage.googleapis.com/v0/b/x/o/y',
      '',
      'bookstore_covers/' + 'a'.repeat(AUTHOR_CAPS.authorPhotoPath),
    ]) {
      await assertFails(
        founder.ref('bookstore_titles/bad').set(titleWith({ territoriesAllowed: '*', authorPhotoPath: value })),
        `authorPhotoPath ${JSON.stringify(value)} must not be storable`,
      );
    }
  });

  test('THE BYLINE AND THE NAME MAY DISAGREE, and the rules do not care that they do', async () => {
    // The anthology: the byline says the house, the author block says the person. Neither the
    // rules nor the writer may reconcile them.
    const anthology = titleWith({
      territoriesAllowed: '*',
      author: 'Calvary Scribblings',
      authorName: 'Ada Nwachukwu',
      authorBio: 'One of eight writers in this collection.',
    });
    await assertSucceeds(founder.ref('bookstore_titles/anthology').set(anthology));
    const stored = (await founder.ref('bookstore_titles/anthology').get()).val();
    assert.equal(stored.author, 'Calvary Scribblings', 'the byline was altered on the way in');
    assert.equal(stored.authorName, 'Ada Nwachukwu', 'the author name was altered on the way in');
    assert.deepEqual(validateAuthorFields(anthology), [], 'the writer must not correct the pair either');
  });

  test('a stranger cannot write an author block, and cannot wipe one', async () => {
    await seed(env, { 'bookstore_titles/t1': titleWith({ territoriesAllowed: '*', authorBio: 'A life.' }) });
    for (const [who, ctx] of [['anon', anon], ['stranger', stranger], ['owner', owner]]) {
      await assertFails(ctx.ref('bookstore_titles/t1/authorBio').set('I wrote this book'), `${who} wrote a bio`);
      await assertFails(ctx.ref('bookstore_titles/t1/authorBio').remove(), `${who} wiped a bio`);
      await assertFails(ctx.ref('bookstore_titles/t1/authorPhotoPath').set('bookstore_covers/x_author.jpg'), `${who} set a photo`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PARITY, BOTH DIRECTIONS.
  // ─────────────────────────────────────────────────────────────────────────
  const PARITY = [
    // [label, fields as the CMS would hand them over]
    ['nothing at all', {}],
    ['a full block', { authorName: 'Ada Nwachukwu', authorBio: 'A life.', authorPhotoPath: PHOTO, authorPhotoAlt: 'Ada' }],
    ['bio only', { authorBio: 'A life.' }],
    ['photo only', { authorPhotoPath: PHOTO }],
    ['name only', { authorName: 'Ada Nwachukwu' }],
    ['bio at the cap', { authorBio: chars(AUTHOR_CAPS.authorBio) }],
    ['name at the cap', { authorName: chars(AUTHOR_CAPS.authorName) }],
    ['alt at the cap', { authorPhotoAlt: chars(AUTHOR_CAPS.authorPhotoAlt) }],
    ['bio over the cap', { authorBio: chars(AUTHOR_CAPS.authorBio + 1) }],
    ['name over the cap', { authorName: chars(AUTHOR_CAPS.authorName + 1) }],
    ['alt over the cap', { authorPhotoAlt: chars(AUTHOR_CAPS.authorPhotoAlt + 1) }],
    ['a nested photo path', { authorPhotoPath: 'bookstore_covers/t/author.jpg' }],
    ['a private-prefix photo path', { authorPhotoPath: 'bookstore_epubs/t_author.jpg' }],
    ['a numeric bio', { authorBio: 42 }],
    ['an object name', { authorName: { first: 'Ada' } }],
  ];

  test('WRITER → RULES: everything validateAuthorFields accepts is storable', async () => {
    let n = 0;
    for (const [label, raw] of PARITY) {
      const doc = normaliseAuthorFields({ ...raw });
      if (validateAuthorFields(doc).length) continue;
      // The write path drops nulls exactly as RTDB does, so the rule sees what the CMS sends.
      const fields = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== null));
      await assertSucceeds(
        founder.ref(`bookstore_titles/p${n}`).set(titleWith({ territoriesAllowed: '*', ...fields })),
        `the CMS accepts "${label}" but the rules refuse it — a curator would be broken`,
      );
      n += 1;
    }
    assert.ok(n >= 8, `expected the accepted half of the table to be substantial, got ${n}`);
  });

  test('RULES → WRITER: everything validateAuthorFields refuses is unstorable', async () => {
    let n = 0;
    for (const [label, raw] of PARITY) {
      const doc = normaliseAuthorFields({ ...raw });
      if (!validateAuthorFields(doc).length) continue;
      const fields = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== null));
      await assertFails(
        founder.ref('bookstore_titles/pbad').set(titleWith({ territoriesAllowed: '*', ...fields })),
        `the CMS refuses "${label}" but the rules would store it — the console is the hole`,
      );
      n += 1;
    }
    assert.ok(n >= 6, `expected the refused half of the table to be substantial, got ${n}`);
  });

  test('the photo-path rule and isAuthorPhotoPath agree, character for character', async () => {
    const CASES = [
      'bookstore_covers/a_author.jpg', 'bookstore_covers/A-B_author.JPEG', 'bookstore_covers/x.png',
      'bookstore_covers/a/b.jpg', 'bookstore_covers/', 'bookstore_covers/a b.jpg',
      'bookstore_covers/a?b.jpg', 'bookstore_epubs/a.jpg', 'a_author.jpg', '',
    ];
    for (const p of CASES) {
      const write = founder.ref('bookstore_titles/px').set(titleWith({ territoriesAllowed: '*', authorPhotoPath: p }));
      if (isAuthorPhotoPath(p)) await assertSucceeds(write, `isAuthorPhotoPath allows ${JSON.stringify(p)}, the rule does not`);
      else await assertFails(write, `isAuthorPhotoPath refuses ${JSON.stringify(p)}, the rule stores it`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R21 · bookstore_titles_deleted — the tombstone', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// A deleted title leaves a tombstone: title, author, slug, coverUrl, catalogue number, and who
// removed it when. It is a SEPARATE NODE and never a `deleted: true` flag on the title record,
// because a flag is something every one of the nine readers of bookstore_titles has to remember
// to exclude, forever — and one forgotten filter is a deleted book back on the shelf.
//
// PUBLIC READ, and it discloses nothing new: every field in it was already public on
// bookstore_titles while the title was on sale, and three of the four are already denormalised
// onto the buyer's own purchase record. What it must never carry is prices, an epubPath or a
// publisher's payment detail — and the $other deny is what makes that a property of the
// database rather than a property of one function's field list.

  const ID = 'the-quiet-house';
  const STONE = {
    titleId: ID, slug: ID, title: 'The Quiet House', author: 'A. Nwosu',
    coverUrl: 'https://firebasestorage.googleapis.com/v0/b/b/o/bookstore_covers%2Fthe-quiet-house.jpg',
    catalogueNumber: 7, publisherId: 'calvary',
    deletedAt: 1_800_000_000_000, deletedBy: FOUNDER_A, ownersAtDeletion: 9,
  };

  test('LEGITIMATE: a founder writes exactly what tombstoneOf() produces', async () => {
    // Not a hand-typed fixture — the real writer's output. If a field is ever added to the
    // tombstone without being added to the rule, this fails.
    const produced = tombstoneOf({
      titleId: ID,
      title: { slug: ID, title: 'The Quiet House', author: 'A. Nwosu', coverUrl: STONE.coverUrl, catalogueNumber: 7, publisherId: 'calvary' },
      by: FOUNDER_A,
      nowMs: 1_800_000_000_000,
      ownerCount: 9,
    });
    await assertSucceeds(founder.ref(`bookstore_titles_deleted/${ID}`).set(produced));
  });

  test('anyone may read it — a deleted book is not a secret', async () => {
    await assertSucceeds(founder.ref(`bookstore_titles_deleted/${ID}`).set(STONE));
    for (const [who, ctx] of [['anon', anon], ['a stranger', stranger], ['the owner', owner]]) {
      await assertSucceeds(ctx.ref(`bookstore_titles_deleted/${ID}`).get(), `${who} must be able to read`);
    }
  });

  test('nobody but a founder may write one', async () => {
    for (const [who, ctx] of [['anon', anon], ['a stranger', stranger], ['the owner', owner]]) {
      await assertFails(ctx.ref(`bookstore_titles_deleted/${ID}`).set(STONE), `${who} wrote a tombstone`);
    }
  });

  test('WIPE: a non-founder cannot delete the node or its subtree', async () => {
    await assertSucceeds(founder.ref(`bookstore_titles_deleted/${ID}`).set(STONE));
    for (const [who, ctx] of [['anon', anon], ['a stranger', stranger]]) {
      await assertFails(ctx.ref('bookstore_titles_deleted').set(null), `${who} wiped the node`);
      await assertFails(ctx.ref(`bookstore_titles_deleted/${ID}`).set(null), `${who} wiped a record`);
    }
  });

  test('⚠ THE SHOP\'S PRIVATE FIELDS ARE DENIED AT THE DATABASE, not just omitted by the writer', async () => {
    for (const leak of ['prices', 'epubPath', 'samplePath', 'synopsis', 'coverSizes', 'territoriesAllowed']) {
      await assertFails(
        founder.ref(`bookstore_titles_deleted/${ID}`).set({ ...STONE, [leak]: 'x' }),
        `${leak} reached a .read:true node`,
      );
    }
  });

  test('the id in the record must be the id in the path', async () => {
    await assertFails(founder.ref(`bookstore_titles_deleted/${ID}`).set({ ...STONE, titleId: 'something-else' }));
  });

  test('a record with no slug is refused — My Library keys the shelf on it', async () => {
    const { slug, ...noSlug } = STONE;
    await assertFails(founder.ref(`bookstore_titles_deleted/${ID}`).set(noSlug));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R31 · series_instalments_deleted — the burned ordinal', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The Series' tombstone, and DELIBERATELY NOT the bookstore's shape above. Two differences,
// both reasoned:
//
//   PRIVATE, not `.read: true`. bookstore_titles_deleted is public because My Library renders
//   it — a reader who owns a withdrawn book still sees its title and cover, and every field on
//   it was public while the book was on sale. Nobody owns an instalment, so no reader surface
//   reads this node at all. The ordinal GAP is public (the rows show 1, 2, 4); that a specific
//   instalment once existed, what it was, and when it went, is not something a reader was ever
//   told, and there is no surface asking to be told it.
//
//   THREE FIELDS, no content. It carries no title, no author, no cover — nothing that would
//   make it a shadow copy of the record it replaces. Its only job is to make the id
//   unreissuable, and the smallest record that does that job is the one least likely to grow
//   into a second, staler instalments node.
//
// The `$other: false` deny is copied verbatim from R21, and for R21's reason: it makes "this
// node holds no content" a property of the database rather than of one writer's field list.

  const ID = 'harness-series-i3';
  const STONE = { seriesId: 'harness-series', ordinal: 3, deletedAt: 1_800_000_000_000 };

  test('LEGITIMATE: a founder writes exactly what deletionPlan() produces', async () => {
    // The real planner's output, not a hand-typed fixture. A field added to the tombstone
    // without being added to the rule fails here rather than in production.
    const { deletionPlan } = await import('../../app/lib/series/deletion.js');
    const plan = deletionPlan({ id: ID, seriesId: 'harness-series', ordinal: 3, now: 1_800_000_000_000 });
    assert.equal(plan.tombstonePath, `series_instalments_deleted/${ID}`);
    await assertSucceeds(founder.ref(plan.tombstonePath).set(plan.tombstone));
  });

  test('⚠ NOBODY BUT A FOUNDER MAY READ IT — the gap is public, the record is not', async () => {
    await assertSucceeds(founder.ref(`series_instalments_deleted/${ID}`).set(STONE));
    for (const [who, ctx] of [['anon', anon], ['a stranger', stranger], ['the owner', owner]]) {
      await assertFails(ctx.ref(`series_instalments_deleted/${ID}`).get(), `${who} read a tombstone`);
      await assertFails(ctx.ref('series_instalments_deleted').get(), `${who} enumerated the node`);
    }
    // The founder can, which is what stops the denials above passing for a node that simply
    // does not exist.
    const snap = await founder.ref(`series_instalments_deleted/${ID}`).get();
    assert.equal(snap.val().ordinal, 3);
  });

  test('nobody but a founder may write one, or wipe one', async () => {
    await assertSucceeds(founder.ref(`series_instalments_deleted/${ID}`).set(STONE));
    for (const [who, ctx] of [['anon', anon], ['a stranger', stranger], ['the owner', owner]]) {
      await assertFails(ctx.ref(`series_instalments_deleted/${ID}`).set(STONE), `${who} wrote a tombstone`);
      // ⚠ THE SHARP ONE. Wiping the node un-burns every ordinal on the site, and the next
      // create would reissue an id a reader's saved position still names.
      await assertFails(ctx.ref(`series_instalments_deleted/${ID}`).set(null), `${who} un-burned an ordinal`);
      await assertFails(ctx.ref('series_instalments_deleted').set(null), `${who} wiped the whole node`);
    }
  });

  test('the record is CLOSED — it can never become a shadow copy of the instalment', async () => {
    for (const leak of ['title', 'author', 'synopsis', 'logline', 'epubPath', 'coverUrl', 'sponsorName']) {
      await assertFails(
        founder.ref(`series_instalments_deleted/${ID}`).set({ ...STONE, [leak]: 'x' }),
        `${leak} reached the tombstone`,
      );
    }
  });

  test('all three fields are required, and the ordinal must be a real one', async () => {
    for (const missing of ['seriesId', 'ordinal', 'deletedAt']) {
      const { [missing]: _drop, ...partial } = STONE;
      await assertFails(founder.ref(`series_instalments_deleted/${ID}`).set(partial), `${missing} was optional`);
    }
    await assertFails(founder.ref(`series_instalments_deleted/${ID}`).set({ ...STONE, ordinal: 0 }));
    await assertFails(founder.ref(`series_instalments_deleted/${ID}`).set({ ...STONE, ordinal: '3' }));
    await assertFails(founder.ref(`series_instalments_deleted/${ID}`).set({ ...STONE, deletedAt: 0 }));
  });

  test("⚠ AN ADMIN STILL CANNOT REACH A READER'S SAVED POSITION — the reason deletion spares it", async () => {
    // deletion.js ruling 3 rests on this being true. If a founder carve-out is ever added to
    // series_reading_progress, the ruling has to be revisited rather than silently outgrown.
    await assertSucceeds(owner.ref(`series_reading_progress/${OWNER}/${ID}`).set({ fraction: 0.6, updatedAt: 1 }));
    await assertFails(founder.ref(`series_reading_progress/${OWNER}/${ID}`).get(), 'a founder read a reader position');
    await assertFails(founder.ref(`series_reading_progress/${OWNER}/${ID}`).set(null), 'a founder deleted a reader position');
    // And it survives the instalment being removed, because they are different nodes.
    await assertSucceeds(founder.ref(`series_instalments/${ID}`).set(null));
    const kept = await owner.ref(`series_reading_progress/${OWNER}/${ID}`).get();
    assert.equal(kept.val().fraction, 0.6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("R21 · a withdrawal never reaches a reader's library", () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Ruling 2, at the rules layer. The CMS runs in a founder's browser, and the founder IS one of
// the two uids bookstore_purchases grants write to — so nothing in database.rules.json stops a
// bad admin write from revoking somebody's book. What stops it is that no such code path
// exists (asserted in tests/bookstore/withdrawal.test.mjs). These two tests pin the OTHER half:
// that the node's shape is unchanged by this round, and that a reader still cannot touch their
// own entitlement.

  test('a reader cannot grant or revoke their own purchase', async () => {
    await assertFails(owner.ref(`bookstore_purchases/${OWNER}/t1`).set({ status: 'active' }));
    await assertSucceeds(founder.ref(`bookstore_purchases/${OWNER}/t1`).set({ status: 'active', purchasedAt: 1 }));
    await assertFails(owner.ref(`bookstore_purchases/${OWNER}/t1/status`).set('revoked'));
  });

  test('a withdrawn or deleted TITLE leaves the purchase record untouched', async () => {
    await assertSucceeds(founder.ref(`bookstore_purchases/${OWNER}/t1`).set({
      status: 'active', purchasedAt: 1, slug: 't1', title: 'T', author: 'A', coverUrl: null,
    }));
    // The title goes; the entitlement stays. These are different nodes, and that separation is
    // the whole architecture of the ruling.
    await assertSucceeds(founder.ref('bookstore_titles/t1').set(null));
    const after = await owner.ref(`bookstore_purchases/${OWNER}/t1`).get();
    assert.equal(after.val().status, 'active');
    // And the denormalised fields My Library falls back to are still there.
    assert.equal(after.val().title, 'T');
    assert.equal(after.val().slug, 't1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R35 · open_pages — a published piece cannot be rewritten out from under its verdict', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// APP-O1 found three holes on this node. This block is the first rules test open_pages has
// ever had, which is the whole explanation for how they survived: the node shipped in R19,
// the behavioural suite next door covers fourteen other nodes, and nobody wrote these.
//
// THE SERIOUS ONE. `open_pages/$postId` granted `.write` to `data.child('authorUid').val()
// === auth.uid`, and the only thing pinned across the write was authorUid itself. So the
// author of an already-published piece could rewrite its BODY, its TITLE and its `moderation`
// field — the record of the Haiku verdict — with no re-screening at all. A piece passes the
// gate, is edited into anything, and the verdict is edited away behind it.
//
// The web's own edit UI did re-moderate. That was the trap: the re-screening was a property
// of THAT CLIENT, not of the platform, so the moderation was only ever as good as whichever
// client happened to be used, and anything holding the author's token — the app, a script, a
// console tab — bypassed it by writing straight to the RTDB.
//
// WHY "REFUSE" AND NOT "REQUIRE A FRESH VERDICT". A rule cannot tell a real verdict from a
// typed one. Whatever `moderation` object a rule demands, the client being constrained can
// write it: `{decision:'pass', checkedAt: now}` costs one line, and RTDB rules have no way to
// check a signature, call out, or know that a value came from the server. A freshness rule
// would have looked like a fix and enforced nothing. The only enforceable form of "must
// re-screen" is "the client cannot write the screened fields at all" — so the screening moved
// to where the credentials are, functions/api/open-pages/moderate.js, which now takes an
// optional postId and, on a pass, writes the new body and the FRESH verdict in one atomic
// PATCH. That also restores the trust model app/lib/openPages.js has claimed in prose since
// Stage 1 ("the public open_pages node is written EXCLUSIVELY by the server-side moderation
// function... RTDB rules deny all client writes"), which the rules had quietly drifted from.
//
// MID-EDIT, SCREEN UNAVAILABLE: the endpoint fails closed to open_pages_pending and does not
// write open_pages at all. The live piece keeps the body and the verdict it already had. An
// unreachable screen costs the EDIT, never the gate.

  const LIVE_POST = {
    authorUid: OWNER,
    authorName: 'A Reader',
    authorHandle: 'areader',
    authorAvatarUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg',
    title: 'Enough',
    body: 'The screened body.',
    coverImage: 'https://firebasestorage.googleapis.com/v0/b/x/o/c.jpg',
    genre: 'Inspiring',
    status: 'live',
    moderation: { decision: 'pass', reason: 'clean', checkedAt: 1, model: 'claude-haiku-4-5' },
    createdAt: 1,
    readCount: 12,
  };

  // ---- POSITIVES FIRST. Case 4 is load-bearing: a rule that breaks the product is wrong. ----

  test('LEGITIMATE: the whole live feed still works — publish, read, bump, moderate', async () => {
    // The server publishes with admin credentials (rules bypassed); the founder's own
    // client writes through the node-root grant, which is what admin/forum's approve()
    // and removePost() use.
    await assertSucceeds(founder.ref('open_pages/p1').set(LIVE_POST));
    // The feed is public — /open-pages and /public-library read it signed-out.
    await assertSucceeds(anon.ref('open_pages').get());
    await assertSucceeds(anon.ref('open_pages/p1').get());
    // Any signed-in reader bumps the counter on ANYONE's post: that is what
    // app/open-pages/[id]/page-client.js:221 does on mount, and an owner-scoped
    // rule here would break every read count on the site.
    await assertSucceeds(stranger.ref('open_pages/p1/readCount').set(13));
    await assertSucceeds(owner.ref('open_pages/p1/readCount').set(14));
    // A post with no readCount yet starts at 1 rather than being refused.
    await assertSucceeds(founder.ref('open_pages/p2').set({ ...LIVE_POST, readCount: null }));
    await assertSucceeds(stranger.ref('open_pages/p2/readCount').set(1));
    // And the founder keeps full control — approve overwrites, remove deletes.
    await assertSucceeds(founder.ref('open_pages/p1').set({ ...LIVE_POST, title: 'Enough (edited by admin)' }));
    await assertSucceeds(founder.ref('open_pages/p1').remove());
  });

  test('LEGITIMATE: all 7 shapes now live are accepted, including the 3 with no avatar', async () => {
    // MEASURED against production on 2026-09-03, and it changed the rule. Only 4 of the 7
    // live pieces carry `authorAvatarUrl` — buildAuthorSnapshot writes null when the author's
    // profile has no avatarUrl, and RTDB drops nulls — so a hasChildren() that required it
    // would have rejected 43% of the feed. (R35 also found an `editedAt` documented in
    // app/lib/openPages.js and present on ZERO records for the same reason — R36 retired
    // that field outright rather than leave two names for one idea; the reader-facing
    // "edited" mark reads `updatedAt`.)
    //
    // And 3 of the 7 carry moderation.decision === 'flag' while status === 'live': they hit
    // the fail-closed path, went to the queue, and a founder approved them. A rule saying
    // "live implies a passing verdict" would have rejected those three too. It is not written.
    const { authorAvatarUrl, ...noAvatar } = LIVE_POST;
    await assertSucceeds(founder.ref('open_pages/a').set(noAvatar));
    await assertSucceeds(founder.ref('open_pages/b').set({
      ...noAvatar,
      status: 'live',
      moderation: { decision: 'flag', categories: ['moderation-unavailable'], reason: 'moderation-unavailable', checkedAt: 1, model: 'claude-haiku-4-5' },
      approvedBy: FOUNDER_A,
      approvedAt: 2,
    }));
    await assertSucceeds(founder.ref('open_pages/c').set({ ...LIVE_POST, updatedAt: 3 }));
  });

  // ---- THE HOLE ----

  test('THE HOLE: the author can no longer rewrite a published body, title or verdict', async () => {
    await seed(env, { 'open_pages/p1': LIVE_POST });
    // This is the attack in one line: the piece keeps its "pass", and says something else.
    await assertFails(owner.ref('open_pages/p1/body').set('something that was never screened'));
    await assertFails(owner.ref('open_pages/p1/title').set('A different piece entirely'));
    // And the verdict itself cannot be edited away behind it.
    await assertFails(owner.ref('open_pages/p1/moderation').set({ decision: 'pass', checkedAt: 9, reason: 'typed by hand' }));
    await assertFails(owner.ref('open_pages/p1/moderation').remove());
    await assertFails(owner.ref('open_pages/p1/status').set('live'));
    // A whole-record set is the same write by another route.
    await assertFails(owner.ref('open_pages/p1').set({ ...LIVE_POST, body: 'unscreened' }));
    await assertFails(owner.ref('open_pages/p1').update({ body: 'unscreened', updatedAt: 2 }));
    // .validate never runs on a null write, so the delete is checked separately.
    await assertFails(owner.ref('open_pages/p1').remove());
    // The stored record is untouched by all of the above.
    const after = await anon.ref('open_pages/p1').get();
    assert.equal(after.val().body, 'The screened body.');
    assert.equal(after.val().moderation.decision, 'pass');
  });

  test('R36 · A FOUNDER-AUTHORED piece is a different case, and it is not covered', async () => {
    // Found by an R36 live probe that picked the first live piece, minted a token for
    // its author, expected a refusal — and got a write, because that piece is authored
    // by a FOUNDER. The two founder uids hold a node-level .write on open_pages for the
    // admin queue (approve/remove), so where the author IS a founder, "author" and
    // "admin" are one account and the R35 author rule cannot bite: they can rewrite
    // their own published body with no re-screening, through the admin grant.
    //
    // That is not a hole to close — removing the grant would break admin/forum's
    // approve() and removePost(), which are the only way a flagged piece ever goes
    // live. It is a STATED LIMIT of R35: the rule protects the six live pieces by
    // ordinary readers; the two founder-authored ones rely on the founder's own
    // discipline, exactly as every other founder-writable node does.
    //
    // Written down here because the R35 report implied the protection was universal.
    await seed(env, { 'open_pages/f1': { ...LIVE_POST, authorUid: FOUNDER_A } });
    await assertSucceeds(founder.ref('open_pages/f1/body').set('a founder rewriting their own piece'));
    // The ordinary-reader case is unchanged, which is the point of the comparison.
    await seed(env, { 'open_pages/p1': LIVE_POST });
    await assertFails(owner.ref('open_pages/p1/body').set('an ordinary author cannot'));
  });

  test('THE HOLE: the readCount leaf cannot be climbed to reach the body', async () => {
    await seed(env, { 'open_pages/p1': LIVE_POST });
    // The only client grant left on this node is the counter, so the interesting
    // question is whether it can be used as a foothold. A multi-path update is
    // evaluated per path, and the body path has no grant.
    await assertFails(owner.ref('open_pages/p1').update({ readCount: 13, body: 'unscreened' }));
    await assertFails(stranger.ref('open_pages/p1').update({ readCount: 13, title: 'defaced' }));
    await assertFails(owner.ref().update({ 'open_pages/p1/readCount': 13, 'open_pages/p1/body': 'unscreened' }));
    const after = await anon.ref('open_pages/p1').get();
    assert.equal(after.val().body, 'The screened body.');
    assert.equal(after.val().readCount, 12);
  });

  test('A STRANGER cannot touch a piece they did not write', async () => {
    await seed(env, { 'open_pages/p1': LIVE_POST });
    await assertFails(stranger.ref('open_pages/p1/body').set('defaced'));
    await assertFails(stranger.ref('open_pages/p1').remove());
    await assertFails(stranger.ref('open_pages').remove());
    await assertFails(anon.ref('open_pages/p1/body').set('defaced'));
    await assertFails(anon.ref('open_pages/p1/readCount').set(13));
  });

  test('READCOUNT: any signed-in account could set any post to any number', async () => {
    await seed(env, { 'open_pages/p1': LIVE_POST });
    // Hole 2. The old rule was `auth != null && newData.isNumber()`: type-constrained and
    // nothing else, so a stranger could set a stranger's post to 10,000,000 or back to 0.
    // The grant now demands the exact increment the client's runTransaction produces, which
    // is the strongest shape available for a counter no account owns.
    await assertFails(stranger.ref('open_pages/p1/readCount').set(10_000_000));
    await assertFails(stranger.ref('open_pages/p1/readCount').set(0));      // reset
    await assertFails(stranger.ref('open_pages/p1/readCount').set(11));     // decrement
    await assertFails(stranger.ref('open_pages/p1/readCount').set(14));     // +2, skipping
    await assertFails(stranger.ref('open_pages/p1/readCount').set(-1));
    await assertFails(stranger.ref('open_pages/p1/readCount').set('13'));
    await assertFails(stranger.ref('open_pages/p1/readCount').set(true));
    await assertFails(stranger.ref('open_pages/p1/readCount').set({ n: 13 }));
    // Un-wipeable: the numeric term is in the GRANT, not only in .validate, and
    // .validate never runs on a null write.
    await assertFails(stranger.ref('open_pages/p1/readCount').remove());
    // Exactly one, from the number that is actually stored.
    await assertSucceeds(stranger.ref('open_pages/p1/readCount').set(13));
    const after = await anon.ref('open_pages/p1/readCount').get();
    assert.equal(after.val(), 13);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R35 · open_pages_pending — the R33.1 catch-all, one node over', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Hole 3. `"$other": { ".validate": true }` — the exact shape R33.1 closed on square_posts.
// Its blast radius is the admin queue rather than the public feed, but it is the same defect:
// five fields were constrained and everything else was waved through, at any type and any
// size, into a node a founder reads by hand.
//
// MEASURED: open_pages_pending held 0 records on 2026-09-03, so no live record can break.
// The field list below is therefore taken from the WRITERS, not from the data — every key
// buildPendingPost produces, plus the three the edit path adds.
//
// NOTE FOR A LATER ROUND: the author `.write` grant on this node has no writer anywhere in
// this repo. moderate.js files pending records with the admin SDK, and admin/forum only ever
// writes null. It is the Stage-1 affordance app/lib/openPages.js documents. It is left in
// place because the React Native app is not visible from this container (see CLAUDE.md) and
// removing a grant an unseen client may still use is not a call to make blind — but if the
// app is confirmed not to use it, this grant should go, and the catch-all question with it.

  const PENDING = {
    authorUid: OWNER,
    authorName: 'A Reader',
    authorHandle: 'areader',
    authorAvatarUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg',
    title: 'Enough',
    body: 'A body awaiting review.',
    coverImage: 'https://firebasestorage.googleapis.com/v0/b/x/o/c.jpg',
    genre: 'Inspiring',
    status: 'flagged',
    moderation: { decision: 'flag', categories: ['explicit'], reason: 'held for review', checkedAt: 1, model: 'claude-haiku-4-5' },
    createdAt: 1,
  };

  // ---- POSITIVES FIRST ----

  test('LEGITIMATE: everything the two writers actually produce is accepted', async () => {
    // buildPendingPost is the create-path record, imported rather than retyped so a field
    // added to the writer and not to the rules fails HERE — the R18/R21 discipline.
    const built = buildPendingPost(
      { authorUid: OWNER, authorName: 'A Reader', authorHandle: 'areader', authorAvatarUrl: null },
      { title: 'Enough', body: 'A body.', coverImage: null, genre: 'Inspiring' },
      1,
    );
    // RTDB drops null children, which is exactly why coverImage and authorAvatarUrl are
    // absent from live records. Strip them the way the wire does.
    const onWire = Object.fromEntries(Object.entries(built).filter(([, v]) => v !== null));
    await assertSucceeds(owner.ref('open_pages_pending/n1').set(onWire));
    // And the rule must enumerate every key the writer CAN produce, including the ones
    // RTDB dropped above — `$other: false` is per-child, so a key that is only ever
    // written as null today becomes a refusal the day a profile gains an avatar.
    const pendingRule = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8'))
      .rules.open_pages_pending.$postId;
    const enumerated = new Set(Object.keys(pendingRule).filter((k) => !k.startsWith('.') && k !== '$other'));
    assert.equal(pendingRule.$other['.validate'], false, 'the catch-all must stay closed');
    const missing = Object.keys(built).filter((k) => !enumerated.has(k));
    assert.deepEqual(missing, [], `buildPendingPost writes ${missing.join(', ')}, which the rules do not enumerate`);
    // The edit path's REVISION record: the live post with the edit overlaid, plus the three
    // fields that mode adds. approvedBy/approvedAt are stripped by moderate.js because a
    // revision has not been approved — and they are NOT in the rules, so if that strip is
    // ever dropped, this node stops accepting the write and the queue stops filling.
    await assertSucceeds(owner.ref('open_pages_pending/n2').set({
      ...PENDING, readCount: 12, updatedAt: 2, revision: true,
    }));
    // A founder clears the queue on approve/remove.
    await assertSucceeds(founder.ref('open_pages_pending/n2').remove());
    // The author reads their own; a stranger does not.
    await assertSucceeds(owner.ref('open_pages_pending/n1').get());
    await assertFails(stranger.ref('open_pages_pending/n1').get());
  });

  // ---- THE CATCH-ALL ----

  test('THE CATCH-ALL: an unknown field is no longer waved through', async () => {
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, injected: 'x'.repeat(5000) }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, isAdmin: true }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, payload: { deeply: { nested: 'junk' } } }));
    await assertSucceeds(owner.ref('open_pages_pending/n1').set(PENDING));
    await assertFails(owner.ref('open_pages_pending/n1/injected').set('x'));
  });

  test('THE CATCH-ALL: every enumerated field is bounded by type, size or set', async () => {
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, authorName: 'x'.repeat(201) }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, authorHandle: 'x'.repeat(101) }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, authorAvatarUrl: 'x'.repeat(2001) }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, coverImage: 'x'.repeat(2001) }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, title: 'x'.repeat(201) }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, body: 'x'.repeat(50001) }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, genre: 'Erotica' }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, status: 'approved' }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, createdAt: 'yesterday' }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, readCount: -1 }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, revision: 'yes' }));
    // The moderation subtree has its own catch-all, closed the same way.
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, moderation: { decision: 'pass', checkedAt: 1, smuggled: 'x'.repeat(5000) } }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, moderation: { decision: 'approved', checkedAt: 1 } }));
    await assertFails(owner.ref('open_pages_pending/n1').set({ ...PENDING, moderation: { decision: 'pass' } }));
    // Every one of the six real genres still passes, so the set is a fence and not a wall.
    for (const g of ['Literary', 'Flash', 'Short Story', 'Poetry', 'Inspiring', 'General']) {
      await assertSucceeds(owner.ref('open_pages_pending/n1').set({ ...PENDING, genre: g }));
    }
  });

  test('R37 · ops/backup_liveness is founder-readable and client-unwritable', async () => {
    // The heartbeat the daily backup-liveness workflow writes. A founder must be able
    // to read it — it is how a human checks the checker when GitHub has quietly
    // disabled the cron after 60 days of repo inactivity, which is this system's real
    // silent-failure mode. Nobody may WRITE it, including a founder: a heartbeat a
    // person can forge is not evidence of anything.
    await seed(env, { 'ops/backup_liveness': { checkedAt: 1, ok: true, archiveCount: 13 } });
    await assertSucceeds(founder.ref('ops/backup_liveness').get());
    await assertFails(owner.ref('ops/backup_liveness').get());
    await assertFails(anon.ref('ops/backup_liveness').get());
    await assertFails(founder.ref('ops/backup_liveness').set({ ok: true }));
    await assertFails(founder.ref('ops/backup_liveness/ok').set(true));
    await assertFails(owner.ref('ops/backup_liveness').set({ ok: true }));
    await assertFails(anon.ref('ops/backup_liveness').remove());
    await assertFails(founder.ref('ops/backup_liveness').remove());
    let still;
    await env.withSecurityRulesDisabled(async (ctx) => {
      still = (await ctx.database().ref('ops/backup_liveness').get()).val();
    });
    assert.equal(still.archiveCount, 13, 'the heartbeat survived every attempt above');
  });

  test('R36 · open_pages_rate is unreachable from any client, in either direction', async () => {
    // The submission counter. It is admin-SDK-only on purpose: a reader who could
    // write it could zero their own count, and a reader who could READ it would learn
    // when every other account last published. Neither is worth the convenience of
    // showing someone their own remaining quota — the refusal message carries that.
    //
    // Seeded with rules disabled, because no client may create it either.
    await seed(env, { 'open_pages_rate/AAAAowner0000000000000000001/recent': [1, 2, 3] });
    await assertFails(owner.ref(`open_pages_rate/${OWNER}/recent`).get());
    await assertFails(owner.ref(`open_pages_rate/${OWNER}/recent`).set([]));
    await assertFails(owner.ref(`open_pages_rate/${OWNER}/recent`).remove());
    await assertFails(owner.ref(`open_pages_rate/${OWNER}`).remove());
    await assertFails(stranger.ref(`open_pages_rate/${OWNER}/recent`).get());
    await assertFails(stranger.ref(`open_pages_rate/${OWNER}/recent`).set([]));
    await assertFails(anon.ref('open_pages_rate').get());
    await assertFails(anon.ref('open_pages_rate').remove());
    // Not even a founder — the Pages Function holds service credentials, and a
    // founder's browser has no business rewriting anyone's spend counter.
    await assertFails(founder.ref(`open_pages_rate/${OWNER}/recent`).set([]));
    await assertFails(founder.ref(`open_pages_rate/${OWNER}/recent`).get());
    // The seeded value is untouched by all of the above. (withSecurityRulesDisabled
    // does not propagate its callback's return value — capture, don't return.)
    let still;
    await env.withSecurityRulesDisabled(async (ctx) => {
      still = (await ctx.database().ref(`open_pages_rate/${OWNER}/recent`).get()).val();
    });
    assert.deepEqual(still, [1, 2, 3]);
  });

  test('a stranger cannot file a pending post under someone else Uid, or wipe the queue', async () => {
    await assertFails(stranger.ref('open_pages_pending/n1').set(PENDING));      // authorUid is OWNER
    await seed(env, { 'open_pages_pending/n1': PENDING });
    await assertFails(stranger.ref('open_pages_pending/n1').remove());
    await assertFails(stranger.ref('open_pages_pending/n1/body').set('x'));
    await assertFails(anon.ref('open_pages_pending/n1').set(PENDING));
    await assertFails(stranger.ref('open_pages_pending').remove());
  });
});
