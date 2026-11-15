// P4-B1 — personal pushes end to end: POST /api/notify enqueues, POST /api/push/drain sends, both run
// UNMODIFIED against the RTDB emulator under Cloudflare's limits (50 subrequests, 6 connections; every
// call must also stay inside SUBREQUEST_BUDGET, 45). Expo is a stand-in that records what it is sent;
// Google's endpoints are the proofs harness's. Every clock is injected, so 08:00 and the hour arrive
// without waiting.
//
//   npm run test:notify:emulator
//
// Invented readers only (and one founder uid, for the founders-only path, in the emulator only).
// Nothing reaches production or Expo.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, installLimits, loadRules, wipe, get, set, request, context, tokenFor, ENV } from '../proofs/harness.mjs';
import { handleNotify } from '../../functions/api/notify.js';
import { handleDrain, EXPO_SEND_URL } from '../../functions/api/push/drain.js';
import { handleRelease, sha256Hex } from '../../functions/api/push/release.js';
import { SUBREQUEST_BUDGET } from '../../functions/api/_budget.js';
import { MENTION_CAP } from '../../app/lib/notificationKinds.js';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';
import { DAILY_CAP, MORNING_CAP, queueKey } from '../../app/lib/pushP4.js';

const SECRET = 'invented-drain-secret-0123456789';
const DRAIN_ENV = { ...ENV, PUSH_DRAIN_SECRET: SECRET, EXPO_ACCESS_TOKEN: 'invented-expo-token' };
const T = (iso) => Date.parse(iso);
const MIN = 60000;
const SLUG = 'invented-story';
const U = Object.fromEntries(['writer', 'ada', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kit']
  .map((n) => [n, `${n}${'0'.repeat(20 - n.length)}uid`]));
const NAME = (u) => `Name-${Object.keys(U).find((k) => U[k] === u)}`;
const TOKEN = (u, n = 1) => `ExponentPushToken[invented-${u.slice(0, 6)}-${n}]`;
const id = (n) => `-Ninvented${String(n).padStart(10, '0')}`;

let L, inner;
const expo = { sent: [], fail: null, dead: new Set() };

before(async () => {
  install();
  inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === EXPO_SEND_URL) {
      if (expo.fail) { const f = expo.fail; expo.fail = null; throw f; }
      const msgs = JSON.parse(init.body);
      expo.sent.push(...msgs);
      const data = msgs.map((m, i) => (expo.dead.has(m.to)
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: `ticket-${expo.sent.length}-${i}` }));
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
  L = installLimits({ limit: 50, connections: 6 });
  await loadRules();
});
after(() => { L.uninstall(); globalThis.fetch = inner; uninstall(); });
beforeEach(async () => {
  await wipe();
  expo.sent.length = 0; expo.fail = null; expo.dead.clear();
  for (const [name, uid] of Object.entries(U)) {
    await set(`users/${uid}`, { displayName: `Name-${name}`, username: name });
    await set(`usernames/${name}`, uid);
  }
  await set(`cms_stories_index/${SLUG}`, { title: 'An Invented Story', authorUid: U.writer, published: true });
});

/** A device for `uid`, A60 or not. */
const device = (uid, { n = 1, caps = 1, updatedAt = T('2026-11-01T00:00:00Z'), installHash } = {}) =>
  set(`push_tokens/${uid}/key${n}`, { token: TOKEN(uid, n), platform: 'ios', appVersion: '1.7.1', updatedAt, ...(caps ? { pushCaps: caps } : {}), ...(installHash ? { installHash } : {}) });

async function notify(as, event, subjectId, now) {
  L.begin();
  const stats = {};
  const { ctx } = context(request('/api/notify', { body: { event, subjectId }, token: tokenFor(as) }));
  const res = await handleNotify(ctx, { now, stats });
  L.end();
  const used = L.calls.at(-1);
  assert.ok(used <= SUBREQUEST_BUDGET, `notify made ${used} subrequests (budget ${SUBREQUEST_BUDGET})`);
  assert.equal(L.refused, 0);
  assert.equal(res.status, 200);
  return { ...stats, shim: used };
}

