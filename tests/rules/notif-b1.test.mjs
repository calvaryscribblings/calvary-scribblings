// NOTIF-B1 — the stopgap on the two old inboxes (P0) and the server writer's three nodes (P1).
//
//   npm run test:rules   (emulator)
//
// P0, on library_notifications and notifications:
//   · a FIXED list of kinds, generated from app/lib/notificationKinds.js (checked below);
//   · `reward` and `new_story` only from a founder or the inbox's owner;
//   · the block barrier, both ways, on the sender the record names;
//   · the owner may delete a record of their own (and still never edit one).
// P0, elsewhere: the block barrier on followers (an unfollow is always allowed). The
// dm_conversations tightening is HELD BACK (A57) until the app's next round; its rules stay as main
// has them, and the web's increment is proved to pass under them.
// P1: inbox is read by its owner and written by no client at all; inbox_state/seenAt and
// notify_prefs are the owner's, closed shapes.
//
// The last block replays EVERY notification write the web makes today, in the shape each writer
// sends it (file and line beside each), so the stopgap is proved not to refuse the site's own writes.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeEnv, seed, assertFails, assertSucceeds, DB_RULES_PATH, OWNER, STRANGER, OTHER, FOUNDER_A, convIdFor } from './helpers.mjs';
import { LEGACY_KINDS, FOUNDER_OR_OWNER_KINDS, legacyKindPattern, PREFS } from '../../app/lib/notificationKinds.js';

let env, owner, stranger, other, founder, anon;
before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  other = env.authenticatedContext(OTHER).database();
  founder = env.authenticatedContext(FOUNDER_A).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const now = () => Date.now();
const INC = { '.sv': { increment: 1 } };
const NODES = ['library_notifications', 'notifications'];
const from = (uid, type = 'follow', extra = {}) => ({ type, fromUid: uid, fromName: 'S', read: false, createdAt: now(), ...extra });

describe('NOTIF-B1 · the kinds list is generated, not retyped', () => {
  test('the rules carry exactly the kinds in app/lib/notificationKinds.js', () => {
    const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8')).rules;
    for (const node of NODES) {
      assert.equal(rules[node].$uid.$notifId.type['.validate'], `newData.isString() && newData.val().matches(${legacyKindPattern(node)})`);
    }
    for (const k of Object.keys(PREFS)) assert.ok(rules.notify_prefs.$uid[k], `notify_prefs/${k}`);
  });
  test('scripts/notify/write-rules.mjs --check: the rules file is in step with its generator', () => {
    execFileSync(process.execPath, ['scripts/notify/write-rules.mjs', '--check'], { stdio: 'pipe' });
  });
});

describe('NOTIF-B1 P0 · kinds, and who may write reward and new_story', () => {
  for (const node of NODES) {
    for (const kind of Object.keys(LEGACY_KINDS[node]).filter((k) => !FOUNDER_OR_OWNER_KINDS.includes(k))) {
      test(`${node}: a reader may send "${kind}" under their own uid`, async () => {
        await assertSucceeds(stranger.ref(`${node}/${OWNER}/n1`).set(from(STRANGER, kind)));
      });
    }
    test(`${node}: a kind not on the list is refused, from anyone but no less from a stranger`, async () => {
      await assertFails(stranger.ref(`${node}/${OWNER}/n1`).set(from(STRANGER, 'system_notice')));
      await assertFails(stranger.ref(`${node}/${OWNER}/n2`).set(from(STRANGER, 'Reward')));
      await assertFails(founder.ref(`${node}/${OWNER}/n3`).set(from(FOUNDER_A, 'anything')));
    });
    for (const kind of FOUNDER_OR_OWNER_KINDS) {
      test(`${node}: a fake "${kind}" from another reader is refused`, async () => {
        await assertFails(stranger.ref(`${node}/${OWNER}/f1`).set(from(STRANGER, kind, { message: 'You earned 1,000 Scribbles', storyTitle: 'x' })));
        await assertFails(stranger.ref(`${node}/${OWNER}/f2`).set({ type: kind, createdAt: now(), read: false, fromName: 'Calvary Scribblings', message: 'x' }));
      });
      test(`${node}: "${kind}" from the owner to themselves, or from a founder, passes`, async () => {
        await assertSucceeds(owner.ref(`${node}/${OWNER}/o1`).set({ type: kind, createdAt: now(), read: false, fromName: 'Calvary Scribblings', message: 'm' }));
        await assertSucceeds(founder.ref(`${node}/${OWNER}/o2`).set({ type: kind, fromUid: OTHER, fromName: 'An Author', createdAt: now(), read: false }));
      });
    }
    test(`${node}: impersonation — a stranger cannot write under someone else's uid`, async () => {
      await assertFails(stranger.ref(`${node}/${OWNER}/i1`).set(from(OTHER, 'reply')));
      await assertFails(anon.ref(`${node}/${OWNER}/i2`).set(from(STRANGER, 'reply')));
    });
  }
});

