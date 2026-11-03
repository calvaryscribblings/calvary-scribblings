// NOTIF-B1 (P1) — POST /api/notify and functions/api/_notify.js, run unmodified against the RTDB
// emulator under Cloudflare's limits (the PROOFS-R3.1 shim: 50 subrequests and 6 connections per
// request, the 51st fetch throws as workerd does). Every call must also stay inside NOTIFY_BUDGET (45).
//
//   npm run test:notify:emulator
//
// Invented readers only. Google's token and sign-in endpoints are stood in for by the proofs
// harness; everything else outbound is refused. Nothing reaches production.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, installLimits, loadRules, wipe, get, set, request, context, tokenFor } from '../proofs/harness.mjs';
import { handleNotify } from '../../functions/api/notify.js';
import { NOTIFY_BUDGET } from '../../functions/api/_notify.js';
import { MENTION_CAP } from '../../app/lib/notificationKinds.js';
import { planScrub, SCAN_NODES } from '../../scripts/account/scrub-plan.mjs';
import { planOwned, OWNED_NODES } from '../../functions/api/account/_deletion.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SLUG = 'invented-story';
// Invented uids, alphanumeric as Firebase's are.
const U = Object.fromEntries(['writer', 'ada', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kit', 'lou', 'max', 'ned']
  .map((n) => [n, `${n}${'0'.repeat(20 - n.length)}uid`]));
const id = (n) => `-Ninvented${String(n).padStart(10, '0')}`;
let L;

before(async () => { install(); L = installLimits({ limit: 50, connections: 6 }); await loadRules(); });
after(() => { L.uninstall(); uninstall(); });
beforeEach(async () => {
  await wipe();
  // Every reader has a public profile with a display name, so the test can prove none is copied.
  for (const [name, uid] of Object.entries(U)) {
    await set(`users/${uid}`, { displayName: `Name-${name}`, username: name, avatarUrl: `https://img.test/${name}.jpg` });
    await set(`usernames/${name}`, uid);
  }
  await set(`cms_stories_index/${SLUG}`, { title: 'An Invented Story', authorUid: U.writer, published: true });
});

/** One request, alone under the shim. Returns { status, body, stats }. */
async function call(as, event, subjectId, { token = tokenFor(as) } = {}) {
  L.begin();
  const stats = {};
  const { ctx } = context(request('/api/notify', { body: { event, subjectId }, token }));
  const res = await handleNotify(ctx, { now: NOW, stats });
  L.end();
  const used = L.calls.at(-1);
  assert.ok(used <= NOTIFY_BUDGET, `a call made ${used} subrequests (budget ${NOTIFY_BUDGET})`);
  assert.equal(L.refused, 0, 'a call reached the 51st subrequest');
  return { status: res.status, body: await res.json(), stats: { ...stats, shim: used } };
}
const inbox = async (uid) => (await get(`inbox/${uid}`)) || {};
const only = async (uid) => { const box = await inbox(uid); const v = Object.values(box); return v.length === 1 ? v[0] : assert.fail(`${v.length} records`); };

async function comment(slug, cid, author, text, parentId = null) {
  await set(`comments/${slug}/${cid}`, { text, authorUid: author, authorName: 'x', createdAt: NOW, ...(parentId ? { parentId } : {}) });
}
async function post(pid, author, extra = {}) {
  await set(`square_posts/${pid}`, { text: 'a post', authorUid: author, createdAt: NOW, ...extra });
}

describe('who may ask, and for what', () => {
  test('no token, a bad token, a bad body: refused before any database read', async () => {
    await comment(SLUG, id(1), U.ada, 'hello');
    assert.equal((await call(U.ada, 'comment', `${SLUG}/${id(1)}`, { token: null })).status, 401);
    assert.equal((await call(U.ada, 'comment', `${SLUG}/${id(1)}`, { token: 'forged' })).status, 401);
    for (const [ev, sub] of [['reward', U.ada], ['new_story', SLUG], ['badge', 'x'], ['comment', '../users'], ['comment', `${SLUG}/../../users`], ['follow', `${U.ada}/x`], ['message', `${U.ben}_${U.ada}/${id(1)}`]]) {
      assert.equal((await call(U.ada, ev, sub)).status, 400, `${ev} ${sub}`);
    }
  });

  test('impersonation: a reader cannot raise a notification for an event someone else wrote', async () => {
    await comment(SLUG, id(1), U.ben, 'Ben wrote this, mentioning @cal');
    await post(id(2), U.ben, { text: 'hi @cal' });
    await set(`dm_messages/${[U.ada, U.ben].sort().join('_')}/${id(3)}`, { text: 'hi', senderUid: U.ben, createdAt: NOW });
    const conv = [U.ada, U.ben].sort().join('_');
    assert.equal((await call(U.ada, 'comment', `${SLUG}/${id(1)}`)).status, 403);
    assert.equal((await call(U.ada, 'square_post', id(2))).status, 403);
    assert.equal((await call(U.ada, 'message', `${conv}/${id(3)}`)).status, 403);
    // A reaction, a follow, a story reaction the caller never made.
    assert.equal((await call(U.ada, 'square_reaction', `${id(2)}/like`)).status, 403);
    assert.equal((await call(U.ada, 'comment_reaction', `${SLUG}/${id(1)}/heart`)).status, 403);
    assert.equal((await call(U.ada, 'follow', U.ben)).status, 403);
    assert.equal((await call(U.ada, 'story_reaction', `${SLUG}/heart`)).status, 403);
    for (const u of Object.values(U)) assert.deepEqual(await inbox(u), {}, 'nothing was written');
  });

  test('a missing event is 404, and a message in a conversation the caller is not in is 400', async () => {
    assert.equal((await call(U.ada, 'comment', `${SLUG}/${id(9)}`)).status, 404);
    assert.equal((await call(U.ada, 'message', `${[U.ben, U.cal].sort().join('_')}/${id(1)}`)).status, 400);
  });
});

describe('who hears', () => {
  test('a reply to a response: the parent author (reply), the mentioned (mention), the writer (response)', async () => {
    await comment(SLUG, id(1), U.ben, 'first');
    await comment(SLUG, id(2), U.ada, 'answering, and @cal should see this', id(1));
    const r = await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    assert.equal((await only(U.ben)).kind, 'reply');
    assert.equal((await only(U.cal)).kind, 'mention');
    const w = await only(U.writer);
    assert.equal(w.kind, 'response');
    assert.equal(w.count, 1);
    assert.deepEqual(w.recent, [U.ada]);
    assert.deepEqual(await inbox(U.ada), {}, 'never the actor');
  });

  test('records carry uids and ids only: no name, handle or avatar is copied', async () => {
    await comment(SLUG, id(1), U.ben, 'first');
    await comment(SLUG, id(2), U.ada, 'hi @cal', id(1));
    await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    const all = JSON.stringify([await inbox(U.ben), await inbox(U.cal), await inbox(U.writer)]);
    for (const leak of ['Name-ada', 'img.test', '"ada"', 'fromName', 'displayName', 'avatar']) assert.ok(!all.includes(leak), leak);
  });

  test('the same call twice changes nothing', async () => {
    await comment(SLUG, id(1), U.ben, 'first');
    await comment(SLUG, id(2), U.ada, 'hi @cal', id(1));
    await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    const before = [await inbox(U.ben), await inbox(U.cal), await inbox(U.writer)];
    const again = await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    assert.equal(again.stats.delivered, 0);
    assert.deepEqual([await inbox(U.ben), await inbox(U.cal), await inbox(U.writer)], before);
  });

  test('a Square reply: "replied to you" first, then the thread\'s author; never followers (ruling 320)', async () => {
    await post(id(1), U.ben);
    await post(id(2), U.cal, { parentId: id(1) });
    await set(`followers/${U.ada}/${U.dee}`, true);
    await post(id(3), U.ada, { parentId: id(1), replyToId: id(2), text: 'agreed' });
    await call(U.ada, 'square_post', id(3));
    assert.deepEqual((await only(U.cal)).subject, { postId: id(3), threadId: id(1), to: 'you' });
    assert.deepEqual((await only(U.ben)).subject, { postId: id(3), threadId: id(1) });
    assert.deepEqual(await inbox(U.dee), {});
  });

  test('a message: grouped per conversation; a muted conversation is silent', async () => {
    const conv = [U.ada, U.ben].sort().join('_');
    for (const n of [1, 2]) {
      await set(`dm_messages/${conv}/${id(n)}`, { text: 'hi', senderUid: U.ada, createdAt: NOW });
      await call(U.ada, 'message', `${conv}/${id(n)}`);
    }
    const m = await only(U.ben);
    assert.equal(m.kind, 'message');
    assert.equal(m.count, 2);
    await set(`dm_muted/${U.ben}/${conv}`, true);
    await set(`dm_messages/${conv}/${id(3)}`, { text: 'hi', senderUid: U.ada, createdAt: NOW });
    const r = await call(U.ada, 'message', `${conv}/${id(3)}`);
    assert.equal(r.stats.silenced, 1);
    assert.equal((await only(U.ben)).count, 2);
  });

  test('a follow: told once, however often they re-follow', async () => {
    await set(`followers/${U.ben}/${U.ada}`, true);
    await call(U.ada, 'follow', U.ben);
    await call(U.ada, 'follow', U.ben);
    const f = await only(U.ben);
    assert.equal(f.kind, 'follow');
    assert.equal(f.count, 1);
  });
});

describe('blocked and muted senders stay silent', () => {
  async function scene() {
    await comment(SLUG, id(1), U.ben, 'first');
    await comment(SLUG, id(2), U.ada, 'hi @cal and @dee', id(1));
  }
  const ask = () => call(U.ada, 'comment', `${SLUG}/${id(2)}`);

  test('the recipient blocked the sender', async () => {
    await scene();
    await set(`blocked_users/${U.ben}/${U.ada}`, true);
    const r = await ask();
    assert.deepEqual(r.body, { ok: true }, 'the caller is not told');
    assert.deepEqual(await inbox(U.ben), {});
    assert.equal((await only(U.cal)).kind, 'mention');
  });
  test('the sender blocked the recipient', async () => {
    await scene();
    await set(`blocked_users/${U.ada}/${U.cal}`, true);
    await ask();
    assert.deepEqual(await inbox(U.cal), {});
    assert.equal((await only(U.dee)).kind, 'mention');
  });
  test('the recipient muted the sender (ruling 319)', async () => {
    await scene();
    await set(`muted_users/${U.writer}/${U.ada}`, true);
    await set(`muted_users/${U.dee}/${U.ada}`, true);
    const r = await ask();
    assert.deepEqual(r.body, { ok: true });
    assert.deepEqual(await inbox(U.writer), {});
    assert.deepEqual(await inbox(U.dee), {});
    assert.equal((await only(U.ben)).kind, 'reply');
    assert.equal(r.stats.silenced, 2);
  });
  test('a mute between two others changes nothing (control)', async () => {
    await scene();
    await set(`muted_users/${U.ben}/${U.cal}`, true);
    await ask();
    assert.equal((await only(U.ben)).kind, 'reply');
  });
});

describe('grouping holds under simultaneous reactions', () => {
  // The shim counts one request at a time, so calls fired together step out of it; each call's own
  // Budget still refuses its 46th subrequest, and every call's count is asserted below.
  const together = async (fn) => {
    L.uninstall();
    try { return await fn(); } finally { L = installLimits({ limit: 50, connections: 6 }); }
  };
  const READERS = ['ada', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kit', 'lou'];

  test(`${READERS.length} readers react to one Square post at the same moment: one record, every reader counted once`, async () => {
    await post(id(1), U.writer);
    for (const r of READERS) await set(`square_reactions/${id(1)}/like/${U[r]}`, true);
    const runs = await together(() => Promise.all(READERS.map(async (r) => {
      const stats = {};
      const { ctx } = context(request('/api/notify', { body: { event: 'square_reaction', subjectId: `${id(1)}/like` }, token: tokenFor(U[r]) }));
      const res = await handleNotify(ctx, { now: NOW, stats });
      return { status: res.status, stats };
    })));
    for (const { status, stats } of runs) {
      assert.equal(status, 200);
      assert.ok(stats.used <= NOTIFY_BUDGET, `used ${stats.used}`);
    }
    assert.equal(runs.reduce((n, r) => n + r.stats.delivered, 0), READERS.length, 'every reaction landed');
    const g = await only(U.writer);
    assert.equal(g.kind, 'reaction');
    assert.equal(g.count, READERS.length);
    assert.equal(g.actorCount, READERS.length);
    assert.equal(Object.keys(g.actors).length, READERS.length);
    assert.equal(g.recent.length, 3);
    console.log(`  simultaneous: ${READERS.length} calls, most subrequests in one call ${Math.max(...runs.map((r) => r.stats.used))}`);
  });

  test('responses on one story arrive at once: one record for the writer, each response counted', async () => {
    const who = ['ada', 'ben', 'cal', 'dee', 'eve', 'fay'];
    for (const [i, r] of who.entries()) await comment(SLUG, id(i + 1), U[r], 'a response');
    await together(() => Promise.all(who.map(async (r, i) => {
      const stats = {};
      const { ctx } = context(request('/api/notify', { body: { event: 'comment', subjectId: `${SLUG}/${id(i + 1)}` }, token: tokenFor(U[r]) }));
      assert.equal((await handleNotify(ctx, { now: NOW, stats })).status, 200);
      assert.ok(stats.used <= NOTIFY_BUDGET, `used ${stats.used}`);
    })));
    const g = await only(U.writer);
    assert.equal(g.kind, 'response');
    assert.equal(g.count, who.length);
  });

  test('a reaction taken off and put back is not counted twice', async () => {
    await post(id(1), U.writer);
    await set(`square_reactions/${id(1)}/like/${U.ada}`, true);
    await call(U.ada, 'square_reaction', `${id(1)}/like`);
    await call(U.ada, 'square_reaction', `${id(1)}/like`);
    await set(`square_reactions/${id(1)}/fire/${U.ada}`, true);
    await call(U.ada, 'square_reaction', `${id(1)}/fire`);
    assert.equal((await only(U.writer)).count, 1);
  });
});

describe('the worst case fits the budget', () => {
  const HANDLES = ['cal', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo'];   // eight, two past the cap
  const text = HANDLES.map((h) => `@${h}`).join(' ');

  test(`a Square reply naming ${HANDLES.length} readers, to someone else's reply in someone else's thread`, async () => {
    await post(id(1), U.ben);
    await post(id(2), U.kit, { parentId: id(1) });
    await post(id(3), U.ada, { parentId: id(1), replyToId: id(2), text });
    const r = await call(U.ada, 'square_post', id(3));
    console.log(`  square reply, ${MENTION_CAP} mentions + 2 authors: ${r.stats.shim} subrequests (budget ${NOTIFY_BUDGET}, Cloudflare 50)`);
    assert.equal(r.stats.delivered, 2 + MENTION_CAP);
    assert.equal(r.stats.dropped, 0);
    for (const h of HANDLES.slice(0, MENTION_CAP)) assert.equal((await only(U[h])).kind, 'mention');
    for (const h of HANDLES.slice(MENTION_CAP)) assert.deepEqual(await inbox(U[h]), {}, `${h} is past the cap`);
  });

  test(`a reply to a response naming ${HANDLES.length} readers, on a story whose writer is told too`, async () => {
    await comment(SLUG, id(1), U.ben, 'first');
    await comment(SLUG, id(2), U.ada, text, id(1));
    const r = await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    console.log(`  story reply, ${MENTION_CAP} mentions + parent + writer: ${r.stats.shim} subrequests`);
    assert.equal(r.stats.delivered, 2 + MENTION_CAP);
    assert.equal(r.stats.dropped, 0);
  });

  test('the same, with every recipient muting the sender (the most reads, no writes)', async () => {
    await comment(SLUG, id(1), U.ben, 'first');
    await comment(SLUG, id(2), U.ada, text, id(1));
    for (const u of [U.ben, U.writer, ...HANDLES.map((h) => U[h])]) await set(`muted_users/${u}/${U.ada}`, true);
    const r = await call(U.ada, 'comment', `${SLUG}/${id(2)}`);
    assert.equal(r.stats.silenced, 2 + MENTION_CAP);
  });

  test('under a budget too small for everyone, the nearest are told and the rest dropped, never half-written', async () => {
    await comment(SLUG, id(1), U.ben, 'first');
    await comment(SLUG, id(2), U.ada, text, id(1));
    L.begin();
    const stats = {};
    const { ctx } = context(request('/api/notify', { body: { event: 'comment', subjectId: `${SLUG}/${id(2)}` }, token: tokenFor(U.ada) }));
    await handleNotify(ctx, { now: NOW, stats, limit: 25 });
    L.end();
    assert.ok(stats.used <= 25);
    assert.ok(stats.dropped > 0);
    assert.equal((await only(U.ben)).kind, 'reply', 'the reply, first in line, was told');
    assert.deepEqual(await inbox(U.writer), {}, 'the writer, last in line, was dropped');
  });
});

describe('account deletion: inbox, inbox_state, notify_prefs, both ways', () => {
  test('the endpoint deletes their own three nodes', () => {
    for (const n of ['inbox', 'inbox_state', 'notify_prefs']) assert.ok(OWNED_NODES.includes(n), n);
    const u = planOwned(U.ada, { user: null, following: {}, followers: {}, handles: {}, subscribers: {}, waitlist: {}, instalments: {} }, null);
    for (const n of ['inbox', 'inbox_state', 'notify_prefs']) assert.equal(u[`${n}/${U.ada}`], null);
  });

  test('the scrub takes what they caused out of everyone else\'s list, and leaves the rest', async () => {
    // Ada reacts with Ben and Cal on the writer's post, replies to Ben, messages Dee, follows Eve.
    await post(id(1), U.writer);
    for (const r of ['ada', 'ben', 'cal']) { await set(`square_reactions/${id(1)}/like/${U[r]}`, true); await call(U[r], 'square_reaction', `${id(1)}/like`); }
    await post(id(2), U.ben);
    await post(id(3), U.ada, { parentId: id(2) });
    await call(U.ada, 'square_post', id(3));
    const conv = [U.ada, U.dee].sort().join('_');
    await set(`dm_messages/${conv}/${id(4)}`, { text: 'hi', senderUid: U.ada, createdAt: NOW });
    await call(U.ada, 'message', `${conv}/${id(4)}`);
    await set(`followers/${U.eve}/${U.ada}`, true);
    await call(U.ada, 'follow', U.eve);
    // A record Ada didn't cause, in a group Ada isn't in, stays exactly as it is.
    await post(id(5), U.fay);
    await set(`square_reactions/${id(5)}/like/${U.ben}`, true);
    await call(U.ben, 'square_reaction', `${id(5)}/like`);
    const fayBefore = await inbox(U.fay);
    // Ada's own list, watermark and switches.
    await set(`inbox/${U.ada}/x`, { kind: 'reply', actor: U.ben, subject: { postId: id(2) }, at: NOW });
    await set(`inbox_state/${U.ada}`, { seenAt: NOW });
    await set(`notify_prefs/${U.ada}`, { reactions: false });

    const snap = {};
    for (const n of SCAN_NODES) snap[n] = await get(n);
    snap.userNode = null;
    const plan = planScrub(U.ada, snap, { now: NOW });
    for (const p of plan.nulls) await set(p, null);
    for (const [p, v] of Object.entries(plan.sets)) await set(p, v);

    const g = await only(U.writer);
    assert.equal(g.count, 2);
    assert.equal(g.actorCount, 2);
    assert.ok(!(U.ada in g.actors) && !g.recent.includes(U.ada) && !(U.ada in g.events));
    assert.deepEqual(await inbox(U.ben), {}, 'the reply Ada sent');
    assert.deepEqual(await inbox(U.dee), {}, 'the conversation with Ada');
    assert.deepEqual(await inbox(U.eve), {}, 'the follow');
    assert.deepEqual(await inbox(U.fay), fayBefore);
    for (const n of ['inbox', 'inbox_state', 'notify_prefs']) assert.equal(await get(`${n}/${U.ada}`), null, n);
    assert.equal(plan.counts.inboxRecordsInOthers, 3);
    assert.equal(plan.counts.inboxGroupsStripped, 1);
  });

  test('a group with nobody left in it goes', async () => {
    await post(id(1), U.writer);
    await set(`square_reactions/${id(1)}/like/${U.ada}`, true);
    await call(U.ada, 'square_reaction', `${id(1)}/like`);
    const snap = {};
    for (const n of SCAN_NODES) snap[n] = await get(n);
    snap.userNode = null;
    const plan = planScrub(U.ada, snap, { now: NOW });
    assert.ok(plan.nulls.some((p) => p.startsWith(`inbox/${U.writer}/`)));
  });
});