async function drain(now, { dry = false, secret = SECRET, env = DRAIN_ENV, foundersOnly = false, limit } = {}) {
  L.begin();
  const stats = {};
  const req = request(`/api/push/drain${dry ? '?dry=1' : ''}`, { token: secret });
  const { ctx } = context(req, env);
  const res = await handleDrain(ctx, { now, stats, foundersOnly, ...(limit ? { limit } : {}) });
  L.end();
  const used = L.calls.at(-1);
  assert.ok(used <= SUBREQUEST_BUDGET, `the drain made ${used} subrequests (budget ${SUBREQUEST_BUDGET})`);
  assert.equal(L.refused, 0);
  return { status: res.status, body: await res.json(), stats: { ...stats, shim: used } };
}

const post = (pid, author, extra = {}) => set(`square_posts/${pid}`, { text: 'a post', authorUid: author, createdAt: 0, ...extra });
const comment = (cid, author, text, extra = {}) => set(`comments/${SLUG}/${cid}`, { text, authorUid: author, authorName: 'x', createdAt: 0, ...extra });
const queue = async () => (await get('push_queue')) || {};

/** Ben likes Ada's Square post id(n) at `now` (a kind 375 leaves held overnight). */
async function benReacts(n, now) {
  await post(id(n), U.ada);
  await set(`square_reactions/${id(n)}/like/${U.ben}`, true);
  return notify(U.ben, 'square_reaction', `${id(n)}/like`, now);
}

/** Ben replies to Ada's Square post at `now`. */
async function benReplies(n, now, text = 'What a line.') {
  await post(id(100), U.ada);
  await post(id(n), U.ben, { parentId: id(100), text });
  return notify(U.ben, 'square_post', id(n), now);
}

describe('notify: the queue rides the write it already makes', () => {
  test('a reply: one queue entry, inside the old-note PATCH, no extra subrequest', async () => {
    const now = T('2026-11-14T12:00:00Z');
    const r = await benReplies(1, now);
    assert.equal(r.queued, 1);
    const q = await queue();
    assert.deepEqual(Object.keys(q), [queueKey(U.ada, `reply:sq:${id(1)}`)]);
    assert.deepEqual(q[queueKey(U.ada, `reply:sq:${id(1)}`)], { uid: U.ada, rid: `reply:sq:${id(1)}`, kind: 'reply', at: now, dueAt: now });
    console.log(`  notify, 1 recipient (a Square reply): ${r.shim} subrequests`);
  });

  test('8 recipients: a reply to a reply naming six readers, on a writer\'s story — at most 45', async () => {
    const now = T('2026-11-14T12:00:00Z');
    const handles = ['cal', 'dee', 'eve', 'fay', 'gus', 'hal'];
    await comment(id(1), U.kit, 'first');
    await comment(id(2), U.ben, 'second', { parentId: id(1) });
    await comment(id(3), U.ada, handles.map((h) => `@${h}`).join(' '), { parentId: id(1), replyToId: id(2) });
    const r = await notify(U.ada, 'comment', `${SLUG}/${id(3)}`, now);
    console.log(`  notify, 8 recipients (reply-to-reply + ${MENTION_CAP} mentions + the writer): ${r.shim} subrequests, ${r.queued} queued`);
    assert.equal(r.delivered, 8);
    assert.equal(r.dropped, 0);
    assert.equal(r.queued, 8);
  });

  test('a message (no old note): the PATCH is reserved, and still within budget', async () => {
    const now = T('2026-11-14T12:00:00Z');
    const conv = [U.ada, U.ben].sort().join('_');
    await set(`dm_messages/${conv}/${id(1)}`, { text: 'hi', senderUid: U.ben, createdAt: now });
    const r = await notify(U.ben, 'message', `${conv}/${id(1)}`, now);
    assert.equal(r.queued, 1);
    console.log(`  notify, a message: ${r.shim} subrequests`);
  });

  test('a queue entry never crowds an inbox write out: under a budget for exactly one recipient, it is told and queued', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await post(id(100), U.ada);
    await post(id(1), U.ben, { parentId: id(100) });
    L.begin();
    const stats = {};
    const { ctx } = context(request('/api/notify', { body: { event: 'square_post', subjectId: id(1) }, token: tokenFor(U.ben) }));
    // lookup 1, token 1, post 1, root author 1, sender 1 = 5; shared 1 + PATCH 1; one recipient 3 = 10.
    await handleNotify(ctx, { now, stats, limit: 10 });
    L.end();
    assert.equal(stats.delivered, 1);
    assert.equal(stats.queued, 1);
    assert.ok(stats.used <= 10);
  });
});