describe('NOTIF-B1 P0 · the block barrier on both inboxes, both ways', () => {
  for (const node of NODES) {
    test(`${node}: the recipient blocked the sender → refused`, async () => {
      await seed(env, { [`blocked_users/${OWNER}/${STRANGER}`]: true });
      await assertFails(stranger.ref(`${node}/${OWNER}/b1`).set(from(STRANGER, 'reply')));
    });
    test(`${node}: the sender blocked the recipient → refused`, async () => {
      await seed(env, { [`blocked_users/${STRANGER}/${OWNER}`]: true });
      await assertFails(stranger.ref(`${node}/${OWNER}/b1`).set(from(STRANGER, 'reply')));
    });
    test(`${node}: a founder's new_story naming a blocked author is refused too`, async () => {
      await seed(env, { [`blocked_users/${OWNER}/${OTHER}`]: true });
      await assertFails(founder.ref(`${node}/${OWNER}/s1`).set({ type: 'new_story', fromUid: OTHER, fromName: 'A', createdAt: now(), read: false }));
    });
    test(`${node}: a block between two readers leaves a third alone, and the owner's own records`, async () => {
      await seed(env, { [`blocked_users/${OWNER}/${STRANGER}`]: true });
      await assertSucceeds(other.ref(`${node}/${OWNER}/c1`).set(from(OTHER, 'reply')));
      await assertSucceeds(owner.ref(`${node}/${OWNER}/r1`).set({ type: 'reward', createdAt: now(), read: false, message: 'm' }));
    });
  }
});

describe('NOTIF-B1 P0 · the owner may delete their own records', () => {
  for (const node of NODES) {
    test(`${node}: owner deletes one record; nobody else can; nobody edits; the inbox can't be wiped`, async () => {
      await seed(env, { [`${node}/${OWNER}/n1`]: from(STRANGER, 'reply'), [`${node}/${OWNER}/n2`]: from(STRANGER, 'reply') });
      await assertFails(stranger.ref(`${node}/${OWNER}/n1`).remove());
      await assertFails(founder.ref(`${node}/${OWNER}/n1`).remove());
      await assertFails(owner.ref(`${node}/${OWNER}/n1`).set(from(STRANGER, 'mention')));
      await assertSucceeds(owner.ref(`${node}/${OWNER}/n1`).remove());
      await assertSucceeds(owner.ref(`${node}/${OWNER}`).update({ n2: null }));
      await assertFails(owner.ref(`${node}/${OWNER}`).remove());
    });
  }
});

