// P4-B3 — personal pushes, instant and standard: the pure half. The emulator half (the notify call
// sending its own push, the timing, the race with the cron, POST /api/push/seen end to end) is
// tests/notify/p4-instant.emulator.mjs. Invented ids only; nothing is read or sent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personalMessage, badgeMessage, threadKey, pushIds, INSTANT_FLOOR } from '../../functions/api/push/drain.js';
import { decideBadge, sendsNow, BADGE_KIND, BADGE_KEY, BADGE_INTERVAL_MS, P4_ARMED, queueKey } from '../../app/lib/pushP4.js';
import { INBOX_KINDS } from '../../app/lib/notificationKinds.js';
import { tellSeen } from '../../app/lib/pushSeenClient.js';
import { SUBREQUEST_BUDGET } from '../../functions/api/_budget.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const WORDS = { title: 'Name replied to your post', body: '“A line.”', url: '/square/p?id=x', channelId: 'people' };

describe('item 1: instant', () => {
  test('dormant until armed, and only where both drain secrets are set (a preview deployment never sends)', () => {
    const env = { PUSH_DRAIN_SECRET: 's', EXPO_ACCESS_TOKEN: 't' };
    assert.equal(sendsNow(env, true), true);
    assert.equal(sendsNow(env, false), false);
    assert.equal(sendsNow({ EXPO_ACCESS_TOKEN: 't' }, true), false);
    assert.equal(sendsNow({ PUSH_DRAIN_SECRET: 's' }, true), false);
    assert.equal(sendsNow(env), P4_ARMED, 'production reads the one switch');
  });
  test('notify sends through the drain\'s own pass, after its response, never a sender of its own', () => {
    const n = src('functions/api/notify.js');
    // P4-B5 wrapped the pass so a queue wake-up can follow it; it is still the drain's own pass, in waitUntil.
    assert.match(n, /context\.waitUntil\(import\('\.\/push\/drain\.js'\)\.then\(async \(\{ drainNow \}\) => \{\s+const out = await drainNow\(db, env, \{ now, keys: queuedKeys/);
    assert.ok(!n.includes('exp.host'), 'notify never calls Expo itself');
    const s = src('functions/api/push/seen.js');
    assert.match(s, /context\.waitUntil\(drainNow\(db, env/);
    assert.ok(!s.includes('exp.host'));
  });
  test('the instant send starts only with room for one whole entry, and never writes the cron\'s heartbeat', () => {
    assert.ok(INSTANT_FLOOR > 0 && INSTANT_FLOOR < SUBREQUEST_BUDGET);
    const d = src('functions/api/push/drain.js');
    assert.match(d, /if \(instant\) o\[`\$\{DRAIN_OPS\}\/lastInstant`\]/);
  });
  test('the lease is taken before the queue is read (two passes can now start in the same second)', () => {
    const d = src('functions/api/push/drain.js');
    const lease = d.indexOf("await db.getWithEtag(`${DRAIN_OPS}/lease`)");
    const reread = d.indexOf('due = await readDue();', lease);
    assert.ok(lease > 0 && reread > lease);
  });
  test('the Worker is unchanged: it is pasted as it is', () => {
    const w = src('workers-external/push-drain-ping.worker.js');
    assert.match(w, /const DRAIN = 'https:\/\/calvaryscribblings\.co\.uk\/api\/push\/drain';/);
    assert.ok(!/PUSH_DRAIN_SECRET\s*=/.test(w), 'no secret in the source');
  });
});

describe('item 2: priority high', () => {
  test('a personal push and a badge-only push both carry priority high', () => {
    assert.equal(personalMessage('tok', WORDS).priority, 'high');
    assert.equal(badgeMessage('tok', 3).priority, 'high');
  });
});

describe('item 3: one up-to-date line', () => {
  test('the thread is what the record opens: a conversation, a post\'s thread, a piece, a story', () => {
    assert.equal(threadKey({ kind: 'message', subject: { convId: 'a_b' } }), 'dm:a_b');
    assert.equal(threadKey({ kind: 'reply', subject: { postId: 'r', threadId: 'root' } }), 'sq:root');
    assert.equal(threadKey({ kind: 'reaction', subject: { postId: 'root' } }), 'sq:root');
    assert.equal(threadKey({ kind: 'reply', subject: { pieceId: 'p', path: 'x' } }), 'op:p');
    assert.equal(threadKey({ kind: 'response', subject: { slug: 's' } }), 'story:s');
    assert.equal(threadKey({ kind: 'reply', subject: { slug: 's', commentId: 'c' } }), 'story:s');
    assert.equal(threadKey({ kind: 'follow', subject: { uid: 'u' } }), 'follow');
  });
  test('collapseId (and tag, the same) only on a grouped record; hashed and short', async () => {
    for (const [kind, k] of Object.entries(INBOX_KINDS)) {
      const ids = await pushIds(`${kind}:x`, { kind, subject: { slug: 's' } });
      assert.equal(!!ids.collapseId, !!k.group, kind);
    }
    const g = await pushIds('message:a_b', { kind: 'message', subject: { convId: 'a_b' } });
    assert.match(g.threadId, /^t[0-9a-f]{32}$/);
    assert.match(g.collapseId, /^g[0-9a-f]{32}$/);
    const m = personalMessage('tok', WORDS, g);
    assert.equal(m.threadId, g.threadId);
    assert.equal(m.collapseId, g.collapseId);
    assert.equal(m.tag, g.collapseId);
    const r = personalMessage('tok', WORDS, await pushIds('reply:sq:r', { kind: 'reply', subject: { postId: 'r', threadId: 'root' } }));
    assert.ok(r.threadId && !('collapseId' in r) && !('tag' in r));
  });
});

describe('item 4: the badge-only push', () => {
  test('the number and nothing else', () => {
    assert.deepEqual(badgeMessage('tok', 0), { to: 'tok', badge: 0, priority: 'high' });
  });
  test('its entry is {uid}~_badge, its kind not an inbox kind', () => {
    assert.equal(INBOX_KINDS[BADGE_KIND], undefined);
    assert.equal(queueKey('u', BADGE_KIND), 'u~_badge');
  });
  test('at most one a minute; never for a reader who has never opened a list', () => {
    const now = 1_800_000_000_000;
    assert.deepEqual(decideBadge({}, {}, null, now), { action: 'drop', reason: 'never_seen' });
    assert.deepEqual(decideBadge({}, {}, now - 5, now), { action: 'send' });
    assert.deepEqual(decideBadge({}, { [BADGE_KEY]: { pushedAt: now - 20000 } }, now - 5, now), { action: 'later', dueAt: now - 20000 + BADGE_INTERVAL_MS });
    assert.deepEqual(decideBadge({}, { [BADGE_KEY]: { pushedAt: now - BADGE_INTERVAL_MS } }, now - 5, now), { action: 'send' });
  });
  test('the web tells the endpoint after seenAt is saved, and only then', () => {
    const b = src('app/lib/useBell.js');
    const save = b.indexOf('seenAt: serverTimestamp() }); saved = true;');
    const tell = b.indexOf("if (saved) import('./pushSeenClient')");
    assert.ok(save > 0 && tell > save);
  });
  test('tellSeen posts the reader\'s ID token to /api/push/seen, and never throws', async () => {
    const calls = [];
    const ok = await tellSeen({ getIdToken: async () => 'id-token' }, { fetchImpl: async (u, init) => { calls.push([u, init]); return { ok: true }; } });
    assert.equal(ok, true);
    assert.equal(calls[0][0], '/api/push/seen');
    assert.equal(calls[0][1].method, 'POST');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer id-token');
    assert.equal(await tellSeen({ getIdToken: async () => { throw new Error('x'); } }), false);
    assert.equal(await tellSeen({ getIdToken: async () => 't' }, { fetchImpl: async () => { throw new Error('down'); } }), false);
  });
});