describe('notify: replyToId tells the author of the reply answered, falling back to parentId', () => {
  test('the reply answered, not the parent', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await comment(id(1), U.cal, 'the response');
    await comment(id(2), U.ben, 'a reply', { parentId: id(1) });
    await comment(id(3), U.ada, 'a reply to the reply', { parentId: id(1), replyToId: id(2) });
    await notify(U.ada, 'comment', `${SLUG}/${id(3)}`, now);
    assert.equal(Object.values((await get(`inbox/${U.ben}`)) || {})[0]?.kind, 'reply');
    assert.equal(await get(`inbox/${U.cal}`), null, 'the parent\'s author is not told');
    const old = Object.values((await get(`library_notifications/${U.ben}`)) || {})[0];
    assert.equal(old.commentId, id(2), 'the old note names the reply answered');
  });
  test('falling back to the parent when the reply answered is gone', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await comment(id(1), U.cal, 'the response');
    await comment(id(3), U.ada, 'a reply to a deleted reply', { parentId: id(1), replyToId: id(2) });
    await notify(U.ada, 'comment', `${SLUG}/${id(3)}`, now);
    assert.equal(Object.values((await get(`inbox/${U.cal}`)) || {})[0]?.kind, 'reply');
  });
});

describe('the drain', () => {
  test('refuses without its secrets; dry needs no Expo token, writes nothing and calls no one', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await benReplies(1, now);
    assert.equal((await drain(now, { env: { ...DRAIN_ENV, PUSH_DRAIN_SECRET: '' } })).status, 503);
    assert.equal((await drain(now, { secret: 'wrong-secret-wrong-secret-0000000' })).status, 401);
    assert.equal((await drain(now, { env: { ...DRAIN_ENV, EXPO_ACCESS_TOKEN: '' } })).status, 503);
    const before = await queue();
    const d = await drain(now, { dry: true, env: { ...DRAIN_ENV, EXPO_ACCESS_TOKEN: '' } });
    assert.equal(d.status, 200);
    assert.equal(d.stats.sent, 1);
    assert.equal(d.stats.messages[0].title, 'Name-ben replied to your post');
    assert.equal(expo.sent.length, 0, 'no Expo call');
    assert.deepEqual(await queue(), before, 'no write');
    assert.equal(await get('ops/push_drain'), null);
  });

  test('sends a reply at once: the row\'s words, its href, the people channel, the badge; tickets kept', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await set(`inbox_state/${U.ada}/seenAt`, now - 60 * MIN);
    await benReplies(1, now);
    const d = await drain(now + 5000);
    console.log(`  drain, 1 push: ${d.stats.shim} subrequests`);
    assert.equal(d.status, 200);
    assert.equal(expo.sent.length, 1);
    const m = expo.sent[0];
    assert.equal(m.to, TOKEN(U.ada));
    assert.equal(m.title, 'Name-ben replied to your post');
    assert.equal(m.body, '“What a line.”');
    assert.equal(m.data.url, `/square/p?id=${id(100)}&reply=${id(1)}`);
    assert.equal(m.channelId, 'people');
    assert.equal(m.sound, 'default');
    assert.equal(m.badge, 1);
    const receipts = Object.values((await get('push_receipts')) || {});
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].kind, 'personal');
    assert.equal(typeof (await get('ops/push_drain/lastRunAt')), 'number');
    // The next run clears the entry and sends nothing more.
    const again = await drain(now + 70000);
    assert.equal(again.stats.cleared, 1);
    assert.equal(expo.sent.length, 1);
    assert.deepEqual(await queue(), {});
  });

  test('an empty queue: three subrequests at most, and the heartbeat', async () => {
    const d = await drain(T('2026-11-14T12:00:00Z'));
    assert.ok(d.stats.shim <= 3, `${d.stats.shim}`);
    assert.equal(await get('ops/push_drain/lastRunAt'), T('2026-11-14T12:00:00Z'));
  });

  test('THE 08:00 HOLD, without waiting: a reaction at 02:00 waits, nothing at 07:59, sent at 08:00', async () => {
    await device(U.ada);
    await benReacts(1, T('2026-11-14T02:00:00Z'));
    await drain(T('2026-11-14T02:00:30Z'));
    assert.equal(expo.sent.length, 0);
    assert.equal(Object.values(await queue())[0].dueAt, T('2026-11-14T08:00:00Z'), 'rescheduled to 08:00 London');
    await drain(T('2026-11-14T07:59:00Z'));
    assert.equal(expo.sent.length, 0, 'not before 08:00');
    await drain(T('2026-11-14T08:00:00Z'));
    assert.equal(expo.sent.length, 1);
  });

  test('a block added during the hold: silent at 08:00', async () => {
    await device(U.ada);
    await benReacts(1, T('2026-11-14T02:00:00Z'));
    await drain(T('2026-11-14T02:01:00Z'));
    await set(`blocked_users/${U.ada}/${U.ben}`, true);
    const d = await drain(T('2026-11-14T08:00:00Z'));
    assert.equal(expo.sent.length, 0);
    assert.equal(d.stats.dropped.silenced, 1);
  });

  // P4-B4 — rulings 375 and 376 end to end, under an injected clock.
  test('375: a message at 02:00 goes at 02:00, and so does a reply', async () => {
    const two = T('2026-11-14T02:00:00Z');
    await device(U.ada);
    const conv = [U.ada, U.ben].sort().join('_');
    await set(`dm_messages/${conv}/${id(1)}`, { text: 'words never pushed', senderUid: U.ben, createdAt: two });
    await notify(U.ben, 'message', `${conv}/${id(1)}`, two);
    await benReplies(2, two);
    const d = await drain(two + 1000);
    assert.equal(d.stats.later, 0, 'nothing waits for 08:00');
    assert.deepEqual(expo.sent.map((m) => m.body).sort(), ['Name-ben sent you a message', '“What a line.”'].sort());
    const day = await get(`push_state/${U.ada}/_day`);
    assert.equal(day.morning, 0, 'not one of the morning three');
  });

  test('375: a reaction at 02:00 still waits for 08:00', async () => {
    await device(U.ada);
    await benReacts(1, T('2026-11-14T02:00:00Z'));
    const d = await drain(T('2026-11-14T02:00:01Z'));
    assert.equal(d.stats.later, 1);
    assert.equal(expo.sent.length, 0);
    assert.equal(Object.values(await queue())[0].dueAt, T('2026-11-14T08:00:00Z'));
  });

  test('375 at deploy: an entry held for 08:00 before the change keeps 08:00, nothing earlier, not stale', async () => {
    await device(U.ada);
    await benReplies(1, T('2026-11-14T02:00:00Z'));
    // What the drain before P4-B4 wrote for a reply at 02:00: the entry moved to 08:00.
    const key = queueKey(U.ada, `reply:sq:${id(1)}`);
    await set(`push_queue/${key}/dueAt`, T('2026-11-14T08:00:00Z'));
    for (const t of ['02:05:00', '05:00:00', '07:59:59']) {
      await drain(T(`2026-11-14T${t}Z`));
      assert.equal(expo.sent.length, 0, `nothing at ${t}`);
      assert.equal((await queue())[key].dueAt, T('2026-11-14T08:00:00Z'), `due time unchanged at ${t}`);
    }
    const d = await drain(T('2026-11-14T08:00:00Z'));
    assert.equal(expo.sent.length, 1);
    assert.deepEqual(d.stats.dropped, {});
    assert.equal((await get(`push_state/${U.ada}/_day`)).morning, 1, 'one of the morning three, as it was promised');
  });

  test('376: a held push seen at 06:00 is dropped at 08:00 (seen)', async () => {
    await device(U.ada);
    await set(`inbox_state/${U.ada}/seenAt`, T('2026-11-14T01:00:00Z'));
    await benReacts(1, T('2026-11-14T02:00:00Z'));
    await drain(T('2026-11-14T02:00:30Z'));
    await set(`inbox_state/${U.ada}/seenAt`, T('2026-11-14T06:00:00Z'));
    const d = await drain(T('2026-11-14T08:00:00Z'));
    assert.equal(expo.sent.length, 0);
    assert.deepEqual(d.stats.dropped, { seen: 1 });
    assert.equal(Object.keys((await get(`inbox/${U.ada}`)) || {}).length, 1, 'the row stays in the list');
  });

  test('376: a message whose conversation is read before its two minutes are up sends nothing', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await set(`inbox_state/${U.ada}/seenAt`, noon - 60 * MIN);
    const conv = [U.ada, U.ben].sort().join('_');
    const say = async (n, t) => {
      await set(`dm_messages/${conv}/${id(n)}`, { text: 'words never pushed', senderUid: U.ben, createdAt: t });
      await notify(U.ben, 'message', `${conv}/${id(n)}`, t);
      // The sender's count, as MessagesPanel writes it after the message.
      await set(`dm_conversations/${U.ada}/${conv}/unread`, ((await get(`dm_conversations/${U.ada}/${conv}/unread`)) || 0) + 1);
    };
    await say(1, noon);
    await drain(noon + 1000);
    assert.equal(expo.sent.length, 1, 'the first goes at once');
    await say(2, noon + 30000);
    assert.equal((await drain(noon + 31000)).stats.later, 1, 'the second waits for the two minutes');
    // Ada opens the conversation at 12:01.
    await set(`dm_conversations/${U.ada}/${conv}/unread`, 0);
    const d = await drain(noon + 2 * MIN + 1000);
    assert.equal(expo.sent.length, 1, 'nothing more');
    assert.deepEqual(d.stats.dropped, { seen: 1 });
  });

  test('376: a conversation left unread still pushes after its two minutes', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    const conv = [U.ada, U.ben].sort().join('_');
    for (const [n, t] of [[1, noon], [2, noon + 30000]]) {
      await set(`dm_messages/${conv}/${id(n)}`, { text: 'x', senderUid: U.ben, createdAt: t });
      await notify(U.ben, 'message', `${conv}/${id(n)}`, t);
      await set(`dm_conversations/${U.ada}/${conv}/unread`, n);
      await drain(t + 1000);
    }
    await drain(noon + 2 * MIN + 1000);
    assert.equal(expo.sent.length, 2);
  });

  test('THE HOURLY GROUP, without waiting: the first reaction at once, the second waits for the hour, then both are named', async () => {
    const ten = T('2026-11-14T10:00:00Z');
    await device(U.ada);
    await post(id(1), U.ada);
    await set(`square_reactions/${id(1)}/like/${U.ben}`, true);
    await notify(U.ben, 'square_reaction', `${id(1)}/like`, ten);
    await drain(ten);
    assert.equal(expo.sent.length, 1);
    assert.equal(expo.sent[0].body, 'Name-ben liked your post');
    await set(`square_reactions/${id(1)}/like/${U.cal}`, true);
    await notify(U.cal, 'square_reaction', `${id(1)}/like`, ten + 20 * MIN);
    const waiting = await drain(ten + 20 * MIN);
    assert.equal(waiting.stats.later, 1);
    assert.equal(expo.sent.length, 1, 'within the hour: nothing');
    assert.equal(Object.values(await queue())[0].dueAt, ten + 60 * MIN);
    await drain(ten + 59 * MIN);
    assert.equal(expo.sent.length, 1);
    await drain(ten + 60 * MIN);
    assert.equal(expo.sent.length, 2);
    assert.equal(expo.sent[1].body, 'Name-cal and Name-ben liked your post');
  });

  test('367: a conversation at once, then at most every two minutes, with the row\'s count', async () => {
    const noon = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    const conv = [U.ada, U.ben].sort().join('_');
    for (const [n, t] of [[1, noon], [2, noon + 30000], [3, noon + 60000]]) {
      await set(`dm_messages/${conv}/${id(n)}`, { text: 'words never pushed', senderUid: U.ben, createdAt: t });
      await notify(U.ben, 'message', `${conv}/${id(n)}`, t);
      await drain(t + 1000);
    }
    assert.equal(expo.sent.length, 1);
    assert.equal(expo.sent[0].body, 'Name-ben sent you a message');
    // The first push went at 12:00:01, so the gate opens at 12:02:01.
    await drain(noon + 2 * MIN);
    assert.equal(expo.sent.length, 1, 'not before two minutes from the last push');
    await drain(noon + 2 * MIN + 1000);
    assert.equal(expo.sent.length, 2);
    assert.equal(expo.sent[1].body, 'Name-ben sent you 3 messages');
    assert.ok(!JSON.stringify(expo.sent).includes('words never pushed'), 'a message push never carries the words');
  });

  test('366: at 08:00 at most three of the night\'s pushes, oldest first; the rest stay in the list', async () => {
    await device(U.ada);
    // Reactions, on five of Ada's posts: since 375, replies no longer wait for the morning.
    for (let n = 1; n <= 5; n++) await benReacts(n, T(`2026-11-14T0${n}:00:00Z`));
    await drain(T('2026-11-14T08:00:00Z'));
    assert.equal(expo.sent.length, MORNING_CAP);
    assert.deepEqual(expo.sent.map((m) => [1, 2, 3, 4, 5].find((n) => m.data.url.includes(id(n)))), [1, 2, 3]);
    assert.equal(Object.keys((await get(`inbox/${U.ada}`)) || {}).length, 5, 'all five stay in the list');
  });

  test('369: twenty a day, then nothing until tomorrow', async () => {
    await device(U.ada);
    await set(`push_state/${U.ada}/_day`, { day: '2026-11-14', n: DAILY_CAP, morning: 0 });
    await benReplies(1, T('2026-11-14T12:00:00Z'));
    const d = await drain(T('2026-11-14T12:00:01Z'));
    assert.equal(expo.sent.length, 0);
    assert.equal(d.stats.dropped.daily_cap, 1);
  });

  test('stale: more than two hours late is dropped, never sent', async () => {
    await device(U.ada);
    await benReplies(1, T('2026-11-14T12:00:00Z'));
    const d = await drain(T('2026-11-14T14:00:01Z'));
    assert.equal(expo.sent.length, 0);
    assert.equal(d.stats.dropped.stale, 1);
  });

  test('NO DUPLICATE after a crash between claim and send', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await benReplies(1, now);
    // (a) Expo unreachable after the claim: never retried.
    expo.fail = new Error('network went away');
    const first = await drain(now + 1000);
    assert.equal(first.stats.sendFailed, 1);
    assert.equal(expo.sent.length, 0);
    await drain(now + 70000);
    assert.equal(expo.sent.length, 0, 'claimed once, never sent twice');
    // (b) A run that died after its claim PATCH, before Expo: its entry is as the claim left it.
    await benReplies(2, now + 2 * MIN);
    const key = queueKey(U.ada, `reply:sq:${id(2)}`);
    const e = (await queue())[key];
    await set(`push_queue/${key}`, { ...e, state: 'sending', claimedFor: e.at, claimedAt: now + 2 * MIN });
    const after = await drain(now + 3 * MIN);
    assert.equal(after.stats.cleared, 1);
    assert.equal(expo.sent.length, 0);
  });

  test('founders only (the default until switch-on): a reader is dropped, a founder is sent', async () => {
    const now = T('2026-11-14T12:00:00Z');
    const F = FOUNDER_UIDS[0];
    await set(`users/${F}`, { displayName: 'Name-founder', username: 'founder' });
    await device(U.ada);
    await device(F);
    await post(id(100), U.ada);
    await post(id(101), F);
    await post(id(1), U.ben, { parentId: id(100) });
    await post(id(2), U.ben, { parentId: id(101) });
    await notify(U.ben, 'square_post', id(1), now);
    await notify(U.ben, 'square_post', id(2), now);
    const d = await drain(now + 1000, { foundersOnly: true });
    assert.equal(d.stats.dropped.founders_only, 1);
    assert.equal(expo.sent.length, 1);
    assert.equal(expo.sent[0].to, TOKEN(F));
  });

  test('a phone signed into a second account belongs to the newer; no pushCaps, no push', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await set(`push_tokens/${U.ada}/key1`, { token: TOKEN(U.ada), platform: 'ios', appVersion: '1.7.1', updatedAt: now - 2 * 86400000, pushCaps: 1 });
    await set(`push_tokens/${U.cal}/key1`, { token: TOKEN(U.ada), platform: 'ios', appVersion: '1.7.1', updatedAt: now - 86400000, pushCaps: 1 });
    await device(U.dee, { caps: 0 });
    await benReplies(1, now);
    await post(id(200), U.dee);
    await post(id(2), U.ben, { parentId: id(200) });
    await notify(U.ben, 'square_post', id(2), now);
    const d = await drain(now + 1000);
    assert.equal(expo.sent.length, 0);
    assert.equal(d.stats.dropped.no_device, 2);
  });

  test('362: the old mention switch off, no value of its own: a mention is not pushed', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await device(U.ada);
    await set(`users/${U.ada}/mentionNotifications`, false);
    await post(id(1), U.ben, { text: 'hello @ada' });
    await notify(U.ben, 'square_post', id(1), now);
    const d = await drain(now + 1000);
    assert.equal(d.stats.dropped.switched_off, 1);
    assert.equal(expo.sent.length, 0);
  });

  test('DeviceNotRegistered: the device comes off every account that holds it', async () => {
    const now = T('2026-11-14T12:00:00Z');
    await device(U.ada, { updatedAt: now - 1000 });
    await set(`push_tokens/${U.cal}/old`, { token: TOKEN(U.ada), platform: 'ios', appVersion: '1.7.1', updatedAt: now - 9e8 });
    expo.dead.add(TOKEN(U.ada));
    await benReplies(1, now);
    await drain(now + 1000);
    assert.equal(await get(`push_tokens/${U.ada}/key1`), null);
    assert.equal(await get(`push_tokens/${U.cal}/old`), null);
  });

  test('the budget: eight readers at once, every call within 45, the rest carried by `more`', async () => {
    const now = T('2026-11-14T12:00:00Z');
    const readers = ['ada', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy'].map((n) => U[n]);
    for (const [i, u] of readers.entries()) {
      await device(u);
      await set(`inbox_state/${u}/seenAt`, now - 60 * MIN);
      await post(id(100 + i), u);
      await post(id(i + 1), U.ben, { parentId: id(100 + i) });
      await notify(U.ben, 'square_post', id(i + 1), now);
    }
    const calls = [];
    for (let i = 0; i < 10 && expo.sent.length < readers.length; i++) {
      const d = await drain(now + 1000 + i);
      calls.push(`${d.stats.sent} sent in ${d.stats.shim}`);
      if (!d.body.more) break;
    }
    console.log(`  drain, 8 readers due at once: ${calls.join('; ')} subrequests`);
    assert.equal(expo.sent.length, readers.length);
  });
});