describe('NOTIF-B1 P0 · followers', () => {
  test('a block either way refuses a follow', async () => {
    await seed(env, { [`blocked_users/${OWNER}/${STRANGER}`]: true });
    await assertFails(stranger.ref(`followers/${OWNER}/${STRANGER}`).set(true));
    await env.clearDatabase();
    await seed(env, { [`blocked_users/${STRANGER}/${OWNER}`]: true });
    await assertFails(stranger.ref(`followers/${OWNER}/${STRANGER}`).set(true));
  });
  test('the web\'s one-update follow across a block lands neither half', async () => {
    await seed(env, { [`blocked_users/${OWNER}/${STRANGER}`]: true });
    await assertFails(stranger.ref().update({ [`followers/${OWNER}/${STRANGER}`]: true, [`following/${STRANGER}/${OWNER}`]: true }));
    let v;
    await env.withSecurityRulesDisabled(async (c) => { v = (await c.database().ref(`following/${STRANGER}/${OWNER}`).get()).val(); });
    assert.equal(v, null);
  });
  test('an unfollow is always allowed, blocked or not', async () => {
    await seed(env, { [`followers/${OWNER}/${STRANGER}`]: true, [`blocked_users/${OWNER}/${STRANGER}`]: true });
    await assertSucceeds(stranger.ref(`followers/${OWNER}/${STRANGER}`).remove());
  });
  test('no block: follow and unfollow (control)', async () => {
    await assertSucceeds(stranger.ref(`followers/${OWNER}/${STRANGER}`).set(true));
    await assertSucceeds(stranger.ref(`followers/${OWNER}/${STRANGER}`).remove());
  });
});

describe('NOTIF-B1 · dm_conversations is HELD BACK (A57): the rules main has today, unchanged', () => {
  const CONV = convIdFor(OWNER, STRANGER);
  test('the generator leaves dm_conversations exactly as it finds it', async () => {
    const { build } = await import('../../scripts/notify/write-rules.mjs');
    const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8'));
    assert.deepEqual(build(rules).rules.dm_conversations, rules.rules.dm_conversations);
    assert.equal(JSON.stringify(rules.rules.dm_conversations).includes('now'), false, 'no lastAt window shipped');
  });
  test('the web\'s increment, and the old set-to-1 the app still sends, both pass today', async () => {
    await assertSucceeds(stranger.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: INC, lastAt: now() }));
    await assertSucceeds(stranger.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: INC, lastAt: now() }));
    let v;
    await env.withSecurityRulesDisabled(async (c) => { v = (await c.database().ref(`dm_conversations/${OWNER}/${CONV}/unread`).get()).val(); });
    assert.equal(v, 2);
    await assertSucceeds(stranger.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: 1, lastAt: now() }));
    await assertSucceeds(owner.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: 0 }));
  });
});

