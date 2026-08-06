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
import {
  makeEnv, seed, assertFails, assertSucceeds,
  OWNER, STRANGER, OTHER, FOUNDER_A, convIdFor,
} from './helpers.mjs';
// R9.1 LB-9: the client half of the waitlist email check, asserted against the rule half in
// the same test so the two cannot drift. See the note above the ACCEPTED/REJECTED tables.
import { isEmailShaped } from '../../app/lib/bookstore/gate.js';

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
  const post = (uid) => ({
    authorUid: uid, authorName: 'R', authorInitials: 'R', createdAt: now(),
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

  test('LEGITIMATE: a founder can moderate (square/page.js:1037 pin, 1057 delete)', async () => {
    await seed(env, { [`square_posts/${POST}`]: post(OWNER) });
    await assertSucceeds(founder.ref(`square_posts/${POST}`).update({ pinned: true }));
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