describe('POST /api/push/release', () => {
  test('the install id releases every row carrying its hash, under every account; a stranger\'s id releases nothing', async () => {
    const installId = 'invented-install-id-0123456789abcdefghijklmnop';
    const hash = await sha256Hex(installId);
    await device(U.ada, { installHash: hash });
    await set(`push_tokens/${U.cal}/k`, { token: TOKEN(U.ada), platform: 'ios', appVersion: '1.7.1', updatedAt: 1, installHash: hash });
    await device(U.ben, { installHash: await sha256Hex('someone-else-entirely-0123456789abcdef') });
    const call = async (body) => {
      L.begin();
      const stats = {};
      const { ctx } = context(request('/api/push/release', { body }));
      const res = await handleRelease(ctx, { stats });
      L.end();
      return { status: res.status, body: await res.json(), stats };
    };
    assert.equal((await call({ installId: 'short' })).status, 400);
    const r = await call({ installId });
    assert.deepEqual(r.body, { ok: true });
    assert.equal(r.stats.released, 2);
    assert.ok(r.stats.used <= 3);
    assert.equal(await get(`push_tokens/${U.ada}`), null);
    assert.equal(await get(`push_tokens/${U.cal}`), null);
    assert.ok(await get(`push_tokens/${U.ben}/key1`), 'another phone is untouched');
    assert.deepEqual((await call({ installId: 'nobody-holds-this-id-0123456789abcdefgh' })).body, { ok: true });
  });
});