// A57 (4 Nov 2026): the app session confirmed what the app writes. Each is its own write after the
// event has landed, so a refusal never sinks the event; these prove none is refused. Field sets are
// the ones production holds for app-written records (fromHandle and storyTitle are app-only).
describe('NOTIF-B1 · every write the app makes (A57) passes, with its exact fields', () => {
  const S = 'a-story', C = '-Ncomment00000000001', P = '-Npost00000000000001';
  const who = { fromUid: STRANGER, fromName: 'R', fromHandle: 'r', fromAvatarUrl: 'https://x/a.jpg' };
  const base = () => ({ ...who, read: false, createdAt: now() });
  const lib = {
    follow: () => ({ type: 'follow', ...base() }),
    heart: () => ({ type: 'heart', ...base(), slug: S, storyTitle: 'T', commentId: C, commentText: 'words' }),
    fire: () => ({ type: 'fire', ...base(), slug: S, storyTitle: 'T', commentId: C, commentText: 'words' }),
    quill: () => ({ type: 'quill', ...base(), slug: S, storyTitle: 'T' }),
    reply: () => ({ type: 'reply', ...base(), slug: S, storyTitle: 'T', commentId: C, commentText: 'words' }),
    mention: () => ({ type: 'mention', ...base(), slug: S, storyTitle: 'T', commentText: 'hi @o' }),
  };
  const sq = (type, extra = {}) => () => ({ type, ...base(), fromUsername: 'r', postId: P, ...extra });
  const square = {
    mention: sq('mention'),
    square_quote: sq('square_quote', { quotedPostId: P }),
    square_post: sq('square_post'),
    square_reply: sq('square_reply', { threadId: P }),
    square_reply_to_you: sq('square_reply_to_you', { threadId: P }),
    like: sq('like', { threadId: P }),
    clap: sq('clap', { slug: S }),
    fire: sq('fire', { slug: S }),
  };
  for (const [kind, make] of Object.entries(lib)) {
    test(`app → library_notifications · ${kind}`, async () => {
      await assertSucceeds(stranger.ref(`library_notifications/${OWNER}`).push(make()));
    });
  }
  for (const [kind, make] of Object.entries(square)) {
    test(`app → notifications · ${kind}`, async () => {
      await assertSucceeds(stranger.ref(`notifications/${OWNER}`).push(make()));
    });
  }
  test('app → library_notifications · the read-milestone reward to your own inbox (no fromUid)', async () => {
    await assertSucceeds(owner.ref(`library_notifications/${OWNER}`).push({
      type: 'reward', fromName: 'Calvary Scribblings', message: 'You earned 5 Scribbles — 10 stories read milestone!', read: false, createdAt: now(),
    }));
    // …and the same shape into anyone else's inbox is still refused.
    await assertFails(stranger.ref(`library_notifications/${OWNER}`).push({
      type: 'reward', fromName: 'Calvary Scribblings', message: 'x', read: false, createdAt: now(),
    }));
  });
  test('the app\'s kinds are all on the list (A57)', () => {
    for (const k of Object.keys(lib).concat('reward')) assert.ok(LEGACY_KINDS.library_notifications[k], k);
    for (const k of Object.keys(square)) assert.ok(LEGACY_KINDS.notifications[k], k);
  });
});

describe('NOTIF-B1 P1 · inbox, inbox_state, notify_prefs', () => {
  test('inbox: no client writes it — not its owner, not a stranger, not a founder', async () => {
    const rec = { kind: 'reply', actor: STRANGER, subject: { slug: 's', commentId: 'c' }, at: now() };
    await assertFails(owner.ref(`inbox/${OWNER}/r1`).set(rec));
    await assertFails(stranger.ref(`inbox/${OWNER}/r1`).set(rec));
    await assertFails(founder.ref(`inbox/${OWNER}/r1`).set(rec));
    await seed(env, { [`inbox/${OWNER}/r1`]: rec });
    await assertFails(owner.ref(`inbox/${OWNER}/r1`).remove());
  });
  test('inbox: its owner reads it; nobody else', async () => {
    await seed(env, { [`inbox/${OWNER}/r1`]: { kind: 'reply', actor: STRANGER, at: now() } });
    await assertSucceeds(owner.ref(`inbox/${OWNER}`).get());
    await assertFails(stranger.ref(`inbox/${OWNER}`).get());
    await assertFails(anon.ref(`inbox/${OWNER}`).get());
    await assertFails(stranger.ref('inbox').get());
  });
  test('inbox_state/seenAt: the owner writes a time, nothing else, not in the future', async () => {
    await assertSucceeds(owner.ref(`inbox_state/${OWNER}/seenAt`).set(now()));
    await assertSucceeds(owner.ref(`inbox_state/${OWNER}/seenAt`).set({ '.sv': 'timestamp' }));
    await assertFails(owner.ref(`inbox_state/${OWNER}/seenAt`).set(now() + 86400000));
    await assertFails(owner.ref(`inbox_state/${OWNER}/seenAt`).set('today'));
    await assertFails(owner.ref(`inbox_state/${OWNER}/other`).set(1));
    await assertFails(stranger.ref(`inbox_state/${OWNER}/seenAt`).set(now()));
    await assertFails(stranger.ref(`inbox_state/${OWNER}`).get());
  });
  test('notify_prefs: one boolean per switch, the owner\'s alone', async () => {
    const all = Object.fromEntries(Object.keys(PREFS).map((k) => [k, false]));
    await assertSucceeds(owner.ref(`notify_prefs/${OWNER}`).set(all));
    await assertSucceeds(owner.ref(`notify_prefs/${OWNER}/square_opens`).set(true));
    await assertFails(owner.ref(`notify_prefs/${OWNER}/reactions`).set('off'));
    await assertFails(owner.ref(`notify_prefs/${OWNER}/marketing`).set(true));
    await assertFails(stranger.ref(`notify_prefs/${OWNER}/reactions`).set(false));
    await assertFails(stranger.ref(`notify_prefs/${OWNER}`).get());
    await assertSucceeds(owner.ref(`notify_prefs/${OWNER}`).get());
  });
});

// Every write the web makes to these nodes today, as its writer sends it. A refusal here is the
// stopgap breaking the site. (null fields are what the SDK drops; they are left out.)
describe('NOTIF-B1 P0 · every legitimate web write still passes', () => {
  const S = 'a-story', C = '-Ncomment00000000001', P = '-Npost00000000000001';
  const cases = [
    ['stories/[slug]/page-client.js:587 · reaction on a response', 'library_notifications', STRANGER, (t) => ({ type: t, fromUid: STRANGER, fromName: 'R', slug: S, commentId: C, commentText: 'words', read: false, createdAt: now() }), ['heart', 'fire', 'clap']],
    ['reader/[slug]/page-reader.js:286 · reaction in the reader', 'library_notifications', STRANGER, (t) => ({ type: t, fromUid: STRANGER, fromName: 'R', slug: S, read: false, createdAt: now() }), ['heart', 'fire', 'clap']],
    ['stories/[slug]/page-client.js:662 · reply to a response', 'library_notifications', STRANGER, () => ({ type: 'reply', fromUid: STRANGER, fromName: 'R', slug: S, commentId: C, commentText: 'words', read: false, createdAt: now() })],
    ['reader/[slug]/page-reader.js:330 · reply in the reader', 'library_notifications', STRANGER, () => ({ type: 'reply', fromUid: STRANGER, fromName: 'R', slug: S, read: false, createdAt: now() })],
    ['lib/mentions.js:35 · a mention', 'library_notifications', STRANGER, () => ({ type: 'mention', fromUid: STRANGER, fromName: 'R', slug: S, commentText: 'hi @o', read: false, createdAt: now() })],
    ['user/page.js:423 · a follow', 'library_notifications', STRANGER, () => ({ type: 'follow', fromUid: STRANGER, fromName: 'R', read: false, createdAt: now() })],
    ['lib/readCredit.js:56 · your own reading reward', 'library_notifications', OWNER, () => ({ type: 'reward', fromName: 'Calvary Scribblings', message: 'You earned 5 Scribbles — 10 stories read milestone!', read: false, createdAt: now() })],
    ['stories/[slug]/page-client.js:688 · your own response reward', 'library_notifications', OWNER, () => ({ type: 'reward', fromName: 'Calvary Scribblings', message: 'You earned 10 Scribbles — x!', read: false, createdAt: now() })],
    ['admin/page.js:1158 · the CMS follower fan-out (a founder)', 'library_notifications', FOUNDER_A, () => ({ type: 'new_story', fromUid: OTHER, fromName: 'An Author', storySlug: S, storyTitle: 'T', read: false, createdAt: now() })],
    ['square/page.js:935 · reaction on a Square post', 'notifications', STRANGER, (t) => ({ type: t, fromUid: STRANGER, fromName: 'R', fromUsername: 'r', fromAvatarUrl: 'https://x/a.jpg', postId: P, read: false, createdAt: now() }), ['like', 'clap', 'fire']],
    ['square/p/page.js:449 · reaction in a thread', 'notifications', STRANGER, (t) => ({ type: t, fromUid: STRANGER, fromName: 'R', fromUsername: 'r', postId: P, threadId: P, read: false, createdAt: now() }), ['like', 'clap', 'fire']],
    ['square/page.js:808 · a mention in the Square', 'notifications', STRANGER, () => ({ type: 'mention', fromUid: STRANGER, fromName: 'R', fromUsername: 'r', postId: P, read: false, createdAt: now() })],
    ['square/page.js:817 · follower fan-out (until ruling 320 is built)', 'notifications', STRANGER, () => ({ type: 'square_post', fromUid: STRANGER, fromName: 'R', postId: P, read: false, createdAt: now() })],
    ['square/page.js:883 · a quote', 'notifications', STRANGER, () => ({ type: 'square_quote', fromUid: STRANGER, fromName: 'R', postId: P, quotedPostId: P, read: false, createdAt: now() })],
    ['square/p/page.js:386 · thread replies and mentions', 'notifications', STRANGER, (t) => ({ type: t, fromUid: STRANGER, fromName: 'R', postId: P, threadId: P, read: false, createdAt: now() }), ['square_reply', 'square_reply_to_you', 'mention']],
    ['open-pages/[id]/page-client.js:654 · an Open Pages reply', 'notifications', STRANGER, () => ({ type: 'open_pages_reply', fromUid: STRANGER, fromName: 'R', fromAvatarUrl: 'https://x/a.jpg', postId: P, read: false, createdAt: now() })],
  ];
  for (const [where, node, as, make, types = [null]] of cases) {
    test(where, async () => {
      const db = as === OWNER ? owner : as === FOUNDER_A ? founder : stranger;
      for (const t of types) await assertSucceeds(db.ref(`${node}/${OWNER}`).push(make(t)));
    });
  }
  test('profile/page.js:542 and square/page.js:428 · marking read', async () => {
    await seed(env, { [`library_notifications/${OWNER}/n1`]: from(STRANGER, 'reply'), [`notifications/${OWNER}/n1`]: from(STRANGER, 'square_post') });
    await assertSucceeds(owner.ref(`library_notifications/${OWNER}`).update({ 'n1/read': true }));
    await assertSucceeds(owner.ref(`notifications/${OWNER}`).update({ 'n1/read': true }));
  });
  test('every kind production holds can still be marked read (the record validates whole)', async () => {
    for (const node of NODES) for (const kind of Object.keys(LEGACY_KINDS[node])) {
      await seed(env, { [`${node}/${OWNER}/${kind}`]: from(OTHER, kind) });
      await assertSucceeds(owner.ref(`${node}/${OWNER}/${kind}/read`).set(true));
    }
  });
  test('components/square/MessagesPanel.js:181,237,240 · the two conversation entries', async () => {
    const CONV = convIdFor(OWNER, STRANGER);
    await assertSucceeds(stranger.ref(`dm_conversations/${STRANGER}/${CONV}`).update({ unread: 0, lastAt: now() }));
    await assertSucceeds(stranger.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: INC, lastAt: now() }));
    await assertSucceeds(owner.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: 0 }));
    // The web before NOTIF-B1 set the count to 1 (the app still does); today's rules accept it.
    await assertSucceeds(stranger.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: 1, lastAt: now() }));
    await assertSucceeds(stranger.ref(`dm_conversations/${OWNER}/${CONV}`).update({ unread: 1, lastAt: now() }));
  });
  test('user/page.js:417-422 · follow (one update, both halves) and unfollow', async () => {
    await assertSucceeds(stranger.ref().update({ [`followers/${OWNER}/${STRANGER}`]: true, [`following/${STRANGER}/${OWNER}`]: true }));
    await assertSucceeds(stranger.ref(`followers/${OWNER}/${STRANGER}`).remove());
    await assertSucceeds(stranger.ref(`following/${STRANGER}/${OWNER}`).remove());
  });
});
